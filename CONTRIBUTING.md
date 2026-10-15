# Contributing to herdr-mcp

Thanks for helping out. herdr-mcp follows the engineering principles in [AGENTS.md](AGENTS.md): Matt Pocock's skills (pinned to v1.3.1 in `.agents/skills/`) plus a short house layer. Please read it before opening a PR. It applies to humans as much as to coding agents.

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/herdr-mcp.git
cd herdr-mcp
npm ci
npm run build
npm test
```

Use Node.js 20 or newer. `npm run dev` rebuilds on change.

## Where things live

| Path | Owns |
|---|---|
| `src/herdr.ts` | Running herdr: argv, operand validation, timeouts, output caps, cancellation, error mapping |
| `src/server.ts` | The MCP tools: names, schemas, annotations, and the write gate |
| `src/config.ts` | Reading `HERDR_MCP_*` environment variables |
| `src/test/fake-herdr.ts` | A fake herdr binary that enforces herdr 0.9.5's argument grammar |
| `skills/herdr/SKILL.md` | What assistants are taught about using the tools |

## Tests

Write the failing test first, at an existing seam: through the MCP client in `src/test/server.test.ts`, or through `HerdrClient` in `src/test/herdr.test.ts`. Assert on what a caller can see, such as tool results and the exact argv herdr received, not on internals.

If your change uses a herdr flag or command herdr-mcp hasn't used before, confirm it against the real CLI (`herdr <command> --help`) and add it to the fake's grammar. That keeps the fake honest about what herdr accepts.

With herdr installed and running, `npm run smoke` checks every read-only tool end to end.

## Pull requests

- `npm run build`, `npm test`, and `npm run typecheck` pass.
- Tool names stay stable. New inputs are optional.
- `README.md` and `skills/herdr/SKILL.md` change in the same PR as the behavior they describe.
- The description says what changed and how you verified it.

## Security

These are hard rules. A PR that breaks one won't be merged:

- No arbitrary command execution, and no shell strings. herdr runs with an argument array and `shell: false`.
- Every value placed in herdr's argv is validated so it can't be read as a flag.
- Anything that changes state is a write tool, registered only when `HERDR_MCP_ALLOW_WRITE=1`.

If you find a vulnerability, report it privately to the maintainer instead of opening a public issue.
