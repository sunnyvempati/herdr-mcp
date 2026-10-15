import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HerdrOptions {
  machine?: string;
  timeout?: number;
}

export interface HerdrResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: HerdrError;
}

export interface HerdrError {
  code: string;
  message: string;
  details?: unknown;
}

export interface AgentInfo {
  agent: string;
  agent_status: "idle" | "working" | "blocked" | "done" | "unknown";
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  cwd?: string;
  focused?: boolean;
  revision?: number;
  state_change_seq?: number;
  completion_seq?: number;
  tokens?: Record<string, string>;
  agent_session?: {
    agent: string;
    kind: string;
    source: string;
    value: string;
  };
}

export interface AgentListResult {
  type: "agent_list";
  agents: AgentInfo[];
}

export interface WorkspaceInfo {
  workspace_id: string;
  name?: string;
  focused?: boolean;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  name?: string;
  focused?: boolean;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  focused?: boolean;
  cwd?: string;
}

export interface StatusInfo {
  server?: {
    running: boolean;
    version?: string;
    session?: string;
  };
  client?: {
    version?: string;
  };
}

export interface AgentReadResult {
  content: string;
  source: string;
  lines: number;
}

export interface TabCreateResult {
  tab: TabInfo;
  root_pane: PaneInfo;
}

export interface AgentStartResult {
  agent: AgentInfo;
}

export interface AgentPromptResult {
  success: boolean;
  agent?: AgentInfo;
}

export interface AgentWaitResult {
  agent: AgentInfo;
  settled: boolean;
}

function parseHerdrResponse<T>(stdout: string): HerdrResult<T> {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      return {
        success: false,
        error: {
          code: parsed.error.code || "herdr_error",
          message: parsed.error.message || "Unknown herdr error",
          details: parsed.error,
        },
      };
    }
    if (parsed.result !== undefined) {
      return { success: true, data: parsed.result as T };
    }
    return { success: true, data: parsed as T };
  } catch {
    return {
      success: false,
      error: {
        code: "parse_error",
        message: "Failed to parse herdr response",
        details: stdout,
      },
    };
  }
}

function parseHerdrStderr(stderr: string): HerdrError | null {
  if (!stderr.trim()) return null;
  try {
    const parsed = JSON.parse(stderr);
    return {
      code: parsed.code || "herdr_stderr_error",
      message: parsed.message || stderr,
      details: parsed,
    };
  } catch {
    return {
      code: "herdr_stderr",
      message: stderr.trim(),
    };
  }
}

export async function execHerdr<T = unknown>(
  args: string[],
  options: HerdrOptions = {}
): Promise<HerdrResult<T>> {
  const { machine, timeout = DEFAULT_TIMEOUT_MS } = options;

  const fullArgs: string[] = [];
  if (machine) {
    fullArgs.push("--machine", machine);
  }
  fullArgs.push(...args);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn("herdr", fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({
          success: false,
          error: {
            code: "herdr_not_found",
            message:
              "herdr binary not found in PATH. Install herdr from https://herdr.dev",
          },
        });
      } else {
        resolve({
          success: false,
          error: {
            code: "spawn_error",
            message: err.message,
          },
        });
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          success: false,
          error: {
            code: "timeout",
            message: `herdr command timed out after ${timeout}ms`,
          },
        });
        return;
      }

      if (code === 2) {
        resolve({
          success: false,
          error: {
            code: "cli_syntax_error",
            message: stderr.trim() || "CLI syntax error",
          },
        });
        return;
      }

      if (code === 1) {
        const stderrError = parseHerdrStderr(stderr);
        if (stderrError) {
          resolve({ success: false, error: stderrError });
          return;
        }
      }

      if (stdout.trim()) {
        resolve(parseHerdrResponse<T>(stdout));
      } else if (code !== 0) {
        resolve({
          success: false,
          error: {
            code: "herdr_exit_error",
            message: stderr.trim() || `herdr exited with code ${code}`,
          },
        });
      } else {
        resolve({ success: true });
      }
    });
  });
}

export async function getStatus(
  options: HerdrOptions = {}
): Promise<HerdrResult<StatusInfo>> {
  return execHerdr<StatusInfo>(["status", "--json"], options);
}

export async function listWorkspaces(
  options: HerdrOptions = {}
): Promise<HerdrResult<{ workspaces: WorkspaceInfo[] }>> {
  return execHerdr<{ workspaces: WorkspaceInfo[] }>(
    ["workspace", "list", "--json"],
    options
  );
}

