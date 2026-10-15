import { spawn, type ChildProcess } from "node:child_process";

/** Error codes produced by herdr-mcp itself. */
export type ClientErrorCode =
  | "herdr_not_found"
  | "spawn_error"
  | "invalid_argument"
  | "timeout"
  | "cancelled"
  | "output_too_large"
  | "cli_syntax_error"
  | "parse_error"
  | "herdr_exit_error";

export interface HerdrError {
  /** A {@link ClientErrorCode}, or a code reported by herdr (e.g. `agent_not_found`, `agent_blocked`). */
  code: ClientErrorCode | (string & {});
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: HerdrError };

export const AGENT_STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const READ_SOURCES = ["visible", "recent", "recent-unwrapped", "detection"] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

/** Workspace, tab, and pane IDs (`w1`, `w1:t2`, `w1:p3`) and agent targets (a name or a pane ID). */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
/** herdr's rule for agent names. */
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const AGENT_KIND_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
/** One herdr key combo (`enter`, `ctrl+c`, `y`); printable ASCII that cannot be read as a flag. */
export const KEY_PATTERN = /^[!-,.-~][!-~]{0,31}$/;
/** herdr resolves `~` on the server side, which matters for remote machines. */
export const CWD_PATTERN = /^[/~][^\u0000-\u001f\u007f]{0,4095}$/;
export const LABEL_PATTERN = /^[^\u0000-\u001f\u007f]{1,128}$/;

/** Linux caps a single argv entry at 128 KiB; 30k chars stays under it even at 4 bytes per char. */
export const MAX_PROMPT_CHARS = 30_000;
export const MAX_WAIT_MS = 300_000;
export const MAX_READ_LINES = 500;

const DEFAULT_TIMEOUT_MS = 30_000;
/** Slack on top of a timeout herdr enforces itself, so herdr's own `timeout` error wins the race. */
const HERDR_TIMEOUT_SLACK_MS = 5_000;
/** herdr's default agent startup timeout is 30s. */
const AGENT_START_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;
const MAX_MESSAGE_CHARS = 2_000;

export interface HerdrClientOptions {
  /** Path or name of the herdr executable. Default: `herdr` on PATH. */
  bin?: string;
  /** Saved machine label or profile ID, passed as herdr's `--machine` prefix. */
  machine?: string;
  /** Per-stream cap; herdr is killed and `output_too_large` returned when exceeded. */
  maxOutputBytes?: number;
  /** Time between SIGTERM and SIGKILL when herdr must be stopped. */
  killGraceMs?: number;
  /** Process timeout for commands herdr does not time out itself. */
  defaultTimeoutMs?: number;
}

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * Typed access to the herdr CLI.
 *
 * Every method builds an argv array (never a shell string), validates
 * positional operands so they cannot be parsed as flags, bounds runtime and
 * output size, and maps herdr's exit codes and JSON error envelopes to a
 * {@link Result}. JSON commands resolve to herdr's `result` payload.
 */
export interface HerdrClient {
  status(call?: CallOptions): Promise<Result<unknown>>;
  listWorkspaces(call?: CallOptions): Promise<Result<unknown>>;
  listTabs(params: { workspaceId?: string }, call?: CallOptions): Promise<Result<unknown>>;
  listPanes(params: { workspaceId?: string }, call?: CallOptions): Promise<Result<unknown>>;
  listAgents(call?: CallOptions): Promise<Result<unknown>>;
  getAgent(target: string, call?: CallOptions): Promise<Result<unknown>>;
  /** Resolves to the terminal text herdr prints. */
  readAgent(
    target: string,
    params: { source: ReadSource; lines: number },
    call?: CallOptions
  ): Promise<Result<string>>;
  waitAgent(
    target: string,
    params: { until?: AgentStatus; timeoutMs: number },
    call?: CallOptions
  ): Promise<Result<unknown>>;
  createTab(
    params: { workspaceId?: string; cwd?: string; label?: string; focus?: boolean },
    call?: CallOptions
  ): Promise<Result<unknown>>;
  startAgent(
    params: { name: string; kind: string; paneId: string; agentArgs?: string[] },
    call?: CallOptions
  ): Promise<Result<unknown>>;
  promptAgent(
    target: string,
    text: string,
    params: { wait: false } | { wait: true; timeoutMs: number },
    call?: CallOptions
  ): Promise<Result<unknown>>;
  sendKeys(target: string, keys: string[], call?: CallOptions): Promise<Result<unknown>>;
  renameAgent(target: string, newName: string, call?: CallOptions): Promise<Result<unknown>>;
  closePane(paneId: string, call?: CallOptions): Promise<Result<unknown>>;
}

