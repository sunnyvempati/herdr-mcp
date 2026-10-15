import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { writeFile, mkdir, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  execHerdr,
  getStatus,
  listAgents,
  listWorkspaces,
  listTabs,
  listPanes,
  getAgent,
  readAgent,
  isWriteAllowed,
} from "../herdr.js";

const FIXTURES = {
  status: {
    result: {
      server: { running: true, version: "0.9.5", session: "default" },
      client: { version: "0.9.5" },
    },
  },
  agentList: {
    id: "cli:agent:list",
    result: {
      type: "agent_list",
      agents: [
        {
          agent: "claude",
          agent_status: "idle",
          pane_id: "w1:p1",
          tab_id: "w1:t1",
          workspace_id: "w1",
          terminal_title: "claude-reviewer",
          cwd: "/home/user/project",
          focused: true,
        },
        {
          agent: "claude",
          agent_status: "working",
          pane_id: "w2:p1",
          tab_id: "w2:t1",
          workspace_id: "w2",
          terminal_title: "feature-work",
          cwd: "/home/user/other",
          focused: false,
        },
        {
          agent: "codex",
          agent_status: "blocked",
          pane_id: "w3:p1",
          tab_id: "w3:t1",
          workspace_id: "w3",
          terminal_title: "needs-approval",
          cwd: "/home/user/third",
          focused: false,
        },
      ],
    },
  },
  workspaceList: {
    result: {
      workspaces: [
        { workspace_id: "w1", name: "project-a", focused: true },
        { workspace_id: "w2", name: "project-b", focused: false },
      ],
    },
  },
  tabList: {
    result: {
      tabs: [
        { tab_id: "w1:t1", workspace_id: "w1", name: "main", focused: true },
        { tab_id: "w1:t2", workspace_id: "w1", name: "logs", focused: false },
      ],
    },
  },
  paneList: {
    result: {
      panes: [
        { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", focused: true },
        { pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", focused: false },
      ],
    },
  },
  agentGet: {
    result: {
      agent: "claude",
      agent_status: "idle",
      pane_id: "w1:p1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      terminal_title: "claude-reviewer",
      cwd: "/home/user/project",
      focused: true,
      revision: 5,
      state_change_seq: 42,
    },
  },
  agentRead: {
    result: {
      content: "Agent output line 1\nAgent output line 2\n> Ready for input",
      source: "recent-unwrapped",
      lines: 3,
    },
  },
};

let fakeHerdrDir: string;
let fakeHerdrPath: string;
let originalPath: string;

async function createFakeHerdr(scriptContent: string): Promise<void> {
  await writeFile(fakeHerdrPath, scriptContent, "utf-8");
  await chmod(fakeHerdrPath, 0o755);
}

function makeSuccessScript(responses: Record<string, unknown>): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
const responses = ${JSON.stringify(responses)};

// Handle different command patterns
const cmd = args.filter(a => !a.startsWith('--')).join(' ');

// Check for specific commands
if (cmd === 'status --json' || cmd === 'status') {
  console.log(JSON.stringify(responses.status || {}));
} else if (cmd === 'agent list' || cmd.includes('agent list')) {
  console.log(JSON.stringify(responses.agentList || {}));
} else if (cmd.startsWith('agent get')) {
  console.log(JSON.stringify(responses.agentGet || {}));
} else if (cmd.startsWith('agent read')) {
  console.log(JSON.stringify(responses.agentRead || {}));
} else if (cmd === 'workspace list --json' || cmd.includes('workspace list')) {
  console.log(JSON.stringify(responses.workspaceList || {}));
} else if (cmd.includes('tab list')) {
  console.log(JSON.stringify(responses.tabList || {}));
} else if (cmd.includes('pane list')) {
  console.log(JSON.stringify(responses.paneList || {}));
} else {
  console.log('{}');
}
`;
}

describe("herdr CLI executor", () => {
  before(async () => {
    fakeHerdrDir = join(tmpdir(), `herdr-mcp-test-${Date.now()}`);
    fakeHerdrPath = join(fakeHerdrDir, "herdr");
    await mkdir(fakeHerdrDir, { recursive: true });
    originalPath = process.env.PATH || "";
    process.env.PATH = `${fakeHerdrDir}:${originalPath}`;
  });

  after(async () => {
    process.env.PATH = originalPath;
    await rm(fakeHerdrDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await createFakeHerdr(makeSuccessScript(FIXTURES));
  });

  test("getStatus returns server info", async () => {
    const result = await getStatus();
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.server?.running, true);
    assert.strictEqual(result.data.server?.version, "0.9.5");
  });

  test("listAgents returns agent list", async () => {
    const result = await listAgents();
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.agents.length, 3);
    assert.strictEqual(result.data.agents[0].agent_status, "idle");
    assert.strictEqual(result.data.agents[1].agent_status, "working");
    assert.strictEqual(result.data.agents[2].agent_status, "blocked");
  });

  test("listWorkspaces returns workspace list", async () => {
    const result = await listWorkspaces();
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.workspaces.length, 2);
  });

  test("listTabs returns tab list", async () => {
    const result = await listTabs("w1");
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.tabs.length, 2);
  });

  test("listPanes returns pane list", async () => {
    const result = await listPanes("w1");
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.panes.length, 2);
  });

  test("getAgent returns agent info", async () => {
    const result = await getAgent("reviewer");
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data.agent_status, "idle");
  });

  test("readAgent returns terminal content", async () => {
    const result = await readAgent("reviewer", { lines: 50 });
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.ok(result.data.content.includes("Agent output"));
  });

  test("handles server error response", async () => {
    const errorScript = `#!/usr/bin/env node
console.error(JSON.stringify({ code: "server_not_running", message: "herdr server is not running" }));
process.exit(1);
`;
    await createFakeHerdr(errorScript);
    const result = await getStatus();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, "server_not_running");
  });

  test("handles herdr not found", async () => {
    const oldPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    const result = await execHerdr(["status"]);
    process.env.PATH = oldPath;
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, "herdr_not_found");
  });

  test("handles timeout", async () => {
    const sleepScript = `#!/usr/bin/env node
setTimeout(() => {}, 60000);
`;
    await createFakeHerdr(sleepScript);
    const result = await execHerdr(["status"], { timeout: 100 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, "timeout");
  });

  test("passes --machine flag when specified", async () => {
    const machineScript = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--machine' && args[1] === 'my-server') {
  console.log(JSON.stringify({ result: { machine: 'my-server', connected: true } }));
} else {
  console.log(JSON.stringify({ result: { machine: null } }));
}
`;
    await createFakeHerdr(machineScript);
    const result = await execHerdr(["status"], { machine: "my-server" });
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.deepStrictEqual(result.data, { machine: "my-server", connected: true });
  });
});

describe("write permission guard", () => {
  test("isWriteAllowed returns false by default", () => {
    delete process.env.HERDR_MCP_ALLOW_WRITE;
    assert.strictEqual(isWriteAllowed(), false);
  });

  test("isWriteAllowed returns true when set", () => {
    process.env.HERDR_MCP_ALLOW_WRITE = "1";
    assert.strictEqual(isWriteAllowed(), true);
    delete process.env.HERDR_MCP_ALLOW_WRITE;
  });
});
