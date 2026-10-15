---
name: herdr
description: |
  Monitor and control AI coding agents running in Herdr terminal workspaces.
  Use when the user asks about their running agents, wants to check agent status,
  read agent output, or (with explicit permission) start new agents or send them prompts.
---

# Herdr Skill

Control and monitor AI coding agents running in [Herdr](https://herdr.dev), a terminal workspace manager.

## When to use this skill

- User asks about their running agents ("what agents do I have?", "is the reviewer done?")
- User wants to check agent status or read output
- User explicitly asks to start a new agent or send a prompt to one
- User mentions herdr, workspaces, tabs, or panes in a herdr context

## Monitor first

**Always check before acting.** Before starting new agents or sending prompts, use read-only tools to understand the current state:

1. `herdr_status` — Verify herdr is running
2. `herdr_agent_list` — See all agents with their status (idle/working/blocked/done/unknown)
3. `herdr_agent_read` — Read recent output to understand what an agent has been doing

## Agent states

| State | Meaning |
|-------|---------|
| `idle` | Ready for input |
| `working` | Actively processing |
| `blocked` | Waiting at an approval or question dialog; needs a human decision |
| `done` | Finished a turn and ready for input, but nobody has looked at it yet |
| `unknown` | An agent is present but herdr can't classify it. This does not mean its work succeeded |

## Read-only tools (always available)

- `herdr_status` — Check herdr server status
- `herdr_workspace_list` — List workspaces
- `herdr_tab_list` — List tabs (layout containers)
- `herdr_pane_list` — List panes (terminal instances)
- `herdr_agent_list` — List all recognized agents with status
- `herdr_agent_get` — Get detailed info about one agent
- `herdr_agent_read` — Read terminal output (use `lines: 100` for more context)
- `herdr_agent_wait` — Wait for an agent to reach a state

## Write tools (only offered when HERDR_MCP_ALLOW_WRITE=1)

Write mode is off by default, and while it's off these tools don't appear in your tool list at all. If the user asks for a write action and the tools are missing, tell them write mode is off and that they can enable it by setting `HERDR_MCP_ALLOW_WRITE=1` in the plugin or MCP settings. Don't look for a workaround.

- `herdr_tab_create` — Create a tab whose root pane is an empty shell. It doesn't take focus unless `focus: true`
- `herdr_agent_start` — Start an agent in a pane
- `herdr_agent_prompt` — Send a prompt to an agent
- `herdr_agent_send_keys` — Send key presses, space-separated (`esc`, `ctrl+c`, `down enter`)
- `herdr_agent_rename` — Rename an agent
- `herdr_pane_close` — Close a pane and kill whatever runs in it

## The start-then-prompt recipe

To spin up a new agent and give it work:

```
1. herdr_tab_create
   → Returns root_pane with pane_id (e.g., "w1:p5")

2. herdr_agent_start
   name: "reviewer"
   kind: "claude"
   pane_id: "w1:p5"
   → Agent starts and becomes idle

3. herdr_agent_prompt
   agent: "reviewer"
   prompt: "Review the current diff..."
   wait: true
   → Sends prompt, waits for completion
```

## Critical caveats

### Pane must be at shell prompt

`herdr_agent_start` requires an **available shell pane** — the shell must be at its interactive prompt with no foreground command, editor, or agent running. If you try to start an agent in a pane that already has something running, it will fail.

Always create a fresh tab/pane with `herdr_tab_create` before starting an agent.

### Ask the human before prompting agents

**Never send prompts to agents without the user's explicit request.** Agents run on the user's machine and may incur costs, make changes, or interact with production systems. 

Before using `herdr_agent_prompt`:
- Confirm the user wants to send that specific prompt
- Show them what you're about to send
- Get explicit approval

This also applies to `herdr_agent_send_keys` — don't send 'y' to approve dialogs without asking the user first.

### Blocked agents need human attention

When an agent is `blocked`, it's waiting at an approval dialog or question. Read the agent's output with `herdr_agent_read` to see what it's asking, then:

1. Tell the user what the agent is asking
2. Let the user decide how to respond
3. Only send keys/response with explicit user approval

### Timeouts

- `herdr_agent_wait` and `herdr_agent_prompt` with `wait: true` default to a 2-minute timeout
- For long-running tasks, use `timeout_ms` up to 300000 (5 minutes). `timeout_ms` only applies when `wait` is true
- A `timeout` or `agent_prompt_stalled` error doesn't prove the prompt was lost. Check `herdr_agent_get` or `herdr_agent_read` before retrying, so you don't send it twice

## Example workflows

### Check on all agents

```
User: "What's the status of my agents?"

1. herdr_agent_list
   → Returns list with status for each agent

2. For any blocked/interesting agents, herdr_agent_read
   → Show user what they're doing
```

### Start a new agent (with user permission)

```
User: "Start a claude agent to review my PR"

1. herdr_tab_create → get pane_id
2. herdr_agent_start with kind="claude", a descriptive name
3. Confirm with user: "Agent started. Shall I send it the review prompt?"
4. Only after user confirms: herdr_agent_prompt
```

### Wait for an agent to finish

```
User: "Wait for the feature-agent to be done"

1. herdr_agent_wait agent="feature-agent"
   → Returns when agent is idle/done/blocked

2. herdr_agent_read to see the result
3. Report to user
```

## Error handling

| Error code | Meaning | What to do |
|------------|---------|------------|
| `herdr_not_found` | herdr isn't installed or isn't on PATH | Tell the user to install it from herdr.dev |
| `server_not_running` | No herdr server is running | Tell the user to start herdr |
| `agent_not_found` | No live agent has that name or pane ID | Run `herdr_agent_list` and use a current name or pane ID |
| `agent_blocked` | Can't prompt; the agent is at a dialog | Read the output and ask the user how to proceed |
| `agent_not_ready` | The agent was blocked during startup | Read its output; it can take prompts once it's idle |
| `agent_prompt_stalled` | Prompt sent, but no activity seen within 5s | Check the agent before retrying |
| `timeout` | herdr or herdr-mcp gave up waiting | Check the agent; it may still be working |
| `cancelled` | The request was cancelled | Nothing to do |
| `invalid_argument` | An input failed validation before herdr ran | Fix the input; IDs look like `w1`, `w1:t2`, `w1:p3` |
| `cli_syntax_error` | herdr rejected the arguments (e.g. an unsupported agent kind) | Read the message and fix the input |
| `output_too_large` | The output exceeded herdr-mcp's size cap | Ask for fewer `lines` |

## Remote machines

When `HERDR_MCP_MACHINE` is set, every command targets that saved herdr machine over SSH (`herdr machine list` shows the options). IDs and agent names belong to that machine's server, so don't reuse IDs from a local listing.