type Check = [label: string, value: string, pattern: RegExp];

export function createHerdrClient(options: HerdrClientOptions = {}): HerdrClient {
  const bin = options.bin ?? "herdr";
  const prefix = options.machine === undefined ? [] : ["--machine", options.machine];
  const runner: RunnerOptions = {
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
  };
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  function json(
    args: string[],
    checks: Check[],
    call: CallOptions | undefined,
    timeoutMs = defaultTimeoutMs
  ): Promise<Result<unknown>> {
    const invalid = validate(checks);
    if (invalid) return Promise.resolve(invalid);
    return runHerdr(bin, [...prefix, ...args], { ...runner, timeoutMs, signal: call?.signal }).then(
      (run) => (run.ok ? parseJsonResponse(run.value.stdout) : run)
    );
  }

  return {
    // `status` without a scope is a local-only command; herdr forwards only `status server`.
    status: (call) =>
      json(options.machine === undefined ? ["status", "--json"] : ["status", "server", "--json"], [], call),

    listWorkspaces: (call) => json(["workspace", "list"], [], call),

    listTabs: ({ workspaceId }, call) =>
      json(["tab", "list", ...optional("--workspace", workspaceId)], idCheck("workspace_id", workspaceId), call),

    listPanes: ({ workspaceId }, call) =>
      json(["pane", "list", ...optional("--workspace", workspaceId)], idCheck("workspace_id", workspaceId), call),

    listAgents: (call) => json(["agent", "list"], [], call),

    getAgent: (target, call) => json(["agent", "get", target], [["agent", target, ID_PATTERN]], call),

    readAgent: async (target, { source, lines }, call) => {
      const invalid = validate([["agent", target, ID_PATTERN]]) ?? checkInt("lines", lines, 1, MAX_READ_LINES);
      if (invalid) return invalid;
      const run = await runHerdr(
        bin,
        [...prefix, "agent", "read", target, "--source", source, "--lines", String(lines)],
        { ...runner, timeoutMs: defaultTimeoutMs, signal: call?.signal }
      );
      return run.ok ? { ok: true, value: run.value.stdout } : run;
    },

    waitAgent: (target, { until, timeoutMs }, call) => {
      const invalid = checkInt("timeout_ms", timeoutMs, 1, MAX_WAIT_MS);
      if (invalid) return Promise.resolve(invalid);
      return json(
        ["agent", "wait", target, ...optional("--until", until), "--timeout", String(timeoutMs)],
        [["agent", target, ID_PATTERN]],
        call,
        timeoutMs + HERDR_TIMEOUT_SLACK_MS
      );
    },

    createTab: ({ workspaceId, cwd, label, focus }, call) =>
      json(
        [
          "tab",
          "create",
          ...optional("--workspace", workspaceId),
          ...optional("--cwd", cwd),
          ...optional("--label", label),
          focus ? "--focus" : "--no-focus",
        ],
        [
          ...idCheck("workspace_id", workspaceId),
          ...(cwd === undefined ? [] : [["cwd", cwd, CWD_PATTERN] as Check]),
          ...(label === undefined ? [] : [["name", label, LABEL_PATTERN] as Check]),
        ],
        call
      ),

    startAgent: ({ name, kind, paneId, agentArgs = [] }, call) => {
      if (agentArgs.some((arg) => arg.includes("\u0000"))) {
        return Promise.resolve(failure("invalid_argument", "agent_args must not contain NUL characters"));
      }
      return json(
        [
          "agent",
          "start",
          name,
          "--kind",
          kind,
          "--pane",
          paneId,
          ...(agentArgs.length > 0 ? ["--", ...agentArgs] : []),
        ],
        [
          ["name", name, AGENT_NAME_PATTERN],
          ["kind", kind, AGENT_KIND_PATTERN],
          ["pane_id", paneId, ID_PATTERN],
        ],
        call,
        AGENT_START_TIMEOUT_MS
      );
    },

    promptAgent: (target, text, params, call) => {
      // herdr reads the text operand verbatim, so flag-shaped prompts stay text;
      // our own flags must come after it.
      if (text.length === 0 || text.length > MAX_PROMPT_CHARS || text.includes("\u0000")) {
        return Promise.resolve(
          failure("invalid_argument", `prompt must be 1-${MAX_PROMPT_CHARS} characters without NUL`)
        );
      }
      if (params.wait) {
        const invalid = checkInt("timeout_ms", params.timeoutMs, 1, MAX_WAIT_MS);
        if (invalid) return Promise.resolve(invalid);
      }
      return json(
        [
          "agent",
          "prompt",
          target,
          text,
          // herdr rejects --timeout unless --wait is present.
          ...(params.wait ? ["--wait", "--timeout", String(params.timeoutMs)] : []),
        ],
        [["agent", target, ID_PATTERN]],
        call,
        params.wait ? params.timeoutMs + HERDR_TIMEOUT_SLACK_MS : defaultTimeoutMs
      );
    },

    sendKeys: (target, keys, call) => {
      if (keys.length === 0) return Promise.resolve(failure("invalid_argument", "keys must not be empty"));
      return json(
        ["agent", "send-keys", target, ...keys],
        [["agent", target, ID_PATTERN], ...keys.map((key): Check => ["key", key, KEY_PATTERN])],
        call
      );
    },

    renameAgent: (target, newName, call) =>
      json(
        ["agent", "rename", target, newName],
        [
          ["agent", target, ID_PATTERN],
          ["new_name", newName, AGENT_NAME_PATTERN],
        ],
        call
      ),

    closePane: (paneId, call) => json(["pane", "close", paneId], [["pane_id", paneId, ID_PATTERN]], call),
  };
}

