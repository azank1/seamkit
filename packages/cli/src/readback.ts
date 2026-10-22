import {
  markerKey,
  parseEventFile,
  readbackCheck,
  readbackSightings,
  type AncestryFact,
  type BundleObservation,
  type CheckRun,
  type Marker,
  type ReadbackChange,
  type ReadbackInput,
  type Sighting,
  type VersionObservation,
} from '@seamkit/core';
import { discoverVersion, GitRepo, observeBundle, observeVersion, VERSION_PATHS, type GitCommit, type HttpOptions } from '@seamkit/adapters';
import { parseChangeMessage, readCard } from '@seamkit/formats';
import { GitStateStore, NotAGitRepository } from '@seamkit/state';

export interface ReadbackRequest {
  /** The production page; its origin is where the version document is looked for. */
  url: string;
  pr?: number;
  commit?: string;
  last: number;
  branch?: string;
  versionUrl?: string;
  /**
   * The commit just deployed. When the ledger holds a run that read this address, a change merged
   * after it that was never seen live here, nor in any build production was seen running here
   * (now included), is left to the next deploy and listed as not examined. Any other is judged, so
   * a deploy that drops it fails. Without such a run, or once production here was seen running a
   * commit this repository does not have, every change is judged.
   * `last` counts the changes judged, so changes left to the next deploy do not crowd the window.
   */
  deployed?: string;
}

/** Everything the shell learned while gathering, beyond the check input, for the audit's advice. */
export interface ReadbackContext {
  branch: string;
  primaryVersion: VersionObservation;
  shallow: boolean;
  ledger: boolean;
  cards: { found: number; broken: number };
}

const PR_SEARCH_DEPTH = 200;
const short = (commit: string): string => commit.slice(0, 12);
const COMMIT_ID = /^[0-9a-f]{4,64}$/;

function subjectOf(c: GitCommit, pr: number | undefined): string {
  return pr === undefined ? `commit:${short(c.commit)}` : `pr#${pr}`;
}

/** Turns a commit into a change, with its card's markers or, failing that, the implicit version marker. */
function toChange(c: GitCommit, pageUrl: string, primary: VersionObservation, subjects: Set<string>): ReadbackChange & { cardFound: boolean } {
  const message = parseChangeMessage(c.message, c.parents.length);
  // The same pull request number can appear twice (a revert, say); later ones fall back to the commit.
  let subject = subjectOf(c, message.pr);
  if (subjects.has(subject)) subject = `commit:${short(c.commit)}`;
  subjects.add(subject);
  const implicit: Marker[] = [{ kind: 'version', url: primary.url }];
  const card = readCard(c.message);
  if (!card.found) return { subject, commit: c.commit, title: message.title, markerSource: 'implicit', markers: implicit, cardFound: false };
  if (!card.ok) {
    return { subject, commit: c.commit, title: message.title, markerSource: 'implicit', markers: implicit, cardProblems: card.problems.slice(0, 20), cardFound: true };
  }
  const at = (u: string | undefined, fallback: string): string => (u === undefined ? fallback : new URL(u, pageUrl).href);
  const markers: Marker[] = card.card.markers.map((m) => {
    switch (m.kind) {
      case 'bundle':
        return { kind: 'bundle', url: at(m.url, pageUrl), text: m.text };
      case 'version':
        return { kind: 'version', url: at(m.url, primary.url) };
      default:
        return m;
    }
  });
  // A card may list the same marker twice once defaults are filled in; keep the first.
  const unique = markers.filter((m, i) => markers.findIndex((o) => JSON.stringify(o) === JSON.stringify(m)) === i);
  return { subject, commit: c.commit, title: message.title, markerSource: 'card', markers: unique, cardFound: true };
}

/**
 * Sightings of these changes in earlier recorded readback runs, or null when there is no ledger.
 * `readHere` says whether any recorded run read this address's version document, and `observed`
 * holds every commit that production's own document named in a recorded run, whatever changes
 * the run judged: together they let a change that has no sighting and was never in a build seen
 * here be left to the next deploy. `addresses` are where production's own document may have been
 * read: every discovery path on the origin when the document is discovered, since a build can
 * move it from one to another.
 */
