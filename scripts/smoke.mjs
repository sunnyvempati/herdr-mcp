// End-to-end check of every read-only tool against your real herdr.
// Usage: npm run build && npm run smoke   (or ./scripts/smoke.sh)
// Honors HERDR_MCP_MACHINE to smoke-test a remote machine. Never enables write tools.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const server = fileURLToPath(new URL("../build/index.js", import.meta.url));
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const version = spawnSync("herdr", ["--version"], { encoding: "utf8" });
if (version.error) {
  console.error(red("herdr not found in PATH. Install it from https://herdr.dev"));
  process.exit(1);
}
if (!existsSync(server)) {
  console.error(red("build/index.js is missing. Run `npm run build` first."));
  process.exit(1);
}
console.log(`herdr-mcp smoke test (${version.stdout.trim()})\n`);

const env = { ...process.env };
delete env.HERDR_MCP_ALLOW_WRITE;

const client = new Client({ name: "herdr-mcp-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: "inherit" }));

let failures = 0;

async function check(name, args = {}, { allowError } = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((part) => part.text ?? "").join("");
  const tolerated = result.isError && allowError?.test(text);
  if (result.isError && !tolerated) failures++;
  const mark = result.isError && !tolerated ? red("✗") : green("✓");
  console.log(`${mark} ${name} ${dim(JSON.stringify(args))}`);
  console.log(dim(text.split("\n").slice(0, 8).map((line) => `    ${line}`).join("\n")));
  return { ok: !result.isError, text };
}

const { tools } = await client.listTools();
const writable = tools.filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name);
if (writable.length > 0) {
  failures++;
  console.log(red(`✗ read-only mode exposed write tools: ${writable.join(", ")}`));
} else {
  console.log(green(`✓ read-only mode lists ${tools.length} read tools and no write tools`));
}

await check("herdr_status");
await check("herdr_workspace_list");
await check("herdr_tab_list");
await check("herdr_pane_list");
const agents = await check("herdr_agent_list");

const firstAgent = agents.ok ? JSON.parse(agents.text).agents?.[0] : undefined;
const target = firstAgent?.name ?? firstAgent?.pane_id;
if (target) {
  await check("herdr_agent_get", { agent: target });
  await check("herdr_agent_read", { agent: target, lines: 20 });
  await check("herdr_agent_wait", { agent: target, timeout_ms: 1000 }, { allowError: /\[timeout\]/ });
} else {
  console.log(dim("- no agents running; skipped herdr_agent_get, herdr_agent_read, herdr_agent_wait"));
}

await client.close();
console.log(failures === 0 ? green("\nAll read-only tools passed.") : red(`\n${failures} check(s) failed.`));
process.exit(failures === 0 ? 0 : 1);
