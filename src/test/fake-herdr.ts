/**
 * A stand-in for the herdr 0.9.5 CLI.
 *
 * It enforces the argument grammar of the commands herdr-mcp uses (unknown
 * options exit 2, like herdr), logs each argv as a JSON line to
 * FAKE_HERDR_LOG, and replies with output captured from real herdr. A JSON
 * file at FAKE_HERDR_SCENARIO can override the reply per command.
 */
import { appendFileSync, readFileSync } from "node:fs";

interface Reply {
  stdout?: string;
  stderr?: string;
  exit?: number;
  /** Never exit on its own. */
  hang?: boolean;
  ignoreSigterm?: boolean;
  /** Write this many bytes of filler to stdout. */
  stdoutBytes?: number;
  /** Write stdout one byte at a time, splitting multi-byte characters across chunks. */
  byteByByte?: boolean;
}

interface Grammar {
  positionals: number | "rest";
  values?: string[];
  flags?: string[];
  /** Index of a positional that herdr reads verbatim, even if it looks like a flag. */
  verbatim?: number;
  /** Everything after `--` is passed through. */
  passthrough?: boolean;
}

const GRAMMAR: Record<string, Grammar> = {
  status: { positionals: 1, flags: ["--json"] },
  "workspace list": { positionals: 0 },
  "tab list": { positionals: 0, values: ["--workspace"] },
  "tab create": {
    positionals: 0,
    values: ["--workspace", "--cwd", "--label", "--env"],
    flags: ["--focus", "--no-focus"],
  },
  "pane list": { positionals: 0, values: ["--workspace"] },
  "pane close": { positionals: 1 },
  "agent list": { positionals: 0 },
  "agent get": { positionals: 1 },
  "agent read": { positionals: 1, values: ["--source", "--lines", "--format"], flags: ["--ansi"] },
  "agent wait": { positionals: 1, values: ["--until", "--timeout"] },
  "agent prompt": { positionals: 2, values: ["--until", "--timeout"], flags: ["--wait"], verbatim: 1 },
  "agent send-keys": { positionals: "rest" },
  "agent rename": { positionals: 2, flags: ["--clear"] },
  "agent start": { positionals: 1, values: ["--kind", "--pane", "--timeout"], passthrough: true },
};

const AGENT = {
  agent: "claude",
  agent_status: "blocked",
  cwd: "/srv/project",
  focused: false,
  name: "reviewer",
  pane_id: "w1:p2",
  revision: 3,
  tab_id: "w1:t1",
  terminal_id: "term_65dd954cc01f22",
  workspace_id: "w1",
};
const PANE = {
  agent_status: "unknown",
  cwd: "/srv/project",
  focused: true,
  pane_id: "w1:p1",
  revision: 0,
  tab_id: "w1:t1",
  terminal_id: "term_65dd954cbf42c1",
  workspace_id: "w1",
};
const TAB = { agent_status: "unknown", focused: false, label: "logs", number: 2, pane_count: 1, tab_id: "w1:t2", workspace_id: "w1" };

const envelope = (id: string, result: unknown) => JSON.stringify({ id, result });