async function loadHistory(
  cwd: string,
  primaryUrl: string,
  addresses: ReadonlySet<string>,
  commits: ReadonlySet<string>,
): Promise<{ sightings: Sighting[]; readHere: boolean; observed: string[] } | null> {
  let store: GitStateStore;
  try {
    store = await GitStateStore.open(cwd);
  } catch (err) {
    if (err instanceof NotAGitRepository) return null;
    throw err;
  }
  if (!(await store.exists())) return null;
  const latest = new Map<string, Sighting>();
  let readHere = false;
  const observed = new Set<string>();
  for (const file of await store.list()) {
    const parsed = parseEventFile(file.path, file.content);
    if (!parsed.ok || parsed.kind !== 'verdict') continue;
    const run = (parsed.event['body'] as { run: CheckRun }).run;
    if (run.record.check !== readbackCheck.name || run.record.version !== readbackCheck.version) continue;
    let input: ReadbackInput;
    try {
      input = readbackCheck.parseInput(run.record.input);
    } catch {
      continue; // `seamkit state verify` and `seamkit replay` report broken events; history skips them.
    }
    const first = input.versions[0];
    if (first !== undefined && addresses.has(first.url) && first.status === 'ok') {
      if (first.url === primaryUrl) readHere = true;
      const named = first.commit ?? first.reported;
      if (named !== undefined && COMMIT_ID.test(named)) observed.add(named);
    }
    for (const s of readbackSightings(input, parsed.id)) {
      if (!commits.has(s.change)) continue;
      const key = `${s.change} ${s.marker}`;
      const prev = latest.get(key);
      if (prev === undefined || s.at > prev.at || (s.at === prev.at && s.event > prev.event)) latest.set(key, s);
    }
  }
  return { sightings: [...latest.values()].sort((a, b) => (a.change + a.marker < b.change + b.marker ? -1 : 1)), readHere, observed: [...observed].sort() };
}

/**
 * Gathers everything readback judges: the changes and their markers from git, the version
 * documents and served files from production, ancestry from git, and earlier sightings from the
 * ledger. Nothing here decides an outcome; the readback check does that from what is returned.
 */