function optional(flag: string, value: string | undefined): string[] {
  return value === undefined ? [] : [flag, value];
}

function idCheck(label: string, value: string | undefined): Check[] {
  return value === undefined ? [] : [[label, value, ID_PATTERN]];
}

function validate(checks: Check[]): { ok: false; error: HerdrError } | undefined {
  for (const [label, value, pattern] of checks) {
    if (!pattern.test(value)) {
      return failure("invalid_argument", `Invalid ${label}: ${JSON.stringify(truncate(value, 80))}`);
    }
  }
  return undefined;
}

function checkInt(label: string, value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max
    ? undefined
    : failure("invalid_argument", `${label} must be an integer from ${min} to ${max}`);
}

function failure(code: HerdrError["code"], message: string): { ok: false; error: HerdrError } {
  return { ok: false, error: { code, message } };
}

function truncate(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** herdr prints `{"id","result"}` or `{"id","error":{"code","message"}}`; `status` prints a bare object. */
function parseJsonResponse(stdout: string): Result<unknown> {
  if (stdout.trim() === "") return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return failure("parse_error", `herdr returned non-JSON output: ${truncate(stdout.trim(), 200)}`);
  }
  const envelopeError = readErrorEnvelope(parsed);
  if (envelopeError) return { ok: false, error: envelopeError };
  if (isRecord(parsed) && "result" in parsed) return { ok: true, value: parsed.result };
  return { ok: true, value: parsed };
}