const REPLIES: Record<string, Reply> = {
  "status --json": {
    stdout: JSON.stringify({
      client: { version: "0.9.5", channel: "stable", protocol: 22 },
      server: { status: "running", running: true, version: "0.9.5", protocol: 22, compatible: true },
    }),
  },
  "status server": { stdout: JSON.stringify({ status: "running", running: true, version: "0.9.5", protocol: 22 }) },
  "workspace list": {
    stdout: envelope("cli:workspace:list", {
      type: "workspace_list",
      workspaces: [{ workspace_id: "w1", label: "api", focused: true, tab_count: 2, pane_count: 2, agent_status: "blocked" }],
    }),
  },
  "tab list": { stdout: envelope("cli:tab:list", { type: "tab_list", tabs: [TAB] }) },
  "tab create": {
    stdout: envelope("cli:tab:create", { type: "tab_created", tab: TAB, root_pane: { ...PANE, pane_id: "w1:p3", tab_id: "w1:t2" } }),
  },
  "pane list": { stdout: envelope("cli:pane:list", { type: "pane_list", panes: [PANE] }) },
  "pane close": { stdout: envelope("cli:pane:close", { type: "ok" }) },
  "agent list": { stdout: envelope("cli:agent:list", { type: "agent_list", agents: [AGENT] }) },
  "agent get": { stdout: envelope("cli:agent:get", { type: "agent_info", agent: AGENT }) },
  "agent read": { stdout: "Run tests? (y/n)\n> café ready" },
  "agent wait": { stdout: envelope("cli:agent:wait", { type: "agent_info", agent: { ...AGENT, agent_status: "idle" } }) },
  "agent prompt": { stdout: envelope("cli:agent:prompt", { type: "ok" }) },
  "agent send-keys": { stdout: envelope("cli:agent:send-keys", { type: "ok" }) },
  "agent rename": { stdout: envelope("cli:agent:rename", { type: "agent_info", agent: { ...AGENT, name: "auditor" } }) },
  "agent start": { stdout: envelope("cli:agent:start", { type: "agent_info", agent: { ...AGENT, agent_status: "idle" } }) },
};

function usageError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parse(argv: string[]): string {
  let rest = argv;
  if (rest[0] === "--machine") {
    if (!rest[1] || rest[1].startsWith("-")) usageError("--machine requires a saved machine label or profile ID");
    rest = rest.slice(2);
  }
  const command = rest[0] === "status" ? "status" : rest.slice(0, 2).join(" ");
  const grammar = GRAMMAR[command];
  if (!grammar) usageError(`unknown command: ${command}`);

  const tokens = rest.slice(command.split(" ").length);
  const positionals: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (grammar.verbatim === positionals.length) {
      positionals.push(token);
    } else if (token === "--" && grammar.passthrough) {
      break;
    } else if (grammar.values?.includes(token)) {
      if (tokens[i + 1] === undefined) usageError(`missing value for ${token}`);
      seen.add(token);
      i++;
    } else if (grammar.flags?.includes(token)) {
      seen.add(token);
    } else if (token.startsWith("--")) {
      usageError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }
  if (grammar.positionals !== "rest" && positionals.length > grammar.positionals) {
    usageError(`unexpected argument: ${positionals[grammar.positionals]}`);
  }
  if (command === "agent prompt" && (seen.has("--timeout") || seen.has("--until")) && !seen.has("--wait")) {
    usageError(`${seen.has("--timeout") ? "--timeout" : "--until"} requires --wait`);
  }
  if (command === "status") return positionals[0] === "server" ? "status server" : "status --json";
  return command;
}

if (process.env.FAKE_HERDR_LOG) {
  appendFileSync(process.env.FAKE_HERDR_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}

const key = parse(process.argv.slice(2));
const scenario: Record<string, Reply> = process.env.FAKE_HERDR_SCENARIO
  ? JSON.parse(readFileSync(process.env.FAKE_HERDR_SCENARIO, "utf8"))
  : {};
const reply: Reply = scenario[key] ?? REPLIES[key] ?? {};

if (reply.ignoreSigterm) process.on("SIGTERM", () => {});
if (reply.stderr) process.stderr.write(reply.stderr);

if (reply.stdoutBytes) {
  process.stdout.write("x".repeat(reply.stdoutBytes));
  finish();
} else if (reply.stdout !== undefined && reply.byteByByte) {
  const bytes = Buffer.from(reply.stdout, "utf8");
  let index = 0;
  const writeNext = () => {
    if (index >= bytes.length) return finish();
    process.stdout.write(bytes.subarray(index, ++index), () => setTimeout(writeNext, 2));
  };
  writeNext();
} else {
  if (reply.stdout !== undefined) process.stdout.write(reply.stdout);
  finish();
}

function finish() {
  if (reply.hang) {
    setInterval(() => {}, 1_000);
    return;
  }
  process.exitCode = reply.exit ?? 0;
}
