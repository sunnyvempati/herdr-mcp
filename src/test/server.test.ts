import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { Client } from "@modelcontextprotocol/client";
import { connect, fakeHerdr, serverEnv, SERVER_JS, textOf, type FakeHerdr, type FakeReply } from "./harness.js";

const READ_TOOLS = [
  "herdr_agent_get",
  "herdr_agent_list",
  "herdr_agent_read",
  "herdr_agent_wait",
  "herdr_pane_list",
  "herdr_status",
  "herdr_tab_list",
  "herdr_workspace_list",
];
const WRITE_TOOLS = [
  "herdr_agent_prompt",
  "herdr_agent_rename",
  "herdr_agent_send_keys",
  "herdr_agent_start",
  "herdr_pane_close",
  "herdr_tab_create",
];

let fake: FakeHerdr | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  fake?.cleanup();
  client = undefined;
  fake = undefined;
});

async function start(options: { env?: Record<string, string>; scenario?: Record<string, FakeReply> } = {}) {
  fake = fakeHerdr(options.scenario);
  client = await connect(fake, options.env);
  return { fake, client };
}

const WRITE = { HERDR_MCP_ALLOW_WRITE: "1" };

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  try {
    const result = await c.callTool({ name, arguments: args });
    return { isError: result.isError === true, text: textOf(result) };
  } catch (err) {
    return { isError: true, text: err instanceof Error ? err.message : String(err) };
  }
}

async function toolNames(c: Client) {
  return (await c.listTools()).tools.map((tool) => tool.name).sort();
}

describe("write gate", () => {
  test("read-only mode lists only the read tools, all annotated read-only", async () => {
    const { client } = await start();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), READ_TOOLS);
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
  });

  test("HERDR_MCP_ALLOW_WRITE=1 adds the write tools under their stable names", async () => {
    const { client } = await start({ env: WRITE });
    assert.deepEqual(await toolNames(client), [...READ_TOOLS, ...WRITE_TOOLS].sort());
    const { tools } = await client.listTools();
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
    assert.deepEqual(destructive, ["herdr_agent_prompt", "herdr_agent_send_keys", "herdr_pane_close"]);
  });

  for (const value of ["true", "yes", "on", "01", " 1", "0"]) {
    test(`HERDR_MCP_ALLOW_WRITE=${JSON.stringify(value)} stays read-only`, async () => {
      const { client } = await start({ env: { HERDR_MCP_ALLOW_WRITE: value } });
      assert.deepEqual(await toolNames(client), READ_TOOLS);
    });
  }

  test("calling a write tool in read-only mode fails without running herdr", async () => {
    const { client, fake } = await start();
    for (const [name, args] of [
      ["herdr_agent_prompt", { agent: "reviewer", prompt: "ship it" }],
      ["herdr_agent_send_keys", { agent: "reviewer", keys: "y" }],
      ["herdr_pane_close", { pane_id: "w1:p1" }],
    ] as const) {
      const result = await call(client, name, args);
      assert.equal(result.isError, true, name);
    }
    assert.deepEqual(fake.calls(), []);
  });
});

describe("read tools", () => {
  test("list tools send the arguments herdr 0.9.5 accepts", async () => {
    const { client, fake } = await start();
    assert.match((await call(client, "herdr_workspace_list")).text, /"workspace_id": "w1"/);
    assert.match((await call(client, "herdr_tab_list", { workspace_id: "w1" })).text, /"tab_id": "w1:t2"/);
    assert.match((await call(client, "herdr_pane_list")).text, /"pane_id": "w1:p1"/);
    assert.match((await call(client, "herdr_agent_list")).text, /"agent_status": "blocked"/);
    assert.deepEqual(fake.calls(), [
      ["workspace", "list"],
      ["tab", "list", "--workspace", "w1"],
      ["pane", "list"],
      ["agent", "list"],
    ]);
  });

  test("status asks for the full status locally", async () => {
    const { client, fake } = await start();
    const result = await call(client, "herdr_status");
    assert.equal(result.isError, false);
    assert.match(result.text, /"running": true/);
    assert.deepEqual(fake.calls(), [["status", "--json"]]);
  });

  test("status uses the forwardable form on a remote machine", async () => {
    const { client, fake } = await start({ env: { HERDR_MCP_MACHINE: "Build machine" } });
    assert.equal((await call(client, "herdr_status")).isError, false);
    await call(client, "herdr_agent_list");
    assert.deepEqual(fake.calls(), [
      ["--machine", "Build machine", "status", "server", "--json"],
      ["--machine", "Build machine", "agent", "list"],
    ]);
  });

  test("an unexpanded ${HERDR_MCP_MACHINE} placeholder means no machine", async () => {
    const { client, fake } = await start({ env: { HERDR_MCP_MACHINE: "${HERDR_MCP_MACHINE}" } });
    await call(client, "herdr_agent_list");
    assert.deepEqual(fake.calls(), [["agent", "list"]]);
  });

  test("agent read returns the terminal text herdr prints", async () => {
    const { client, fake } = await start();
    const result = await call(client, "herdr_agent_read", { agent: "reviewer" });
    assert.deepEqual(result, { isError: false, text: "Run tests? (y/n)\n> café ready" });
    assert.deepEqual(fake.calls(), [["agent", "read", "reviewer", "--source", "recent-unwrapped", "--lines", "60"]]);
  });

  test("agent wait always bounds herdr's wait", async () => {
    const { client, fake } = await start();
    await call(client, "herdr_agent_wait", { agent: "w1:p2", until: "done" });
    assert.deepEqual(fake.calls(), [["agent", "wait", "w1:p2", "--until", "done", "--timeout", "120000"]]);
  });

  test("herdr's error code reaches the assistant", async () => {
    const { client } = await start({
      scenario: {
        "agent get": {
          exit: 1,
          stderr: '{"error":{"code":"agent_not_found","message":"agent target ghost not found"},"id":"cli:agent:get"}\n',
        },
      },
    });
    assert.deepEqual(await call(client, "herdr_agent_get", { agent: "ghost" }), {
      isError: true,
      text: "Error [agent_not_found]: agent target ghost not found",
    });
  });
});

