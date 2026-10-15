# AGENTS.md

herdr-mcp is an MCP server that lets AI assistants monitor and (with opt-in) control coding agents running in [herdr](https://herdr.dev) terminal panes. It shells out to the `herdr` CLI. Read this file before changing code.

## Engineering baseline: Matt Pocock's skills, v1.3.1

This repo adopts [mattpocock/skills](https://github.com/mattpocock/skills) as its baseline engineering principles, pinned to tag [`v1.3.1`](https://github.com/mattpocock/skills/tree/v1.3.1) (commit `24fe0ef`). The skills are vendored unmodified in `.agents/skills/`, with sources and hashes recorded in `skills-lock.json`.

Read the matching skill before you start:

| When you are | Read |
|---|---|
| Designing or changing a module's interface, or deciding where a seam goes | `.agents/skills/codebase-design/SKILL.md` |
| Adding behavior or fixing a bug (test first, one vertical slice at a time) | `.agents/skills/tdd/SKILL.md` |
| Chasing a bug you can't explain yet | `.agents/skills/diagnosing-bugs/SKILL.md` |
| Reviewing a branch or your own diff before committing | `.agents/skills/code-review/SKILL.md` |
| Looking for architecture improvements | `.agents/skills/improve-codebase-architecture/SKILL.md` |
| Naming a domain concept or recording a decision | `.agents/skills/domain-modeling/SKILL.md` |

Don't edit the vendored files. To move to a newer release, rerun the installer against the new tag, review the diff, and update the version above:

```bash
npx skills@latest add https://github.com/mattpocock/skills/tree/<tag> \
  --skill codebase-design --skill tdd --skill code-review --skill diagnosing-bugs \
  --skill improve-codebase-architecture --skill domain-modeling --agent cursor --copy -y
```

Claude Code reads skills from `.claude/skills/`; add `--agent claude-code` to that command locally if you use it.

Where a skill and the house layer below disagree, the house layer wins.

## House layer

1. **Small, deep modules.** Each module hides one kind of complexity behind a small interface:
   - `src/herdr.ts` owns everything about running herdr: argv construction, operand validation, timeouts, output caps, cancellation, and mapping herdr's exit codes and JSON error envelopes. New herdr commands become `HerdrClient` methods here.
   - `src/server.ts` owns the MCP surface: tool names, schemas, descriptions, annotations, and the write gate.
   - `src/config.ts` turns the environment into a `Config` once, at startup.
   - `src/index.ts` only wires them together.
2. **Typed errors.** Expected failures are `Result` values carrying a `HerdrError` with a `code`; don't throw for them. herdr's own codes (`agent_not_found`, `agent_blocked`, ...) pass through unchanged. A new client-side code goes in `ClientErrorCode` and in the error table in `skills/herdr/SKILL.md`.
3. **No shell-string interpolation.** Run herdr with `spawn(bin, argv, { shell: false })` only. Every positional operand is checked against a pattern that can't start with `-`. Prompt text goes in herdr's verbatim text slot with our flags after it; never put `--` before it, because herdr reads `--` there as prompt text. Never expose `pane run`, `pane send-text`, or anything else that runs an arbitrary command.
4. **Read-only by default.** Write tools are registered only when `HERDR_MCP_ALLOW_WRITE` is exactly `1`; otherwise they don't exist. Any tool that changes state goes in the write block. Set `readOnlyHint` on read tools and set `destructiveHint` honestly on write tools.
5. **Bounded calls.** Every herdr call has a process timeout, a per-stream output cap, and is cancelled when the MCP request is.
6. **Tests with fakes.** Test through the interfaces callers use: the MCP client in `src/test/server.test.ts`, and `HerdrClient` in `src/test/herdr.test.ts`. The only fake is `src/test/fake-herdr.ts`, a stand-in for the herdr binary that enforces herdr 0.9.5's argument grammar and replies with output captured from real herdr. When you use a new herdr flag, confirm it against the real CLI (`herdr <command> --help` or herdr's CLI reference) and add it to the fake's grammar. Don't mock our own modules.
7. **Keep the README in sync.** A change to a tool, input, environment variable, or safety behavior updates `README.md` and `skills/herdr/SKILL.md` in the same commit.
8. **Tool names are public API.** Don't rename or remove them. Add inputs as optional; deprecate rather than delete.

## Commands

```bash
npm ci                 # install
npm run build          # clean build to build/
npm test               # unit and MCP-surface tests against the fake herdr
npm run typecheck
npm run smoke          # read-only end-to-end check against your real herdr
npm run render:assets  # re-render assets/*.png from the SVGs
```

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `sunnyvempati/herdr-mcp`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` and `docs/adr/` at the repo root, created when first needed. See `docs/agents/domain.md`.