function readErrorEnvelope(parsed: unknown): HerdrError | undefined {
  if (!isRecord(parsed) || !isRecord(parsed.error) || typeof parsed.error.code !== "string") {
    return undefined;
  }
  const message = typeof parsed.error.message === "string" ? parsed.error.message : parsed.error.code;
  return { code: parsed.error.code, message: truncate(message) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RunnerOptions {
  maxOutputBytes: number;
  killGraceMs: number;
}

interface RunOptions extends RunnerOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Runs herdr once and interprets its exit status:
 * 0 is success, 1 carries a JSON error envelope on stderr, 2 is a usage error.
 */
function runHerdr(bin: string, args: string[], options: RunOptions): Promise<Result<{ stdout: string }>> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    } catch (err) {
      resolve(failure("spawn_error", err instanceof Error ? err.message : String(err)));
      return;
    }

    const stdout = new BoundedBuffer(options.maxOutputBytes);
    const stderr = new BoundedBuffer(options.maxOutputBytes);
    let stopReason: HerdrError | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (result: Result<{ stdout: string }>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };

    const stop = (reason: HerdrError) => {
      if (stopReason) return;
      stopReason = reason;
      if (child.exitCode !== null || child.signalCode !== null) {
        finish({ ok: false, error: reason });
        return;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), options.killGraceMs);
    };

    const timeoutTimer = setTimeout(
      () => stop({ code: "timeout", message: `herdr did not finish within ${options.timeoutMs}ms` }),
      options.timeoutMs
    );
    const onAbort = () => stop({ code: "cancelled", message: "The request was cancelled" });
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    const tooLarge: HerdrError = {
      code: "output_too_large",
      message: `herdr output exceeded ${options.maxOutputBytes} bytes; request less output (e.g. fewer lines)`,
    };
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk) || stop(tooLarge));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk) || stop(tooLarge));

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        err.code === "ENOENT"
          ? failure("herdr_not_found", "herdr binary not found in PATH. Install herdr from https://herdr.dev")
          : failure("spawn_error", err.message)
      );
    });

    // A stopped herdr may leave a grandchild (e.g. ssh) holding the pipes open, so
    // don't wait for "close" once we've decided to stop.
    child.on("exit", () => {
      if (stopReason) finish({ ok: false, error: stopReason });
    });

    child.on("close", (code, signal) => {
      if (stopReason) {
        finish({ ok: false, error: stopReason });
        return;
      }
      finish(interpretExit(code, signal, stdout.text(), stderr.text()));
    });
  });
}

function interpretExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string
): Result<{ stdout: string }> {
  if (code === 0) return { ok: true, value: { stdout } };
  if (code === 2) {
    return failure("cli_syntax_error", truncate(stderr.trim()) || "herdr rejected the command arguments");
  }
  const envelope = parseErrorEnvelopeText(stderr) ?? parseErrorEnvelopeText(stdout);
  if (envelope) return { ok: false, error: envelope };
  const detail = truncate(stderr.trim());
  if (code === null) {
    return failure("herdr_exit_error", detail || `herdr was terminated by ${signal ?? "a signal"}`);
  }
  return failure("herdr_exit_error", detail || `herdr exited with code ${code}`);
}

function parseErrorEnvelopeText(text: string): HerdrError | undefined {
  if (text.trim() === "") return undefined;
  try {
    return readErrorEnvelope(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Collects raw bytes so multi-byte UTF-8 characters split across chunks decode correctly. */
class BoundedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  /** Returns false once the limit is exceeded; further data is discarded. */
  push(chunk: Buffer): boolean {
    if (this.size + chunk.length > this.limit) {
      this.size = this.limit + 1;
      return false;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    return true;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
