# herdr-mcp

MCP server for monitoring and controlling AI coding agents running in [Herdr](https://herdr.dev), a terminal workspace manager.

This server lets AI assistants (Grok Bot, Cursor, Claude, etc.) see which agents are idle, working, blocked, or done; read their recent output; and — with explicit opt-in — spin up new agents and send them prompts.

## Features

**Read-only tools (always available):**
- `herdr_status` — Check if herdr server is running
- `herdr_workspace_list` — List all workspaces
- `herdr_tab_list` — List tabs in a workspace
- `herdr_pane_list` — List panes in a workspace
- `herdr_agent_list` — List all recognized AI agents with their status
- `herdr_agent_get` — Get detailed info about a specific agent
- `herdr_agent_read` — Read recent terminal output from an agent
- `herdr_agent_wait` — Wait for an agent to reach a specific state

**Write tools (require explicit opt-in):**
- `herdr_tab_create` — Create a new tab with an empty shell pane
- `herdr_agent_start` — Start a coding agent in a pane
- `herdr_agent_prompt` — Send a prompt/message to an agent
- `herdr_agent_send_keys` — Send key sequences (esc, ctrl+c, etc.)
- `herdr_agent_rename` — Rename an agent
- `herdr_pane_close` — Close a pane (terminates any process in it)

## Prerequisites

- [herdr](https://herdr.dev) installed and running (`herdr` in PATH)
- Node.js 20+

## Installation

```bash
npm install -g herdr-mcp
```

Or run directly with npx:

```bash
npx herdr-mcp
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HERDR_MCP_ALLOW_WRITE` | Set to `1` to enable write operations (tab create, agent start, prompt, send-keys, rename, close). Default: disabled. |
| `HERDR_MCP_MACHINE` | Target a remote herdr server via saved SSH machine label or ID. Uses the same `--machine` option as the herdr CLI. |

### Grok Bot / Cursor (mcp.json)

Create or edit `~/.cursor/mcp.json` (Linux/macOS) or `%APPDATA%\Cursor\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["herdr-mcp"]
    }
  }
}
```

**With write operations enabled:**

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["herdr-mcp"],
      "env": {
        "HERDR_MCP_ALLOW_WRITE": "1"
      }
    }
  }
}
```

**Targeting a remote machine:**

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["herdr-mcp"],
      "env": {
        "HERDR_MCP_MACHINE": "my-server"
      }
    }
  }
}
```

### Claude Desktop (claude_desktop_config.json)

Create or edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["herdr-mcp"]
    }
  }
}
```

### Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "herdr": {
      "command": "npx",
      "args": ["herdr-mcp"]
    }
  }
}
```

Or install globally and reference with absolute path.

## Usage Examples

**Monitor agent activity:**
```
"List all my agents and their status"
→ calls herdr_agent_list
```

**Check what an agent is doing:**
```
"What has the reviewer agent been working on?"
→ calls herdr_agent_read with agent="reviewer", lines=100
```

**Wait for an agent to finish:**
```
"Wait for the feature-agent to become idle"
→ calls herdr_agent_wait with agent="feature-agent"
```

**Start a new agent (requires HERDR_MCP_ALLOW_WRITE=1):**
```
"Create a new tab in workspace w1 and start a claude agent called reviewer"
→ calls herdr_tab_create to get a pane
→ calls herdr_agent_start with name="reviewer", kind="claude", pane_id=<new_pane>
→ calls herdr_agent_prompt to give it initial instructions
```

## Security

**Safe by default:** Write operations are disabled by default. The server can only observe your agents and terminals — it cannot modify anything until you explicitly set `HERDR_MCP_ALLOW_WRITE=1`.

**No arbitrary shell execution:** This server does not expose `pane run` or any way to execute arbitrary shell commands. The only write operations are structured herdr commands.

**Argument safety:** All arguments are passed as arrays to the herdr CLI using `spawn()` — no shell string interpolation that could allow injection.

**Remote access:** When `HERDR_MCP_MACHINE` is set, commands are forwarded to a remote herdr server through herdr's secure SSH machine forwarding. The remote server must already be running and API-compatible.

## Herdr CLI Reference

This server shells out to the `herdr` binary. Key commands it uses:

| Server Call | CLI Command |
|-------------|-------------|
| `herdr_status` | `herdr status --json` |
| `herdr_workspace_list` | `herdr workspace list --json` |
| `herdr_tab_list` | `herdr tab list --json [--workspace ID]` |
| `herdr_pane_list` | `herdr pane list --json [--workspace ID]` |
| `herdr_agent_list` | `herdr agent list` |
| `herdr_agent_get` | `herdr agent get <name>` |
| `herdr_agent_read` | `herdr agent read <name> --source recent-unwrapped --lines N` |
| `herdr_agent_wait` | `herdr agent wait <name> [--until STATE] [--timeout MS]` |
| `herdr_tab_create` | `herdr tab create [--workspace ID] [--cwd PATH]` |
| `herdr_agent_start` | `herdr agent start <name> --kind <kind> --pane <pane_id>` |
| `herdr_agent_prompt` | `herdr agent prompt <name> "message" [--wait] [--timeout MS]` |
| `herdr_agent_send_keys` | `herdr agent send-keys <name> <keys>` |
| `herdr_agent_rename` | `herdr agent rename <name> <new_name>` |
| `herdr_pane_close` | `herdr pane close <pane_id>` |

## Error Codes

| Code | Meaning |
|------|---------|
| `herdr_not_found` | `herdr` binary not in PATH |
| `server_not_running` | herdr server is not running |
| `timeout` | Command timed out |
| `agent_blocked` | Agent is waiting at an approval dialog |
| `agent_not_ready` | Agent started but not yet ready for input |
| `agent_prompt_stalled` | Prompt sent but no activity observed |

## Marketplace Submission

To submit this plugin to the [Grok Bot Plugin Marketplace](https://x.ai/bot/marketplace/submit-a-plugin), you'll need:

1. **Organization handle** — Unique identifier, no spaces or capitals (e.g., `herdrdev`)
2. **Website URL** — Your organization's website (e.g., `herdr.dev`)
3. **Logotype URL** — 1:1 SVG or PNG with a background plate (e.g., `https://herdr.dev/logo.svg`)
4. **Distribution preference** — Choose where to list (Grok Bot, Cursor, or both)

The plugin manifest format for Cursor/Grok Bot uses the MCP server protocol. No additional manifest file is required beyond the `mcp.json` configuration shown above.

## Development

```bash
# Clone and install
git clone https://github.com/herdrdev/herdr-mcp.git
cd herdr-mcp
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode during development
npm run dev
```

## License

MIT
