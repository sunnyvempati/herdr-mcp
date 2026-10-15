<p align="center">
  <img src="assets/banner.png" alt="herdr-mcp banner" width="800"/>
</p>

<p align="center">
  <strong>Monitor and control your AI coding agents from any assistant</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <a href="https://www.npmjs.com/package/herdr-mcp"><img src="https://img.shields.io/npm/v/herdr-mcp.svg" alt="npm version"/></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-green.svg" alt="MCP Compatible"/></a>
</p>

---

> **"Which of my agents are blocked?"**
>
> ```
> You: Which of my agents are blocked?
>
> Assistant: Let me check your herdr agents...
>
> ┌──────────┬─────────┬────────┐
> │ AGENT    │ STATUS  │ PANE   │
> ├──────────┼─────────┼────────┤
> │ docs     │ blocked │ w2:p1  │
> │ refactor │ blocked │ w1:p3  │
> └──────────┴─────────┴────────┘
>
> Two agents are blocked. "docs" is waiting on a review
> decision in w2:p1. "refactor" hit a merge conflict in
> w1:p3. Want me to prompt either of them?
> ```

---

## Features

| | |
|---|---|
| 🔍 **Monitor** | List agents, check status (idle/working/blocked/done), read recent output |
| 🚀 **Control** | Start agents, send prompts, manage terminal panes |
| 🔒 **Safe by default** | Read-only tools always on; write tools require explicit opt-in |
| 🌐 **Remote support** | Target agents on remote machines via `--machine` |
| 🤖 **Universal** | Works with Grok Bot, Cursor, Claude, and any MCP client |

---

## Quick Install

