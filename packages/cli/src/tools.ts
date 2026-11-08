// The read-only tools seamkit offers to agents, defined once. The MCP server lists them, and
// `seamkit tools --format <host>` writes the same definitions for model APIs that call tools
// directly. Every parameter is a string or an integer; an optional one is listed as required and
// nullable, so strict schema modes accept it, and no schema uses oneOf or anyOf.

export interface Param {
  name: string;
  type: 'string' | 'integer';
  description: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  params: readonly Param[];
  /** The CLI arguments this call stands for, always with --json, and never one that records. */
  argv(args: Readonly<Record<string, string | number | null>>, url: string | undefined): string[];
}

const URL_PARAM: Param = {
  name: 'url',
  type: 'string',
  description: 'The production address to read, one of those the server was started with. Null for the only one.',
};
const LAST: Param = { name: 'last', type: 'integer', description: 'How many of the latest merged changes to judge. Null for 20.', minimum: 1, maximum: 1000 };
const BRANCH: Param = {
  name: 'branch',
  type: 'string',
  description: 'The branch whose history is judged, such as main. Null for the default branch.',
  pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$',
};
const COMMIT = '^[0-9a-f]{7,64}$';

const flag = (name: string, value: string | number | null | undefined): string[] =>
  value === null || value === undefined ? [] : [`--${name}`, String(value)];

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'audit',
    title: 'Audit production',
    description:
      'Reads production back read-only and judges each of the latest merged changes as live, not live, not proven or nothing to prove, with advice for every gap. ' +
      'Returns the same JSON as "seamkit audit --json". exitCode 0 is a pass; 1 a fail; 3 examined nothing, never a pass; 4 stops for a human. Records nothing.',
    params: [URL_PARAM, LAST, BRANCH],
    argv: (a, url) => ['audit', '--json', '--no-record', ...flag('url', url), ...flag('last', a['last']), ...flag('branch', a['branch'])],
  },
  {
    name: 'readback',
    title: 'Read back one change or deploy',
    description:
      'Reads production back read-only for one merged pull request (pr), one commit, or the latest changes, and says whether each is live. ' +
      'deployed names the commit a deploy just shipped, so changes merged after it are left to the next deploy. ' +
      'Returns the same JSON as "seamkit readback --json"; a change is shipped only when exitCode is 0. Records nothing.',
    params: [
      URL_PARAM,
      { name: 'pr', type: 'integer', description: 'A merged pull request number. Null for none.', minimum: 1, maximum: 2147483647 },
      { name: 'commit', type: 'string', description: 'A full or abbreviated commit id (hex). Null for none. Not with pr.', pattern: COMMIT },
      LAST,
      BRANCH,
      { name: 'deployed', type: 'string', description: 'The commit id (hex) the deploy shipped. Null when not judging a deploy.', pattern: COMMIT },
    ],
    argv: (a, url) => [
      'readback', '--json', '--no-record', ...flag('url', url), ...flag('pr', a['pr']), ...flag('commit', a['commit']),
      ...flag('last', a['last']), ...flag('branch', a['branch']), ...flag('deployed', a['deployed']),
    ],
  },
  {
    name: 'replay',
    title: 'Replay recorded verdicts',
    description:
      'Recomputes every verdict recorded on the seamkit/state ledger from its recorded observations and fails if any comes out differently. ' +
      'Returns the same JSON as "seamkit replay --json". Reads the ledger as this checkout has it.',
    params: [{ name: 'event', type: 'string', description: 'The id prefix (hex) of one recorded event. Null for all.', pattern: '^[0-9a-f]{4,64}$' }],
    argv: (a) => ['replay', '--json', ...(a['event'] === null || a['event'] === undefined ? [] : [String(a['event'])])],
  },
  {
    name: 'ledger_verify',
    title: 'Verify the ledger',
    description: 'Checks every file on the seamkit/state ledger against the SHA-256 in its name. Returns the same JSON as "seamkit state verify --json".',
    params: [],
    argv: () => ['state', 'verify', '--json'],
  },
];

/**
 * The JSON Schema of a tool's arguments: every property required, optional ones nullable. With
 * `constraints`, limits and patterns are included (MCP); model APIs' strict modes reject some of
 * them, so for those the limits are stated in the description and the server checks them.
 */
export function jsonSchema(tool: ToolDef, constraints = true): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const params = constraints ? tool.params : modelParams(tool);
  for (const p of params) {
    properties[p.name] = {
      type: [p.type, 'null'],
      description: constraints ? p.description : describe(p),
      ...(constraints && p.minimum !== undefined ? { minimum: p.minimum } : {}),
      ...(constraints && p.maximum !== undefined ? { maximum: p.maximum } : {}),
      ...(constraints && p.pattern !== undefined ? { pattern: p.pattern } : {}),
    };
  }
  return { type: 'object', properties, required: params.map((p) => p.name), additionalProperties: false };
}

/**
 * The parameters a model API sees. The production address is left out: whoever runs the loop
 * supplies it, as the MCP server's operator does with --url, so a model cannot choose what to read.
 */
export function modelParams(tool: ToolDef): readonly Param[] {
  return tool.params.filter((p) => p.name !== 'url');
}

/** A parameter's description with its limits in words, for formats that carry no limits. */
function describe(p: Param): string {
  if (p.minimum !== undefined && p.maximum !== undefined) return `${p.description} From ${p.minimum} to ${p.maximum}.`;
  return p.description;
}

/**
 * Checks call arguments against a tool's parameters. Missing and null both mean "not given".
 * Returns the problem, or undefined when the arguments are acceptable.
 */
export function checkArguments(tool: ToolDef, args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const key of Object.keys(args)) if (!tool.params.some((p) => p.name === key)) return `unknown argument ${JSON.stringify(key).slice(0, 80)}`;
  for (const p of tool.params) {
    const v = (args as Record<string, unknown>)[p.name];
    if (v === undefined || v === null) continue;
    if (p.type === 'integer') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return `${p.name} must be an integer`;
      if ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum)) return `${p.name} must be from ${p.minimum} to ${p.maximum}`;
    } else {
      if (typeof v !== 'string') return `${p.name} must be a string`;
      if (p.pattern !== undefined && !new RegExp(p.pattern).test(v)) return `${p.name} does not have the form ${p.pattern}`;
    }
  }
  return undefined;
}

export const FORMATS = ['mcp', 'openai', 'anthropic', 'gemini'] as const;
export type Format = (typeof FORMATS)[number];

const annotations = (tool: ToolDef): Record<string, unknown> => ({
  title: tool.title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
});

/** The tools in one host's format, deterministic for a given seamkit version. */
export function toolsIn(format: Format): unknown {
  switch (format) {
    case 'mcp':
      return TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: jsonSchema(t), annotations: annotations(t) }));
    case 'openai':
      return TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: jsonSchema(t, false), strict: true } }));
    case 'anthropic':
      return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: jsonSchema(t, false) }));
    case 'gemini':
      return [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, ...(modelParams(t).length > 0 ? { parameters: geminiSchema(t) } : {}) })) }];
  }
}

// Gemini's function declarations (generateContent) take an OpenAPI subset: one type per field,
// upper case, and nullable instead of a type list, with no additionalProperties.
function geminiSchema(tool: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const params = modelParams(tool);
  for (const p of params) {
    properties[p.name] = {
      type: p.type === 'integer' ? 'INTEGER' : 'STRING',
      description: describe(p),
      nullable: true,
    };
  }
  return { type: 'OBJECT', properties, required: params.map((p) => p.name) };
}
