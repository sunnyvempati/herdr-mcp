#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import * as herdr from "./herdr.js";

const VERSION = "0.1.0";

function formatResult(result: herdr.HerdrResult<unknown>): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (result.success) {
    return {
      content: [
        {
          type: "text",
          text:
            result.data !== undefined
              ? JSON.stringify(result.data, null, 2)
              : "OK",
        },
      ],
    };
  } else {
    return {
      content: [
        {
          type: "text",
          text: `Error [${result.error?.code}]: ${result.error?.message}${
            result.error?.details
              ? `\nDetails: ${JSON.stringify(result.error.details)}`
              : ""
          }`,
        },
      ],
      isError: true,
    };
  }
}

function writeNotAllowed(): {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: "Write operations are disabled. Set HERDR_MCP_ALLOW_WRITE=1 to enable write tools (tab create, agent start, agent prompt, send-keys, rename, close).",
      },
    ],
    isError: true,
  };
}

function getHerdrOptions(): herdr.HerdrOptions {
  const machine = herdr.getMachineFromEnv();
  return machine ? { machine } : {};
}

function createServer() {
  const server = new McpServer({
    name: "herdr-mcp",
    version: VERSION,
  });

  // ============================================================
  // READ-ONLY TOOLS (always available)
  // ============================================================

  server.registerTool(
    "herdr_status",
    {
      description:
        "Get the status of the herdr server and client. Returns whether the server is running, the version, and session info. Use this first to verify herdr is running before other commands.",
      inputSchema: {},
    },
    async () => {
      const result = await herdr.getStatus(getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_workspace_list",
    {
      description:
        "List all workspaces in the herdr session. Each workspace is a project-level container that owns tabs and panes. The sidebar rolls agent states up per workspace.",
      inputSchema: {},
    },
    async () => {
      const result = await herdr.listWorkspaces(getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_tab_list",
    {
      description:
        "List tabs in a workspace. Tabs are layout containers inside a workspace for separating views like agents, logs, or servers. Each tab contains one or more panes.",
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe(
            "Workspace ID (e.g. 'w1'). If omitted, lists tabs across all workspaces."
          ),
      },
    },
    async ({ workspace_id }) => {
      const result = await herdr.listTabs(workspace_id, getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_pane_list",
    {
      description:
        "List panes in a workspace. A pane is a real terminal that survives client detach. Panes can contain shell prompts, running processes, or AI coding agents.",
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe(
            "Workspace ID (e.g. 'w1'). If omitted, lists panes across all workspaces."
          ),
      },
    },
    async ({ workspace_id }) => {
      const result = await herdr.listPanes(workspace_id, getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_list",
    {
      description:
        "List all recognized AI coding agents running in herdr panes. Returns each agent's name, status (idle/working/blocked/done/unknown), pane_id, workspace_id, and other metadata. This is the primary tool for monitoring agent activity.",
      inputSchema: {},
    },
    async () => {
      const result = await herdr.listAgents(getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_get",
    {
      description:
        "Get detailed information about a specific agent. Returns the agent's current status, pane location, working directory, terminal title, and session info.",
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
      },
    },
    async ({ agent }) => {
      const result = await herdr.getAgent(agent, getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_read",
    {
      description:
        "Read recent output from an agent's terminal. Use this to see what an agent has been doing, check for errors, or read its responses. Returns terminal content as text.",
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
        source: z
          .enum(["visible", "recent", "recent-unwrapped", "detection"])
          .optional()
          .describe(
            "Content source: 'visible' (current viewport), 'recent' (recent output with soft wraps), 'recent-unwrapped' (recent output with soft wraps joined - best for logs/transcripts), 'detection' (plain-text snapshot used for agent detection). Default: recent-unwrapped"
          ),
        lines: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe(
            "Number of lines to read (1-500). Default: 60. More lines can be requested but may be limited by available scrollback."
          ),
      },
    },
    async ({ agent, source, lines }) => {
      const result = await herdr.readAgent(
        agent,
        { source: source ?? "recent-unwrapped", lines: lines ?? 60 },
        getHerdrOptions()
      );
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_wait",
    {
      description:
        "Wait for an agent to reach a specific state or settle. Without 'until', waits for the agent to settle to idle, done, or blocked. With 'until', waits for that specific state. Returns the agent info when the wait completes.",
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
        until: z
          .enum(["idle", "working", "blocked", "done"])
          .optional()
          .describe(
            "Wait for this specific state. If omitted, waits for any settled state (idle, done, or blocked)."
          ),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(300000)
          .optional()
          .describe(
            "Timeout in milliseconds (max 300000 = 5 min). Default: 120000 (2 min)."
          ),
      },
    },
    async ({ agent, until, timeout_ms }) => {
      const result = await herdr.waitAgent(
        agent,
        { until, timeout: timeout_ms ?? 120000 },
        getHerdrOptions()
      );
      return formatResult(result);
    }
  );

  // ============================================================
  // WRITE TOOLS (require HERDR_MCP_ALLOW_WRITE=1)
  // ============================================================

  server.registerTool(
    "herdr_tab_create",
    {
      description:
        "Create a new tab in a workspace. Returns the new tab and its root pane. The root pane starts with an empty shell prompt, ready for agent start or commands. WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.",
      inputSchema: {
        workspace_id: z
          .string()
          .optional()
          .describe(
            "Workspace ID (e.g. 'w1'). If omitted, creates tab in the focused workspace."
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Initial working directory for the shell. If omitted, uses the default."
          ),
        name: z.string().optional().describe("Tab name for display."),
        no_focus: z
          .boolean()
          .optional()
          .describe("If true, do not focus the new tab. Default: false."),
      },
    },
    async ({ workspace_id, cwd, name, no_focus }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.createTab(
        workspace_id,
        { cwd, name, noFocus: no_focus },
        getHerdrOptions()
      );
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_start",
    {
      description: `Start a coding agent in an existing pane. The pane MUST be at an interactive shell prompt with no foreground command running. Use herdr_tab_create first to get an empty pane, then start the agent there.

Common workflow:
1. herdr_tab_create -> get root_pane.pane_id
2. herdr_agent_start with that pane_id
3. herdr_agent_prompt to give it work
4. herdr_agent_wait or herdr_agent_read to monitor

WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.`,
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z][a-z0-9_-]{0,31}$/)
          .describe(
            "Unique agent name (lowercase, starts with letter, max 32 chars). Must be unique among live agents."
          ),
        kind: z
          .string()
          .describe(
            "Agent kind to start. Common values: 'claude', 'codex', 'grok'. Run 'herdr agent' to see installed kinds."
          ),
        pane_id: z
          .string()
          .describe(
            "Pane ID (e.g. 'w1:p1') where the agent will start. Must be at an available shell prompt."
          ),
        agent_args: z
          .array(z.string())
          .optional()
          .describe(
            "Optional arguments passed to the agent after '--'. These are native agent arguments."
          ),
      },
    },
    async ({ name, kind, pane_id, agent_args }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.startAgent(
        name,
        kind,
        pane_id,
        agent_args ?? [],
        getHerdrOptions()
      );
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_prompt",
    {
      description: `Send a prompt/message to an agent. The prompt is sent as bracketed paste followed by Enter. Use --wait to wait for the agent to complete and return to idle/done/blocked.

If the agent is blocked (waiting at an approval dialog), this will fail with 'agent_blocked'. Check the agent's output first and handle the block.

WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.`,
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
        prompt: z.string().describe("The prompt text to send to the agent."),
        wait: z
          .boolean()
          .optional()
          .describe(
            "If true, wait for the agent to settle (idle/done/blocked) after prompting. Default: false."
          ),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(300000)
          .optional()
          .describe(
            "Timeout in milliseconds when wait=true (max 300000 = 5 min). Default: 120000 (2 min)."
          ),
      },
    },
    async ({ agent, prompt, wait, timeout_ms }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.promptAgent(
        agent,
        prompt,
        { wait: wait ?? false, timeout: timeout_ms },
        getHerdrOptions()
      );
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_send_keys",
    {
      description: `Send raw key sequences to an agent. Use for interactive controls like 'esc', 'ctrl+c', 'enter', etc. Herdr validates all keys before sending.

Common uses:
- 'esc' - cancel or dismiss
- 'ctrl+c' - interrupt
- 'y' or 'n' - answer yes/no prompts
- 'enter' - confirm

WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.`,
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
        keys: z
          .string()
          .describe(
            "Key sequence to send. Examples: 'esc', 'ctrl+c', 'enter', 'y', 'n'. Multiple keys can be space-separated."
          ),
      },
    },
    async ({ agent, keys }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.sendKeysToAgent(agent, keys, getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_agent_rename",
    {
      description:
        "Rename an agent. The new name must be unique among live agents. WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.",
      inputSchema: {
        agent: z
          .string()
          .describe(
            "Current agent name (e.g. 'reviewer') or pane ID (e.g. 'w1:p1') hosting the agent."
          ),
        new_name: z
          .string()
          .regex(/^[a-z][a-z0-9_-]{0,31}$/)
          .describe(
            "New agent name (lowercase, starts with letter, max 32 chars). Must be unique among live agents."
          ),
      },
    },
    async ({ agent, new_name }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.renameAgent(agent, new_name, getHerdrOptions());
      return formatResult(result);
    }
  );

  server.registerTool(
    "herdr_pane_close",
    {
      description:
        "Close a pane and terminate any process running in it. Use with caution - this will kill any agent or process in the pane. WRITE OPERATION: Requires HERDR_MCP_ALLOW_WRITE=1.",
      inputSchema: {
        pane_id: z.string().describe("Pane ID to close (e.g. 'w1:p1')."),
      },
    },
    async ({ pane_id }) => {
      if (!herdr.isWriteAllowed()) return writeNotAllowed();
      const result = await herdr.closePane(pane_id, getHerdrOptions());
      return formatResult(result);
    }
  );

  return server;
}

serveStdio(createServer, {
  onerror: (error) => console.error("herdr-mcp error:", error),
});
console.error(`herdr-mcp v${VERSION} running on stdio`);
