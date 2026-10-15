import { McpServer, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "./config.js";
import {
  AGENT_KIND_PATTERN,
  AGENT_NAME_PATTERN,
  AGENT_STATUSES,
  CWD_PATTERN,
  ID_PATTERN,
  KEY_PATTERN,
  LABEL_PATTERN,
  MAX_PROMPT_CHARS,
  MAX_READ_LINES,
  MAX_WAIT_MS,
  READ_SOURCES,
  type HerdrClient,
  type Result,
} from "./herdr.js";

export const READ_TOOLS = [
  "herdr_status",
  "herdr_workspace_list",
  "herdr_tab_list",
  "herdr_pane_list",
  "herdr_agent_list",
  "herdr_agent_get",
  "herdr_agent_read",
  "herdr_agent_wait",
] as const;

export const WRITE_TOOLS = [
  "herdr_tab_create",
  "herdr_agent_start",
  "herdr_agent_prompt",
  "herdr_agent_send_keys",
  "herdr_agent_rename",
  "herdr_pane_close",
] as const;

const DEFAULT_READ_LINES = 60;
const DEFAULT_WAIT_MS = 120_000;
const MAX_KEYS = 32;
const MAX_AGENT_ARGS = 16;

const INSTRUCTIONS = `herdr-mcp exposes AI coding agents running in herdr terminal panes.
Monitor first: use herdr_agent_list and herdr_agent_read before acting.
Never prompt an agent, send it keys, or close a pane unless the user explicitly asked for that specific action.
Blocked agents are waiting on a human decision: show the user what the agent is asking instead of answering for them.`;

const agentTarget = z
  .string()
  .regex(ID_PATTERN, "Expected an agent name or pane ID such as 'reviewer' or 'w1:p1'")
  .describe("Agent name (e.g. 'reviewer') or the pane ID hosting the agent (e.g. 'w1:p1').");
const workspaceId = z
  .string()
  .regex(ID_PATTERN, "Expected a workspace ID such as 'w1'")
  .optional();
const paneId = z.string().regex(ID_PATTERN, "Expected a pane ID such as 'w1:p1'");
const agentName = z
  .string()
  .regex(AGENT_NAME_PATTERN, "Must match [a-z][a-z0-9_-]{0,31}");
const waitTimeout = z.number().int().positive().max(MAX_WAIT_MS);

const readOnly: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const write = (hints: { destructive: boolean; idempotent?: boolean }): ToolAnnotations => ({
  readOnlyHint: false,
  destructiveHint: hints.destructive,
  idempotentHint: hints.idempotent ?? false,
  openWorldHint: false,
});

export interface ServerDeps {
  config: Config;
  herdr: HerdrClient;
  version: string;
}

export function createServer({ config, herdr, version }: ServerDeps): McpServer {
  const server = new McpServer({ name: "herdr-mcp", version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "herdr_status",
    {
      title: "herdr status",
      description:
        "Check that the herdr server is running and report its version. Call this first if other herdr tools fail.",
      annotations: readOnly,
    },
    async (ctx) => toToolResult(await herdr.status({ signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_workspace_list",
    {
      title: "List workspaces",
      description:
        "List herdr workspaces. A workspace is a project-level container that owns tabs and panes and rolls up agent states.",
      annotations: readOnly,
    },
    async (ctx) => toToolResult(await herdr.listWorkspaces({ signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_tab_list",
    {
      title: "List tabs",
      description: "List tabs. Tabs are layouts inside a workspace; each contains one or more panes.",
      inputSchema: z.object({
        workspace_id: workspaceId.describe("Workspace ID (e.g. 'w1'). Omit to list tabs in all workspaces."),
      }),
      annotations: readOnly,
    },
    async ({ workspace_id }, ctx) =>
      toToolResult(await herdr.listTabs({ workspaceId: workspace_id }, { signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_pane_list",
    {
      title: "List panes",
      description:
        "List panes. A pane is a real terminal that survives client detach; it may hold a shell, a process, or a coding agent.",
      inputSchema: z.object({
        workspace_id: workspaceId.describe("Workspace ID (e.g. 'w1'). Omit to list panes in all workspaces."),
      }),
      annotations: readOnly,
    },
    async ({ workspace_id }, ctx) =>
      toToolResult(await herdr.listPanes({ workspaceId: workspace_id }, { signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_agent_list",
    {
      title: "List agents",
      description:
        "List the coding agents herdr recognizes, with each agent's status (idle/working/blocked/done/unknown) and pane. The primary monitoring tool.",
      annotations: readOnly,
    },
    async (ctx) => toToolResult(await herdr.listAgents({ signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_agent_get",
    {
      title: "Get agent",
      description: "Get one agent's status, pane location, working directory, terminal title, and session info.",
      inputSchema: z.object({ agent: agentTarget }),
      annotations: readOnly,
    },
    async ({ agent }, ctx) => toToolResult(await herdr.getAgent(agent, { signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_agent_read",
    {
      title: "Read agent output",
      description:
        "Read recent terminal output from an agent's pane as plain text. Use it to see what an agent did, what it is asking, or why it failed.",
      inputSchema: z.object({
        agent: agentTarget,
        source: z
          .enum(READ_SOURCES)
          .optional()
          .describe(
            "'recent-unwrapped' (default; scrollback with soft wraps joined, best for transcripts), 'recent' (scrollback as wrapped), 'visible' (current screen), or 'detection' (snapshot herdr uses to classify agent state)."
          ),
        lines: z
          .number()
          .int()
          .positive()
          .max(MAX_READ_LINES)
          .optional()
          .describe(`Number of terminal rows to read (1-${MAX_READ_LINES}). Default: ${DEFAULT_READ_LINES}.`),
      }),
      annotations: readOnly,
    },
    async ({ agent, source, lines }, ctx) =>
      toToolResult(
        await herdr.readAgent(
          agent,
          { source: source ?? "recent-unwrapped", lines: lines ?? DEFAULT_READ_LINES },
          { signal: ctx.mcpReq.signal }
        )
      )
  );

  server.registerTool(
    "herdr_agent_wait",
    {
      title: "Wait for agent",
      description:
        "Wait until an agent reaches a status. Without 'until', waits for idle, done, or blocked. Returns immediately if the agent already matches.",
      inputSchema: z.object({
        agent: agentTarget,
        until: z
          .enum(AGENT_STATUSES)
          .optional()
          .describe("Status to wait for. Omit to wait for any settled status (idle, done, or blocked)."),
        timeout_ms: waitTimeout
          .optional()
          .describe(`Timeout in milliseconds (max ${MAX_WAIT_MS}). Default: ${DEFAULT_WAIT_MS}.`),
      }),
      annotations: readOnly,
    },
    async ({ agent, until, timeout_ms }, ctx) =>
      toToolResult(
        await herdr.waitAgent(
          agent,
          { until, timeoutMs: timeout_ms ?? DEFAULT_WAIT_MS },
          { signal: ctx.mcpReq.signal }
        )
      )
  );

  if (!config.allowWrite) return server;

  server.registerTool(
    "herdr_tab_create",
    {
      title: "Create tab",
      description:
        "Create a tab in a workspace. Returns the tab and its root pane, which starts at an empty shell prompt ready for herdr_agent_start.",
      inputSchema: z.object({
        workspace_id: workspaceId.describe("Workspace ID (e.g. 'w1'). Omit to use the active workspace."),
        cwd: z
          .string()
          .regex(CWD_PATTERN, "Must be an absolute path or start with '~'")
          .optional()
          .describe("Working directory for the new shell: an absolute path or a path starting with '~'."),
        name: z.string().regex(LABEL_PATTERN, "1-128 characters, no control characters").optional().describe("Tab label."),
        focus: z.boolean().optional().describe("Switch the user's view to the new tab. Default: false."),
        no_focus: z.boolean().optional().describe("Deprecated: new tabs are unfocused unless 'focus' is true."),
      }),
      annotations: write({ destructive: false }),
    },
    async ({ workspace_id, cwd, name, focus, no_focus }, ctx) =>
      toToolResult(
        await herdr.createTab(
          { workspaceId: workspace_id, cwd, label: name, focus: focus === true && no_focus !== true },
          { signal: ctx.mcpReq.signal }
        )
      )
  );

  server.registerTool(
    "herdr_agent_start",
    {
      title: "Start agent",
      description: `Start a coding agent in an existing pane. The pane must be at an interactive shell prompt with nothing running in the foreground.

Recipe: herdr_tab_create to get root_pane.pane_id, then herdr_agent_start in that pane, then (only if the user asked) herdr_agent_prompt.`,
      inputSchema: z.object({
        name: agentName.describe("Unique agent name matching [a-z][a-z0-9_-]{0,31}."),
        kind: z
          .string()
          .regex(AGENT_KIND_PATTERN, "Expected an agent kind such as 'claude'")
          .describe("Agent kind, e.g. 'claude', 'codex', 'cursor', 'gemini', 'grok', 'opencode', 'pi'."),
        pane_id: paneId.describe("Pane ID (e.g. 'w1:p1') at an idle shell prompt."),
        agent_args: z
          .array(z.string().max(2048))
          .max(MAX_AGENT_ARGS)
          .optional()
          .describe("Arguments for the agent's own CLI, passed after '--'. Only pass flags the user asked for."),
      }),
      annotations: write({ destructive: false }),
    },
    async ({ name, kind, pane_id, agent_args }, ctx) =>
      toToolResult(
        await herdr.startAgent({ name, kind, paneId: pane_id, agentArgs: agent_args }, { signal: ctx.mcpReq.signal })
      )
  );

  server.registerTool(
    "herdr_agent_prompt",
    {
      title: "Prompt agent",
      description: `Send a prompt to an agent (pasted, then Enter). Only use when the user asked to send this prompt.

Fails with 'agent_blocked' if the agent is waiting at an approval dialog; read its output and ask the user instead. With wait=true, returns when the agent settles; a timeout does not mean the prompt was lost, so check the agent before retrying.`,
      inputSchema: z.object({
        agent: agentTarget,
        prompt: z.string().min(1).max(MAX_PROMPT_CHARS).describe("Prompt text to send."),
        wait: z.boolean().optional().describe("Wait for the agent to settle (idle/done/blocked). Default: false."),
        timeout_ms: waitTimeout
          .optional()
          .describe(`Timeout in milliseconds when wait=true (max ${MAX_WAIT_MS}). Default: ${DEFAULT_WAIT_MS}. Ignored otherwise.`),
      }),
      annotations: write({ destructive: true }),
    },
    async ({ agent, prompt, wait, timeout_ms }, ctx) =>
      toToolResult(
        await herdr.promptAgent(
          agent,
          prompt,
          wait ? { wait: true, timeoutMs: timeout_ms ?? DEFAULT_WAIT_MS } : { wait: false },
          { signal: ctx.mcpReq.signal }
        )
      )
  );

  server.registerTool(
    "herdr_agent_send_keys",
    {
      title: "Send keys to agent",
      description: `Send key presses to an agent, e.g. 'esc', 'ctrl+c', 'enter', 'y', or several space-separated keys like 'down enter'. Answering an approval dialog acts on the user's behalf, so only do it when they asked.`,
      inputSchema: z.object({
        agent: agentTarget,
        keys: z
          .string()
          .min(1)
          .max(512)
          .describe("Space-separated herdr key combos, e.g. 'esc', 'ctrl+c', 'shift+tab', 'down enter'. Use 'minus' for '-'."),
      }),
      annotations: write({ destructive: true }),
    },
    async ({ agent, keys }, ctx) => {
      const list = keys.trim().split(/\s+/).filter(Boolean);
      if (list.length > MAX_KEYS) {
        return toToolResult({
          ok: false,
          error: { code: "invalid_argument", message: `Send at most ${MAX_KEYS} keys per call` },
        });
      }
      return toToolResult(await herdr.sendKeys(agent, list, { signal: ctx.mcpReq.signal }));
    }
  );

  server.registerTool(
    "herdr_agent_rename",
    {
      title: "Rename agent",
      description: "Rename an agent. The new name must be unique among live agents.",
      inputSchema: z.object({
        agent: agentTarget,
        new_name: agentName.describe("New agent name matching [a-z][a-z0-9_-]{0,31}."),
      }),
      annotations: write({ destructive: false, idempotent: true }),
    },
    async ({ agent, new_name }, ctx) =>
      toToolResult(await herdr.renameAgent(agent, new_name, { signal: ctx.mcpReq.signal }))
  );

  server.registerTool(
    "herdr_pane_close",
    {
      title: "Close pane",
      description:
        "Close a pane and terminate whatever runs in it, including any agent. Only use when the user asked to close it.",
      inputSchema: z.object({ pane_id: paneId.describe("Pane ID to close (e.g. 'w1:p1').") }),
      annotations: write({ destructive: true }),
    },
    async ({ pane_id }, ctx) => toToolResult(await herdr.closePane(pane_id, { signal: ctx.mcpReq.signal }))
  );

  return server;
}

function toToolResult(result: Result<unknown>): CallToolResult {
  if (!result.ok) {
    return {
      content: [{ type: "text", text: `Error [${result.error.code}]: ${result.error.message}` }],
      isError: true,
    };
  }
  const { value } = result;
  const text =
    typeof value === "string"
      ? value === ""
        ? "(no output)"
        : value
      : value === null || value === undefined
        ? "OK"
        : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}
