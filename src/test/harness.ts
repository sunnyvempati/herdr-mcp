import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const FAKE_HERDR_JS = fileURLToPath(new URL("./fake-herdr.js", import.meta.url));
export const SERVER_JS = fileURLToPath(new URL("../index.js", import.meta.url));

export interface FakeReply {
  stdout?: string;
  stderr?: string;
  exit?: number;
  hang?: boolean;
  ignoreSigterm?: boolean;
  stdoutBytes?: number;
  byteByByte?: boolean;
}

export interface FakeHerdr {
  /** Directory containing an executable named `herdr`. */
  dir: string;
  bin: string;
  env: Record<string, string>;
  /** Every argv herdr was invoked with, in order. */
  calls(): string[][];
  cleanup(): void;
}

export function fakeHerdr(scenario: Record<string, FakeReply> = {}): FakeHerdr {
  const dir = mkdtempSync(join(tmpdir(), "herdr-mcp-test-"));
  const bin = join(dir, "herdr");
  const log = join(dir, "calls.jsonl");
  const scenarioPath = join(dir, "scenario.json");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HERDR_JS}" "$@"\n`);
  chmodSync(bin, 0o755);
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  return {
    dir,
    bin,
    env: { FAKE_HERDR_LOG: log, FAKE_HERDR_SCENARIO: scenarioPath },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Environment for the server process: the fake herdr first on PATH, no inherited herdr-mcp settings. */
export function serverEnv(fake: FakeHerdr, env: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith("HERDR_")) base[name] = value;
  }
  return { ...base, ...fake.env, PATH: `${fake.dir}:${process.env.PATH ?? ""}`, ...env };
}

export async function connect(fake: FakeHerdr, env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "herdr-mcp-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_JS],
      env: serverEnv(fake, env),
      stderr: "ignore",
    })
  );
  return client;
}

export function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.map((part) => part.text ?? "").join("");
}
