#!/usr/bin/env bash
# smoke.sh - End-to-end smoke test for herdr-mcp read-only tools
# Run on a Mac with herdr installed and a session running
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "herdr-mcp smoke test"
echo "===================="
echo ""

# Check prerequisites
if ! command -v herdr &> /dev/null; then
    echo -e "${RED}Error: herdr not found in PATH${NC}"
    echo "Install herdr from https://herdr.dev"
    exit 1
fi

if ! herdr status --json &> /dev/null; then
    echo -e "${RED}Error: herdr server not running${NC}"
    echo "Start herdr with: herdr"
    exit 1
fi

echo -e "${GREEN}✓ herdr is installed and running${NC}"
echo ""

# Build the project if needed
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ ! -f "build/index.js" ]; then
    echo "Building herdr-mcp..."
    npm run build
fi

# Helper to call a tool via the MCP server
call_tool() {
    local tool_name="$1"
    local args="${2:-{}}"
    
    local request='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"'"$tool_name"'","arguments":'"$args"'}}'
    
    # Use a simple node script to send JSON-RPC to the MCP server
    echo "$request" | timeout 10 node -e "
const { spawn } = require('child_process');
const child = spawn('node', ['build/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });

let buffer = '';
child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    for (const line of lines.slice(0, -1)) {
        if (line.trim()) {
            try {
                const msg = JSON.parse(line);
                if (msg.id === 1) {
                    console.log(JSON.stringify(msg, null, 2));
                    child.kill();
                    process.exit(0);
                }
            } catch {}
        }
    }
    buffer = lines[lines.length - 1];
});

process.stdin.pipe(child.stdin);
setTimeout(() => { child.kill(); process.exit(1); }, 9000);
" 2>/dev/null || echo '{"error":"timeout"}'
}

# Test each read-only tool
echo "Testing read-only tools..."
echo ""

echo -e "${YELLOW}1. herdr_status${NC}"
call_tool "herdr_status" | head -20
echo ""

echo -e "${YELLOW}2. herdr_workspace_list${NC}"
call_tool "herdr_workspace_list" | head -20
echo ""

echo -e "${YELLOW}3. herdr_tab_list${NC}"
call_tool "herdr_tab_list" | head -20
echo ""

echo -e "${YELLOW}4. herdr_pane_list${NC}"
call_tool "herdr_pane_list" | head -20
echo ""

echo -e "${YELLOW}5. herdr_agent_list${NC}"
call_tool "herdr_agent_list" | head -30
echo ""

# If there are agents, test agent-specific tools
AGENTS=$(herdr agent list 2>/dev/null | jq -r '.result.agents[0].pane_id // empty' 2>/dev/null || true)
if [ -n "$AGENTS" ]; then
    echo -e "${YELLOW}6. herdr_agent_get (first agent)${NC}"
    call_tool "herdr_agent_get" '{"agent":"'"$AGENTS"'"}' | head -20
    echo ""
    
    echo -e "${YELLOW}7. herdr_agent_read (first agent, 20 lines)${NC}"
    call_tool "herdr_agent_read" '{"agent":"'"$AGENTS"'","lines":20}' | head -30
    echo ""
else
    echo -e "${YELLOW}6-7. Skipping agent_get and agent_read (no agents running)${NC}"
    echo ""
fi

echo -e "${GREEN}Smoke test complete!${NC}"
echo ""
echo "Note: Write tools (herdr_tab_create, herdr_agent_start, herdr_agent_prompt,"
echo "herdr_agent_send_keys, herdr_agent_rename, herdr_pane_close) require"
echo "HERDR_MCP_ALLOW_WRITE=1 and were not tested."