export async function gatherReadback(
  cwd: string,
  req: ReadbackRequest,
  now: () => string,
  http: HttpOptions,
): Promise<{ input: ReadbackInput; context: ReadbackContext }> {
  const repo = await GitRepo.open(cwd);
  const branch = await repo.resolveBranch(req.branch);
  const resolve = (reported: string) => repo.resolve(reported);
  const origin = new URL(req.url).origin;
  const primary =
    req.versionUrl !== undefined
      ? await observeVersion(req.versionUrl, now(), resolve, http)
      : await discoverVersion(origin, now(), resolve, http);

  const runGaps: { item: string; reason: string }[] = [];
  let deployed: string | undefined;
  if (req.deployed !== undefined) {
    const d = await repo.commit(req.deployed);
    if (d === undefined) throw new Error(`there is no commit called ${req.deployed} in this repository; fetch it, or check the --deployed value`);
    deployed = d.commit;
  }
  let commits: GitCommit[];
  let subject: string;
  // The latest changes are cut to --last after scoping; `more` says the branch goes on past those read.
  let window: { more: boolean } | undefined;
  if (req.commit !== undefined) {
    const c = await repo.commit(req.commit);
    if (c === undefined) throw new Error(`there is no commit called ${req.commit} in this repository`);
    commits = [c];
    subject = `commit:${short(c.commit)}`;
  } else {
    // After a deploy, changes left to the next one do not count toward --last, so every change
    // after the deployed commit is read as well as the window.
    const after = deployed !== undefined && req.pr === undefined ? await repo.countFirstParent(branch.head, deployed) : 0;
    const depth = req.pr !== undefined ? Math.max(req.last, PR_SEARCH_DEPTH) : req.last + after;
    // One more than the window is read, so that a gap for older changes is reported only when there are some.
    const history = await repo.firstParent(branch.head, req.pr === undefined ? depth + 1 : depth);
    if (req.pr === undefined) {
      commits = history.slice(0, depth);
      subject = branch.name;
      window = { more: history.length > depth };
    } else {
      commits = history.filter((c) => parseChangeMessage(c.message, c.parents.length).pr === req.pr).slice(0, 1);
      subject = `pr#${req.pr}`;
      if (commits.length === 0) {
        runGaps.push({
          item: `pr#${req.pr}`,
          reason: `not among the last ${history.length} changes on ${branch.name}; it may not be merged yet, or it is older (raise --last)`,
        });
      }
    }
  }
  const shallow = await repo.isShallow();
  if (shallow) runGaps.push({ item: 'history beyond the shallow clone', reason: 'the clone is shallow; run git fetch --unshallow to examine older changes' });

  const subjects = new Set<string>();
  let drafts = commits.map((c) => toChange(c, req.url, primary, subjects));
  const addresses = new Set(req.versionUrl !== undefined ? [primary.url] : VERSION_PATHS.map((p) => new URL(p, origin).href));
  const loaded = await loadHistory(cwd, primary.url, addresses, new Set(drafts.map((c) => c.commit)));
  const history = loaded === null ? null : loaded.sightings;

  if (deployed !== undefined) {
    // Every commit production was seen running at this address, by recorded runs and by this one.
    // A dirty build counts too: this only widens what stays in scope.
    const ran: string[] = [];
    const missing: string[] = [];
    if (loaded !== null && loaded.readHere) {
      const now = primary.status === 'ok' ? (primary.commit ?? primary.reported) : undefined;
      const named = [...new Set([...loaded.observed, ...(now !== undefined && COMMIT_ID.test(now) ? [now] : [])])];
      const full = await repo.resolveAll(named);
      named.forEach((n, i) => {
        const id = full[i];
        if (id === undefined) missing.push(n);
        else ran.push(id);
      });
    }
    if (loaded === null || !loaded.readHere || missing.length > 0) {
      // Without a run that read this address, a change still on its way looks exactly like one a
      // rollback removed, so nothing is scoped out: a false fail can be retried, a false pass hides
      // a rollback. A ledger just started, or one kept for another address, is in the same place,
      // and so is one that saw production run a commit this repository cannot place.
      const because =
        loaded === null
          ? 'no ledger was read, so'
          : !loaded.readHere
            ? 'the ledger holds no earlier run that read this address, so'
            : `production at this address was seen running ${missing.map(short).join(', ')}, which this repository does not have (fetch the branch it came from), so`;
      runGaps.push({
        item: 'whether changes merged after the deployed commit are still on their way',
        reason: `${because} one still on its way cannot be told from one a rollback removed; every change is judged${loaded === null ? ' (keep a ledger with seamkit state init)' : ''}`,
      });
    } else {
      // Scoping, not judging: which changes this deploy is answerable for. A change seen live at
      // this address before stays in, by the same marker match the check uses, and so does one
      // in any build production was seen running here, so a deploy that drops either fails. The
      // check judges every change that stays.
      const seen = new Set(loaded.sightings.map((s) => `${s.change} ${s.marker}`));
      const wasRunning = await repo.reachableFrom(ran, deployed);
      const afterDeploy = await repo.reachableFrom([branch.head], deployed);
      const kept: typeof drafts = [];
      const later: string[] = [];
      for (const d of drafts) {
        const seenHere = d.markers.some((m) => seen.has(`${d.commit} ${markerKey(m)}`));
        if (!afterDeploy.has(d.commit) || seenHere || wasRunning.has(d.commit)) kept.push(d);
        else later.push(d.subject);
      }
      if (later.length > 0) {
        const listed = later.length > 20 ? `${later.slice(0, 20).join(', ')} and ${later.length - 20} more` : later.join(', ');
        const them = later.length === 1 ? 'it' : 'them';
        runGaps.push({
          item: `${later.length} change${later.length === 1 ? '' : 's'} merged after the deployed commit ${short(deployed)}`,
          reason: `production at this address was never seen running ${them}, so the next deploy proves ${them}: ${listed}`,
        });
      }
      drafts = kept;
    }
  }
  if (window !== undefined) {
    if (drafts.length > req.last || window.more) runGaps.push({ item: `changes before the last ${req.last} on ${branch.name}`, reason: 'outside --last' });
    drafts = drafts.slice(0, req.last);
  }
  const changes: ReadbackChange[] = drafts.map(({ cardFound: _, ...change }) => change);

  const versions: VersionObservation[] = [primary];
  const markerUrls = new Set(changes.flatMap((c) => c.markers.flatMap((m) => (m.kind === 'version' ? [m.url] : []))));
  for (const url of [...markerUrls].sort()) {
    if (url !== primary.url) versions.push(await observeVersion(url, now(), resolve, http));
  }

  const texts = new Map<string, Set<string>>();
  for (const m of changes.flatMap((c) => c.markers)) {
    if (m.kind !== 'bundle') continue;
    const set = texts.get(m.url) ?? new Set<string>();
    set.add(m.text);
    texts.set(m.url, set);
  }
  const bundles: BundleObservation[] = [];
  for (const [url, set] of [...texts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const obs = await observeBundle(url, [...set], now(), http);
    // The version document of the page's own origin explains an absent marker and exposes a contradicted one.
    const sameOrigin = versions.filter((v) => new URL(v.url).origin === new URL(url).origin);
    const context = sameOrigin.find((v) => v === primary) ?? sameOrigin[0];
    if (context !== undefined) obs.versionUrl = context.url;
    bundles.push(obs);
  }

  const ancestry: AncestryFact[] = [];
  const running = [...new Set(versions.flatMap((v) => (v.status === 'ok' && v.commit !== undefined ? [v.commit] : [])))];
  for (const r of running) {
    for (const c of changes) {
      const answer = await repo.contains(r, c.commit);
      ancestry.push(answer.reason === undefined ? { change: c.commit, running: r, contains: answer.contains } : { change: c.commit, running: r, contains: answer.contains, reason: answer.reason });
    }
  }

  const kept = new Set(changes.map((c) => c.commit));
  const input: ReadbackInput = { subject, changes, versions, ancestry, bundles, history: history === null ? null : history.filter((s) => kept.has(s.change)) };
  if (runGaps.length > 0) input.notExamined = runGaps;
  return {
    input,
    context: {
      branch: branch.name,
      primaryVersion: primary,
      shallow,
      ledger: history !== null,
      cards: { found: drafts.filter((d) => d.cardFound).length, broken: drafts.filter((d) => d.cardProblems !== undefined).length },
    },
  };
}

/** What the audit tells you to do about each gap, so that examined nothing becomes a to-do list. */
export function auditAdvice(context: ReadbackContext): string[] {
  const out: string[] = [];
  const v = context.primaryVersion;
  if (v.status === 'unreadable') {
    out.push(
      `Production does not say which version it runs (${v.reason ?? 'unreadable'}). Serve a version document: run "seamkit stamp --out <your public directory>/version.json" before the build, or answer /api/version with {"commit": "<full commit id>"}.`,
    );
  } else if (v.commit === undefined) {
    out.push(`Production reports ${v.reported ?? '?'}, which this clone does not have. Run git fetch; if it is still missing, the build was made from a commit that was never pushed.`);
  } else if (v.dirty === true) {
    out.push(`Production's build of ${short(v.commit)} was made with uncommitted changes, so its version proves nothing. Deploy from a clean commit.`);
  }
  if (context.shallow) out.push('This clone is shallow. Run git fetch --unshallow so older changes can be examined.');
  if (!context.ledger) {
    out.push('There is no ledger yet. Run "seamkit state init" so that later runs can tell a change that left production (not live) from one that never arrived (not proven).');
  }
  if (context.cards.broken > 0) {
    out.push(`${context.cards.broken} change${context.cards.broken === 1 ? ' has a card' : 's have cards'} that cannot be used; each is listed above with its problems.`);
  }
  if (context.cards.found === 0) {
    out.push(
      'No change carries a seamkit-card, so changes are proven by version alone. A card in a pull request description lets the change name text that production must serve, and it reaches the history only when the default commit message for merges is "Pull request title and description" (on GitHub: Settings, General, Pull Requests, for merge commits and squash merging alike).',
    );
  }
  return out;
}