describe("argument safety", () => {
  test("flag-shaped or malformed identifiers are rejected before herdr runs", async () => {
    const { client, fake } = await start({ env: WRITE });
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["herdr_agent_get", { agent: "--help" }],
      ["herdr_agent_get", { agent: "-x" }],
      ["herdr_agent_get", { agent: "w1:p1 --wait" }],
      ["herdr_agent_get", { agent: "w1:p1\n" }],
      ["herdr_agent_get", { agent: "" }],
      ["herdr_tab_list", { workspace_id: "--machine" }],
      ["herdr_agent_read", { agent: "reviewer", lines: 100000 }],
      ["herdr_pane_close", { pane_id: "--machine=evil" }],
      ["herdr_agent_send_keys", { agent: "reviewer", keys: "-h" }],
      ["herdr_agent_send_keys", { agent: "reviewer", keys: "y --wait" }],
      ["herdr_agent_start", { name: "Reviewer", kind: "claude", pane_id: "w1:p1" }],
      ["herdr_agent_start", { name: "reviewer", kind: "--help", pane_id: "w1:p1" }],
      ["herdr_agent_rename", { agent: "reviewer", new_name: "-x" }],
      ["herdr_tab_create", { cwd: "-rf" }],
      ["herdr_tab_create", { name: "line\nbreak" }],
    ];
    for (const [name, args] of attempts) {
      const result = await call(client, name, args);
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    }
    assert.deepEqual(fake.calls(), []);
  });

  test("flag-shaped prompt text is passed as a single verbatim argument", async () => {
    const { client, fake } = await start({ env: WRITE });
    const result = await call(client, "herdr_agent_prompt", { agent: "reviewer", prompt: "--wait; rm -rf / $(whoami)" });
    assert.equal(result.isError, false, result.text);
    assert.deepEqual(fake.calls(), [["agent", "prompt", "reviewer", "--wait; rm -rf / $(whoami)"]]);
  });
});

describe("write tools", () => {
  test("prompt passes --timeout only together with --wait", async () => {
    const { client, fake } = await start({ env: WRITE });
    assert.equal((await call(client, "herdr_agent_prompt", { agent: "reviewer", prompt: "hi", timeout_ms: 5000 })).isError, false);
    assert.equal((await call(client, "herdr_agent_prompt", { agent: "reviewer", prompt: "hi", wait: true })).isError, false);
    assert.deepEqual(fake.calls(), [
      ["agent", "prompt", "reviewer", "hi"],
      ["agent", "prompt", "reviewer", "hi", "--wait", "--timeout", "120000"],
    ]);
  });

  test("send_keys passes each key as its own argument", async () => {
    const { client, fake } = await start({ env: WRITE });
    assert.equal((await call(client, "herdr_agent_send_keys", { agent: "reviewer", keys: " down  enter " })).isError, false);
    assert.deepEqual(fake.calls(), [["agent", "send-keys", "reviewer", "down", "enter"]]);
  });

  test("tab_create maps name to --label and leaves focus alone by default", async () => {
    const { client, fake } = await start({ env: WRITE });
    const result = await call(client, "herdr_tab_create", { workspace_id: "w1", cwd: "~/src/api", name: "-logs" });
    assert.match(result.text, /"pane_id": "w1:p3"/);
    await call(client, "herdr_tab_create", { focus: true });
    await call(client, "herdr_tab_create", { focus: true, no_focus: true });
    assert.deepEqual(fake.calls(), [
      ["tab", "create", "--workspace", "w1", "--cwd", "~/src/api", "--label", "-logs", "--no-focus"],
      ["tab", "create", "--focus"],
      ["tab", "create", "--no-focus"],
    ]);
  });

  test("agent start passes native agent arguments after --", async () => {
    const { client, fake } = await start({ env: WRITE });
    await call(client, "herdr_agent_start", { name: "reviewer", kind: "claude", pane_id: "w1:p3", agent_args: ["--model", "opus"] });
    await call(client, "herdr_agent_rename", { agent: "reviewer", new_name: "auditor" });
    await call(client, "herdr_pane_close", { pane_id: "w1:p3" });
    assert.deepEqual(fake.calls(), [
      ["agent", "start", "reviewer", "--kind", "claude", "--pane", "w1:p3", "--", "--model", "opus"],
      ["agent", "rename", "reviewer", "auditor"],
      ["pane", "close", "w1:p3"],
    ]);
  });
});

describe("startup", () => {
  test("an invalid HERDR_MCP_MACHINE stops the server with a clear message", () => {
    const local = fakeHerdr();
    try {
      const run = spawnSync(process.execPath, [SERVER_JS], {
        env: serverEnv(local, { HERDR_MCP_MACHINE: "--evil" }),
        input: "",
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /HERDR_MCP_MACHINE must be a saved herdr machine label/);
      assert.deepEqual(local.calls(), []);
    } finally {
      local.cleanup();
    }
  });
});