export async function listTabs(
  workspaceId: string | undefined,
  options: HerdrOptions = {}
): Promise<HerdrResult<{ tabs: TabInfo[] }>> {
  const args = ["tab", "list", "--json"];
  if (workspaceId) {
    args.push("--workspace", workspaceId);
  }
  return execHerdr<{ tabs: TabInfo[] }>(args, options);
}

export async function listPanes(
  workspaceId: string | undefined,
  options: HerdrOptions = {}
): Promise<HerdrResult<{ panes: PaneInfo[] }>> {
  const args = ["pane", "list", "--json"];
  if (workspaceId) {
    args.push("--workspace", workspaceId);
  }
  return execHerdr<{ panes: PaneInfo[] }>(args, options);
}

export async function listAgents(
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentListResult>> {
  return execHerdr<AgentListResult>(["agent", "list"], options);
}

export async function getAgent(
  agentNameOrPaneId: string,
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentInfo>> {
  return execHerdr<AgentInfo>(["agent", "get", agentNameOrPaneId], options);
}

export async function readAgent(
  agentNameOrPaneId: string,
  params: {
    source?: "visible" | "recent" | "recent-unwrapped" | "detection";
    lines?: number;
    format?: "text" | "ansi";
  } = {},
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentReadResult>> {
  const args = ["agent", "read", agentNameOrPaneId];
  if (params.source) {
    args.push("--source", params.source);
  }
  if (params.lines !== undefined) {
    args.push("--lines", String(params.lines));
  }
  if (params.format) {
    args.push("--format", params.format);
  }
  return execHerdr<AgentReadResult>(args, options);
}

export async function waitAgent(
  agentNameOrPaneId: string,
  params: {
    until?: "idle" | "working" | "blocked" | "done";
    timeout?: number;
  } = {},
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentWaitResult>> {
  const args = ["agent", "wait", agentNameOrPaneId];
  if (params.until) {
    args.push("--until", params.until);
  }
  if (params.timeout !== undefined) {
    args.push("--timeout", String(params.timeout));
  }
  const waitTimeout = params.timeout ? params.timeout + 5000 : 120_000;
  return execHerdr<AgentWaitResult>(args, { ...options, timeout: waitTimeout });
}

export async function createTab(
  workspaceId: string | undefined,
  params: {
    cwd?: string;
    name?: string;
    noFocus?: boolean;
  } = {},
  options: HerdrOptions = {}
): Promise<HerdrResult<TabCreateResult>> {
  const args = ["tab", "create"];
  if (workspaceId) {
    args.push("--workspace", workspaceId);
  }
  if (params.cwd) {
    args.push("--cwd", params.cwd);
  }
  if (params.name) {
    args.push("--name", params.name);
  }
  if (params.noFocus) {
    args.push("--no-focus");
  }
  return execHerdr<TabCreateResult>(args, options);
}

export async function startAgent(
  name: string,
  kind: string,
  paneId: string,
  agentArgs: string[] = [],
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentStartResult>> {
  const args = ["agent", "start", name, "--kind", kind, "--pane", paneId];
  if (agentArgs.length > 0) {
    args.push("--", ...agentArgs);
  }
  return execHerdr<AgentStartResult>(args, { ...options, timeout: 60_000 });
}

export async function promptAgent(
  agentNameOrPaneId: string,
  prompt: string,
  params: {
    wait?: boolean;
    timeout?: number;
  } = {},
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentPromptResult>> {
  const args = ["agent", "prompt", agentNameOrPaneId, prompt];
  if (params.wait) {
    args.push("--wait");
  }
  if (params.timeout !== undefined) {
    args.push("--timeout", String(params.timeout));
  }
  const waitTimeout = params.timeout ? params.timeout + 5000 : 120_000;
  return execHerdr<AgentPromptResult>(args, { ...options, timeout: waitTimeout });
}

export async function sendKeysToAgent(
  agentNameOrPaneId: string,
  keys: string,
  options: HerdrOptions = {}
): Promise<HerdrResult<void>> {
  return execHerdr<void>(["agent", "send-keys", agentNameOrPaneId, keys], options);
}

export async function renameAgent(
  agentNameOrPaneId: string,
  newName: string,
  options: HerdrOptions = {}
): Promise<HerdrResult<AgentInfo>> {
  return execHerdr<AgentInfo>(
    ["agent", "rename", agentNameOrPaneId, newName],
    options
  );
}

export async function closePane(
  paneId: string,
  options: HerdrOptions = {}
): Promise<HerdrResult<void>> {
  return execHerdr<void>(["pane", "close", paneId], options);
}

export function isWriteAllowed(): boolean {
  return process.env.HERDR_MCP_ALLOW_WRITE === "1";
}

export function getMachineFromEnv(): string | undefined {
  return process.env.HERDR_MCP_MACHINE;
}
