import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHerdrClient, type HerdrClientOptions, type Result } from "../herdr.js";
import { fakeHerdr, type FakeHerdr, type FakeReply } from "./harness.js";

let fake: FakeHerdr | undefined;

afterEach(() => {
  fake?.cleanup();
  fake = undefined;
});

function clientFor(scenario: Record<string, FakeReply>, options: HerdrClientOptions = {}) {
  fake = fakeHerdr(scenario);
  Object.assign(process.env, fake.env);
  return createHerdrClient({ bin: fake.bin, ...options });
}

function errorCode(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("herdr runner", () => {
  test("reports a missing herdr binary", async () => {
    const herdr = createHerdrClient({ bin: "/nonexistent/herdr" });
    const result = await herdr.listAgents();
    assert.equal(errorCode(result), "herdr_not_found");
  });

  test("reports usage errors with herdr's message", async () => {
    const herdr = clientFor({ "agent list": { exit: 2, stderr: "unknown option: --json\n" } });
    assert.deepEqual(await herdr.listAgents(), {
      ok: false,
      error: { code: "cli_syntax_error", message: "unknown option: --json" },
    });
  });

  test("unwraps the result envelope", async () => {
    const herdr = clientFor({});
    const result = await herdr.listAgents();
    assert.equal(result.ok, true);
    assert.equal((result as { value: { type: string } }).value.type, "agent_list");
  });

  test("rejects non-JSON output from a JSON command", async () => {
    const herdr = clientFor({ "agent list": { stdout: "not json" } });
    assert.equal(errorCode(await herdr.listAgents()), "parse_error");
  });

  test("kills herdr when it exceeds the timeout", async () => {
    const herdr = clientFor({ "agent list": { hang: true } }, { defaultTimeoutMs: 200 });
    const started = Date.now();
    assert.equal(errorCode(await herdr.listAgents()), "timeout");
    assert.ok(Date.now() - started < 3_000);
  });

  test("escalates to SIGKILL when herdr ignores SIGTERM", async () => {
    const herdr = clientFor(
      { "agent list": { hang: true, ignoreSigterm: true } },
      { defaultTimeoutMs: 200, killGraceMs: 200 }
    );
    const started = Date.now();
    assert.equal(errorCode(await herdr.listAgents()), "timeout");
    assert.ok(Date.now() - started < 3_000);
  });

  test("stops herdr when the request is cancelled", async () => {
    const herdr = clientFor({ "agent wait": { hang: true } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await herdr.waitAgent("reviewer", { timeoutMs: 60_000 }, { signal: controller.signal });
    assert.equal(errorCode(result), "cancelled");
  });

  test("caps output size", async () => {
    const herdr = clientFor({ "agent read": { stdoutBytes: 50_000 } }, { maxOutputBytes: 1_000 });
    const result = await herdr.readAgent("reviewer", { source: "recent", lines: 10 });
    assert.equal(errorCode(result), "output_too_large");
  });

  test("decodes multi-byte characters split across output chunks", async () => {
    const herdr = clientFor({ "agent read": { stdout: "café → ✓ 🐑", byteByByte: true } });
    assert.deepEqual(await herdr.readAgent("reviewer", { source: "recent", lines: 10 }), {
      ok: true,
      value: "café → ✓ 🐑",
    });
  });

  test("validates operands even when called directly", async () => {
    const herdr = clientFor({});
    assert.equal(errorCode(await herdr.getAgent("--help")), "invalid_argument");
    assert.equal(errorCode(await herdr.sendKeys("reviewer", ["-h"])), "invalid_argument");
    assert.equal(errorCode(await herdr.promptAgent("reviewer", "", { wait: false })), "invalid_argument");
    assert.deepEqual(fake?.calls(), []);
  });
});
