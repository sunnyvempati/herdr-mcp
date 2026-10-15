#!/usr/bin/env node
import { createRequire } from "node:module";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createHerdrClient } from "./herdr.js";
import { createServer } from "./server.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`herdr-mcp: ${err.message}`);
  process.exit(1);
}

const herdr = createHerdrClient({ machine: config.machine });

serveStdio(() => createServer({ config, herdr, version }), {
  onerror: (error) => console.error("herdr-mcp error:", error),
});

console.error(
  `herdr-mcp v${version} on stdio (${config.allowWrite ? "read + write" : "read-only"}` +
    `${config.machine ? `, machine: ${config.machine}` : ""})`
);