Every snippet below starts herdr-mcp **read-only**. See [Safety Model](#safety-model) to turn on write tools.

### Grok Bot (X plugin marketplace)

Install the **herdr-mcp** plugin from the Grok Bot marketplace. To let the assistant start or prompt agents, set **Enable write operations** to `1` in the plugin settings.

### Cursor

Add to `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for all projects:

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["-y", "herdr-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add herdr -- npx -y herdr-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["-y", "herdr-mcp"]
    }
  }
}
```

### Any MCP Client

```bash
npx -y herdr-mcp
```

herdr-mcp speaks MCP over stdio and needs the `herdr` binary on `PATH` (Node.js 20+).

---

## Safety Model

**herdr-mcp is read-only by default.** Assistants can watch your agents but can't change anything until you opt in.

| Mode | Tools offered | Enable with |
|------|---------------|-------------|
| **Read-only** (default) | The 8 read tools | Nothing |
| **Read + write** | The 8 read tools plus the 6 write tools | `HERDR_MCP_ALLOW_WRITE=1` (exactly `1`) |

To opt in, add an `env` block to the server config:

```json
"env": { "HERDR_MCP_ALLOW_WRITE": "1" }
```

In read-only mode the write tools aren't registered: they don't appear in the assistant's tool list, and calling one by name fails before herdr ever runs.

- **No shell passthrough.** There is no tool for herdr's `pane run` or `pane send-text`, or anything else that runs an arbitrary command. herdr is launched with an argument array and no shell, so nothing is interpolated.
- **No flag injection.** IDs, agent names, kinds, and keys are validated so they can't be read as herdr options. Prompt text goes in herdr's verbatim text slot, so a prompt like `--wait` stays text.
- **Bounded calls.** Every herdr call has a timeout (5 minutes at most for waits), a 256 KiB output cap, and is cancelled when the client cancels the request. A herdr process that ignores SIGTERM gets SIGKILL.
- **Tool annotations.** Read tools are marked `readOnlyHint`. `herdr_agent_prompt`, `herdr_agent_send_keys`, and `herdr_pane_close` are marked `destructiveHint`, so clients that honor annotations can ask before running them.

One caveat for write mode: `herdr_agent_start` passes `agent_args` straight through to the agent's own CLI. Those can include flags that loosen the agent's safety settings, so only approve args you'd type yourself.

---

## Tools

Tool names are stable across releases.

### Read-only tools (always offered)

| Tool | Description |
|------|-------------|
| `herdr_status` | Check that the herdr server is running and report its version |
| `herdr_workspace_list` | List workspaces |
| `herdr_tab_list` | List tabs, optionally in one workspace |
| `herdr_pane_list` | List panes, optionally in one workspace |
| `herdr_agent_list` | List agents with status (idle/working/blocked/done/unknown) |
| `herdr_agent_get` | Get one agent's status, pane, cwd, and session info |
| `herdr_agent_read` | Read recent terminal output from an agent as plain text |
| `herdr_agent_wait` | Wait until an agent reaches a status, with a timeout |

### Write tools (offered only with `HERDR_MCP_ALLOW_WRITE=1`)

| Tool | Description |
|------|-------------|
| `herdr_tab_create` | Create a tab whose root pane is an empty shell; doesn't take focus unless `focus: true` |
| `herdr_agent_start` | Start an agent (`claude`, `codex`, `cursor`, `grok`, ...) in a pane at a shell prompt |
| `herdr_agent_prompt` | Send a prompt to an agent, optionally waiting for it to settle |
| `herdr_agent_send_keys` | Send key presses such as `esc`, `ctrl+c`, or `down enter` |
| `herdr_agent_rename` | Rename an agent |
| `herdr_pane_close` | Close a pane and kill whatever runs in it |

---

## Remote Machines

Point herdr-mcp at a machine you've saved in herdr (`herdr machine add`, then `herdr machine list`):

```json
{
  "mcpServers": {
    "herdr-workbox": {
      "command": "npx",
      "args": ["-y", "herdr-mcp"],
      "env": {
        "HERDR_MCP_MACHINE": "Build machine"
      }
    }
  }
}
```

Every command is sent as `herdr --machine "Build machine" ...`, which herdr forwards over SSH to that machine's server. The value must be a saved profile label or ID, not a hostname. Workspace, pane, and agent IDs belong to that machine. To watch several machines, add one server entry per machine.

---

## Usage Patterns

### Monitor-first approach

Always check agent status before taking action:

```
1. herdr_agent_list → see all agents and their states
2. herdr_agent_read → check what an agent has been doing
3. herdr_agent_prompt → only if needed, with human approval
```

### Start-then-prompt recipe

When the user asks for a new agent:

```
1. herdr_tab_create  → returns root_pane.pane_id, an empty shell
2. herdr_agent_start → returns once the agent is ready for input
3. herdr_agent_prompt → send the task the user approved
```

### Critical caveat

**The target pane must be at an idle shell prompt before `herdr_agent_start`.** herdr refuses to start an agent in a pane that's running anything else, so create a fresh tab first.

The bundled [`skills/herdr/SKILL.md`](skills/herdr/SKILL.md) teaches assistants these patterns, along with herdr's error codes and when to ask a human.

---

## Development

```bash
git clone https://github.com/sunnyvempati/herdr-mcp.git
cd herdr-mcp
npm ci
npm run build
npm test            # MCP-surface and runner tests against a fake herdr
npm run typecheck
```

The tests drive the built server through the official MCP client. `src/test/fake-herdr.ts` stands in for the herdr binary: it enforces herdr 0.9.5's argument grammar and replies with output captured from real herdr.

### Smoke test (requires herdr with a running server)

```bash
npm run smoke       # or ./scripts/smoke.sh
```

It exercises every read-only tool against your real herdr and never enables write mode. Set `HERDR_MCP_MACHINE` to smoke-test a remote machine.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents (and humans) should read [AGENTS.md](AGENTS.md) for the engineering principles this repo follows.

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>
    <em>herdr</em> is a trademark of its respective owner.<br/>
    <em>Grok Bot</em> is a trademark of xAI.<br/>
    <em>Cursor</em> is a trademark of Anysphere, Inc.<br/>
    <em>Claude</em> is a trademark of Anthropic.<br/>
    This project is not affiliated with or endorsed by any of these companies.
  </sub>
</p>
