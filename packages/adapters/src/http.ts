/**
 * Bounded, read-only HTTP for adapters. Every request has a timeout and a size cap, and a failure
 * is described by its status or network error, never by the body a server returned, so nothing a
 * server says is echoed into a verdict.
 */
export interface HttpOptions {
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export type Fetched =
  | { ok: true; status: number; contentType: string; body: Buffer }
  | { ok: false; status?: number; reason: string };

export const DEFAULT_TIMEOUT_MS = 10_000;

function networkReason(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `no response within ${timeoutMs / 1000} s`;
  const code = e?.cause?.code;
  return code ? `could not connect (${code})` : 'could not connect';
}

export async function fetchLimited(url: string, opts: HttpOptions & { accept?: string } = {}): Promise<Fetched> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': opts.userAgent ?? 'seamkit', accept: opts.accept ?? '*/*' },
    });
  } catch (err) {
    return { ok: false, reason: networkReason(err, timeoutMs) };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, reason: `larger than ${maxBytes} bytes` };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    if (res.body !== null) {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          await res.body.cancel().catch(() => undefined);
          return { ok: false, status: res.status, reason: `larger than ${maxBytes} bytes` };
        }
        chunks.push(Buffer.from(chunk));
      }
    }
  } catch (err) {
    return { ok: false, status: res.status, reason: `the response stopped: ${networkReason(err, timeoutMs)}` };
  }
  return { ok: true, status: res.status, contentType: (res.headers.get('content-type') ?? '').toLowerCase(), body: Buffer.concat(chunks) };
}

/** True for a response a browser would render as a page rather than read as data. */
export function isHtml(f: { contentType: string; body: Buffer }): boolean {
  if (f.contentType.startsWith('text/html')) return true;
  const head = f.body.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}
