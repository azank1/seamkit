# Use seamkit from an MCP client

`seamkit mcp` serves seamkit's read-only commands as tools to any client that speaks the Model Context Protocol, such
as Claude Code, Cursor, Codex or a local model loop. It runs on your machine over standard input and output, one
server per repository, and answers about the repository it was started in.

```sh
npx seamkit mcp --url https://your.app
```

In Claude Code, the plugin in this repository sets it up:

```text
/plugin marketplace add azank1/seamkit
/plugin install seamkit@seamkit
```

It adds the server, which Claude Code names `plugin:seamkit:seamkit`, and a `shipped` skill that tells the agent to
treat a change as shipped only on exit code 0. The skill is advice; the verdict comes from seamkit either way.

The server answers about the repository the session is in, so give each repository its own production address, in
that repository's `.claude/settings.json`:

```json
{ "env": { "SEAMKIT_URL": "https://your.app" } }
```

The plugin also offers a `production_url` option, which Claude Code asks for when the plugin is enabled and which
applies wherever the repository sets no `SEAMKIT_URL`; from a shell or CI, set it with
`claude plugin install seamkit@seamkit --config production_url=https://your.app`. With neither, the server still
starts, and its tools refuse, saying that it was started without a production address.

Other clients start the server from a configuration entry, for example:

```json
{
  "mcpServers": {
    "seamkit": {
      "command": "npx",
      "args": ["-y", "seamkit@0.3.0", "mcp", "--url", "https://your.app"]
    }
  }
}
```

The MCP server ships in the release after 0.2.0, planned as 0.3.0, which is not yet published, and the plugin pins
that version. Until then, run it from a clone with `node packages/cli/bin/seamkit.js mcp --url https://your.app` after
`npm ci && npm run build`.

The server speaks every published revision of the protocol: 2026-07-28, where each request names its revision and
there is no opening handshake, and 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05, which open with `initialize`. It
was checked end to end with Claude Code as the client: asked to run an audit of seamkit's own research page, it called
`audit` and received `outcome: pass`, `exitCode: 0` and the four verdicts.

## Tools

| Tool | The same as | What it answers |
|---|---|---|
| `audit` | `seamkit audit --json --no-record` | is each of the latest merged changes live, with advice for every gap |
| `readback` | `seamkit readback --json --no-record` | is one pull request, one commit, or one deploy live |
| `replay` | `seamkit replay --json` | do the recorded verdicts recompute byte for byte |
| `ledger_verify` | `seamkit state verify --json` | does every ledger file match the SHA-256 in its name |

Each answer is the CLI's JSON, byte for byte, as both the text of the result and its structured content, so an agent
reads `outcome` and `exitCode` exactly as a script would. A fail, a not proven or an examined nothing is an answer, not
a tool error: only a call that produced no verdict, such as one with a bad argument, is marked as an error. The
instruction for an agent stays the one in the README: a change is shipped only when `exitCode` is 0.

A test runs at least 30 questions through both the CLI and the MCP server against the demo's history and fails on any
byte that differs.

## What the server can and cannot do

Every tool is read-only, and the server is built so that this holds whatever an agent sends it.

- **It records nothing.** `audit` and `readback` always run with `--no-record`, so the `seamkit/state` ledger is read
  but never written. Record from CI, where the run that counts happens.
- **An agent cannot choose what it reads.** The production addresses come from `--url` (repeat it for several) or
  `SEAMKIT_URL`, and a tool call can only pick one of them, so an address an agent found in a page, an issue or a pull
  request cannot make seamkit read an internal service. With one address, a call names none; with several, it names
  one; with none, every tool that reads production refuses. Beyond the address itself, seamkit reads what the CLI
  reads: the redirects production answers with, the scripts and styles its page loads, and the absolute URLs that the
  cards of merged changes name. Those come from production and from your merged history, not from the agent.
- **It checks every argument before running anything.** Commit ids must be hex, branch names a plain branch name,
  numbers whole and in range, and unknown arguments are refused, so text cannot turn into a command-line option.
- **It holds no credential** and needs none: it reads production with HTTP `GET` requests, as the CLI does, and reads
  the repository's history and ledger from the checkout.

Like the CLI, it reads the ledger as the checkout has it. Run `seamkit state sync --no-push` to bring in what CI
recorded before asking about a rollback.

## Tool definitions for model APIs

The same tools, for a loop that calls a model API directly instead of going through MCP:

```sh
npx seamkit tools --format openai      # Chat Completions function tools, strict mode
npx seamkit tools --format anthropic   # Messages API tools
npx seamkit tools --format gemini      # Gemini function declarations
npx seamkit tools --format mcp         # what tools/list returns
```

Every format comes from one definition and uses only strings and integers. Every field is listed as required, and an
optional one accepts null, so strict schema modes take the definitions as they are, and none uses `oneOf` or `anyOf`.
Limits that strict modes do not take, such as the range of `last`, are stated in the descriptions. These formats leave
out the production address: the loop that runs the model supplies it, so run each call as the CLI command in the
table above with your own `--url`, and never one the model wrote.

Back to the [README](../README.md).
