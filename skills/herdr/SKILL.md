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
| `idle` | Agent is ready for input, hasn't completed a task yet |
| `working` | Agent is actively processing |
| `blocked` | Agent is waiting at an approval or question dialog |
| `done` | Agent completed its task and is ready for new input |
| `unknown` | Agent is present but herdr cannot classify its state |

## Read-only tools (always available)

- `herdr_status` — Check herdr server status
- `herdr_workspace_list` — List workspaces
- `herdr_tab_list` — List tabs (layout containers)
- `herdr_pane_list` — List panes (terminal instances)
- `herdr_agent_list` — List all recognized agents with status
- `herdr_agent_get` — Get detailed info about one agent
- `herdr_agent_read` — Read terminal output (use `lines: 100` for more context)
- `herdr_agent_wait` — Wait for an agent to reach a state

## Write tools (require HERDR_MCP_ALLOW_WRITE=1)

Write operations are disabled by default for safety. When enabled:

- `herdr_tab_create` — Create a new tab with an empty shell pane
- `herdr_agent_start` — Start an agent in a pane
- `herdr_agent_prompt` — Send a prompt to an agent
- `herdr_agent_send_keys` — Send key sequences (esc, ctrl+c, enter)
- `herdr_agent_rename` — Rename an agent
- `herdr_pane_close` — Close a pane

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

- `herdr_agent_wait` and `herdr_agent_prompt --wait` have a default 2-minute timeout
- For long-running tasks, use `timeout_ms` up to 300000 (5 minutes)
- If a prompt times out, check `herdr_agent_get` — the agent may still be working

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
| `herdr_not_found` | herdr not installed | Tell user to install from herdr.dev |
| `server_not_running` | herdr server not running | Tell user to start herdr |
| `agent_blocked` | Can't prompt, agent at dialog | Read output, ask user how to proceed |
| `agent_prompt_stalled` | Prompt sent but no activity | Check agent state, may need retry |
| `timeout` | Operation timed out | Check agent state, it may still be working |

## Remote machines

When `HERDR_MCP_MACHINE` is set, all commands target a remote herdr server via SSH machine forwarding. The machine label must be a saved profile in herdr (`herdr machine list`).
