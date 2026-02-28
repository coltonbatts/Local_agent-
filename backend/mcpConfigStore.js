import fs from 'fs';
import path from 'path';

const SUPPORTED_TRANSPORTS = new Set(['stdio', 'http', 'sse']);
const SERVER_ID_REGEX = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function defaultCapabilityWarning(transport) {
  if (transport === 'stdio') {
    return 'This server runs a local process and may access filesystem, shell commands, and network resources.';
  }

  return 'This server connects over the network and may perform any action implemented by the remote MCP service.';
}

function ensureConfigFile(configPath) {
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ servers: [] }, null, 2));
  }
}

function loadConfig(configPath) {
  ensureConfigFile(configPath);

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.servers)) {
      return { servers: [] };
    }

    return { servers: parsed.servers };
  } catch {
    return { servers: [] };
  }
}

function saveConfig(configPath, servers) {
  const sorted = [...servers].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(configPath, JSON.stringify({ servers: sorted }, null, 2));
}

function parseArgs(argsInput) {
  if (!argsInput) return [];
  if (Array.isArray(argsInput)) {
    return argsInput.map((arg) => String(arg)).filter(Boolean);
  }

  if (typeof argsInput === 'string') {
    return argsInput
      .split(' ')
      .map((arg) => arg.trim())
      .filter(Boolean);
  }

  throw new Error('args must be an array of strings or a string');
}

function normalizeEnv(envInput) {
  if (!envInput) return undefined;

  if (typeof envInput !== 'object' || Array.isArray(envInput)) {
    throw new Error('env must be an object of string values');
  }

  const normalized = {};
  for (const [key, value] of Object.entries(envInput)) {
    if (!key) continue;
    normalized[key] = String(value);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeServerPayload(input, existingServer) {
  const base = existingServer ?? {};

  const id = String(input.id ?? base.id ?? '').trim().toLowerCase();
  if (!id || !SERVER_ID_REGEX.test(id)) {
    throw new Error("id is required and must match /^[a-z0-9][a-z0-9_-]{1,63}$/");
  }

  const transport = String(input.transport ?? base.transport ?? '').trim().toLowerCase();
  if (!SUPPORTED_TRANSPORTS.has(transport)) {
    throw new Error("transport must be one of: 'stdio', 'http', 'sse'");
  }

  const normalized = {
    id,
    name: String(input.name ?? base.name ?? id).trim() || id,
    transport,
    command: undefined,
    args: undefined,
    url: undefined,
    env: undefined,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : Boolean(base.enabled),
    capabilities_warning:
      String(input.capabilities_warning ?? base.capabilities_warning ?? '').trim() ||
      defaultCapabilityWarning(transport),
  };

  if (transport === 'stdio') {
    const command = String(input.command ?? base.command ?? '').trim();
    if (!command) {
      throw new Error("command is required when transport is 'stdio'");
    }

    normalized.command = command;
    normalized.args = parseArgs(input.args ?? base.args);
    normalized.env = normalizeEnv(input.env ?? base.env);
  } else {
    const url = String(input.url ?? base.url ?? '').trim();
    if (!url) {
      throw new Error(`url is required when transport is '${transport}'`);
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    normalized.url = url;
    normalized.env = undefined;
    normalized.command = undefined;
    normalized.args = undefined;
  }

  return normalized;
}

export function createMcpConfigStore(projectRoot) {
  const configPath = path.join(projectRoot, 'config', 'mcp-servers.json');

  function listServers() {
    return loadConfig(configPath).servers;
  }

  function getServerById(id) {
    const normalizedId = String(id).trim().toLowerCase();
    return listServers().find((server) => server.id === normalizedId) ?? null;
  }

  function addServer(input) {
    const current = listServers();
    const normalized = normalizeServerPayload({ ...input, enabled: false });

    if (current.some((server) => server.id === normalized.id)) {
      throw new Error(`MCP server with id '${normalized.id}' already exists`);
    }

    const next = [...current, normalized];
    saveConfig(configPath, next);
    return normalized;
  }

  function updateServer(id, patch) {
    const normalizedId = String(id).trim().toLowerCase();
    const current = listServers();
    const existingIndex = current.findIndex((server) => server.id === normalizedId);

    if (existingIndex < 0) {
      throw new Error(`MCP server '${normalizedId}' not found`);
    }

    const updated = normalizeServerPayload({ ...patch, id: normalizedId }, current[existingIndex]);

    const next = [...current];
    next[existingIndex] = updated;
    saveConfig(configPath, next);
    return updated;
  }

  function removeServer(id) {
    const normalizedId = String(id).trim().toLowerCase();
    const current = listServers();
    const next = current.filter((server) => server.id !== normalizedId);

    if (next.length === current.length) {
      throw new Error(`MCP server '${normalizedId}' not found`);
    }

    saveConfig(configPath, next);
  }

  return {
    listServers,
    getServerById,
    addServer,
    updateServer,
    removeServer,
  };
}
