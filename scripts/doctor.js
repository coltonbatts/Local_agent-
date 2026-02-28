#!/usr/bin/env node
/**
 * Doctor – checks model endpoint, tools server, Brave key, and MCP servers.
 * Run: npm run doctor
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const PORT = process.env.PORT || 3001;
const TOOLS_BASE = `http://127.0.0.1:${PORT}`;

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => console.log(`  ✗ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);

function getModelBaseUrl() {
  const configPath = path.join(PROJECT_ROOT, 'config', 'app-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      return (parsed.modelBaseUrl || 'http://127.0.0.1:1234').replace(/\/$/, '');
    }
  } catch {
    // fall through
  }
  return 'http://127.0.0.1:1234';
}

async function checkModelEndpoint() {
  const baseUrl = getModelBaseUrl();
  console.log('\nModel endpoint');
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const count = data.data?.length ?? 0;
      ok(`Reachable at ${baseUrl} (${count} model(s))`);
      return true;
    }
    fail(`HTTP ${res.status} from ${baseUrl}`);
    return false;
  } catch (err) {
    fail(`Unreachable: ${err.message}`);
    return false;
  }
}

async function checkToolsServer() {
  console.log('\nTools server');
  try {
    const res = await fetch(`${TOOLS_BASE}/api/config`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      ok(`Reachable at ${TOOLS_BASE}`);
      return true;
    }
    fail(`HTTP ${res.status} from ${TOOLS_BASE}`);
    return false;
  } catch (err) {
    fail(`Unreachable: ${err.message}`);
    return false;
  }
}

function checkBraveKey() {
  console.log('\nBrave Search API');
  const key = process.env.BRAVE_API_KEY;
  if (key && key.trim()) {
    ok('BRAVE_API_KEY is set');
    return true;
  }
  warn('BRAVE_API_KEY not set (optional – brave_search tool disabled)');
  return true;
}

async function checkMcpServers() {
  console.log('\nMCP servers');
  const configPath = path.join(PROJECT_ROOT, 'config', 'mcp-servers.json');
  let servers = [];
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      servers = (parsed.servers || []).filter((s) => s.enabled);
    }
  } catch {
    // ignore
  }

  if (servers.length === 0) {
    warn('No enabled MCP servers configured (optional)');
    return true;
  }

  let allOk = true;
  const { withMcpConnection } = await import('../backend/mcpClient.js');
  const { createMcpConfigStore } = await import('../backend/mcpConfigStore.js');
  const store = createMcpConfigStore(PROJECT_ROOT);

  for (const server of servers) {
    try {
      const full = store.getServerById(server.id);
      if (!full) continue;
      await withMcpConnection(full, async () => {}, { connectTimeoutMs: 3000 });
      ok(`${server.id}: reachable`);
    } catch (err) {
      fail(`${server.id}: ${err.message}`);
      allOk = false;
    }
  }
  return allOk;
}

async function main() {
  console.log('Local Chat Model UI – Doctor');
  console.log('Project:', PROJECT_ROOT);

  const modelOk = await checkModelEndpoint();
  const toolsOk = await checkToolsServer();
  checkBraveKey();
  const mcpOk = await checkMcpServers();

  console.log('');

  if (modelOk && toolsOk) {
    console.log('Ready to run. Start with: npm run dev:all');
  } else {
    console.log('Fix the issues above, then run: npm run dev:all');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
