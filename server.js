import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createNativeToolExecutor, parseInternalSkillFrontmatter } from './backend/nativeTools.js';
import { createMcpConfigStore } from './backend/mcpConfigStore.js';
import { createAppConfigStore } from './backend/appConfigStore.js';
import { call_tool, list_tools, withMcpConnection } from './backend/mcpClient.js';
import { createToolEventLogger } from './backend/toolEventLogger.js';
import { runSync, readSyncState } from './backend/syncSkills.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname);
const SKILLS_DIR = path.join(__dirname, '.agents', 'skills');
const CHATS_DIR = path.join(__dirname, 'chats');

const app = express();
const PORT = process.env.PORT || 3001;

const mcpConfigStore = createMcpConfigStore(PROJECT_ROOT);
const appConfigStore = createAppConfigStore(PROJECT_ROOT);
const toolEventLogger = createToolEventLogger(PROJECT_ROOT);
const nativeTools = createNativeToolExecutor({
  projectRoot: PROJECT_ROOT,
  skillsDir: SKILLS_DIR,
  getBraveApiKey: () => process.env.BRAVE_API_KEY,
});

const allowedOrigins = (
  process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5174'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json({ limit: '1mb' }));

// Model API proxy – forwards /v1/* to configured model base URL (LM Studio, Ollama, etc.)
app.use(
  '/v1',
  createProxyMiddleware({
    target: 'http://127.0.0.1:1234',
    changeOrigin: true,
    router: () => appConfigStore.getModelBaseUrl(),
    onError: (err, req, res) => {
      console.error('Model proxy error:', err.message);
      res.status(502).json({ error: `Model server unreachable: ${err.message}` });
    },
  })
);

const toolApiKey = process.env.TOOL_API_KEY;
const requireToolAuth = (req, res, next) => {
  if (!toolApiKey) return next();
  const provided = req.header('x-tool-api-key');
  if (provided !== toolApiKey) {
    const hint = !provided
      ? 'No x-tool-api-key header sent. Set VITE_TOOL_API_KEY in your frontend .env to match the server TOOL_API_KEY.'
      : 'x-tool-api-key does not match. Ensure VITE_TOOL_API_KEY matches TOOL_API_KEY in the server .env.';
    return res.status(401).json({
      error: 'TOOL_API_KEY mismatch',
      code: 'TOOL_API_KEY_MISMATCH',
      hint,
    });
  }
  return next();
};

// Rate-limit tool endpoints to prevent accidental runaway loops (even locally)
const toolRateLimitMap = new Map();
const TOOL_RATE_WINDOW_MS = 60 * 1000;
const TOOL_RATE_MAX = 120;
function toolRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = toolRateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + TOOL_RATE_WINDOW_MS };
    toolRateLimitMap.set(ip, record);
  }
  record.count += 1;
  if (record.count > TOOL_RATE_MAX) {
    return res.status(429).json({
      error: 'Too many tool requests',
      code: 'RATE_LIMIT_EXCEEDED',
      hint: 'Slow down. Tool endpoints are rate-limited to prevent runaway loops.',
    });
  }
  next();
}

app.get('/api/config', (req, res) => {
  try {
    res.json(appConfigStore.getConfig());
  } catch (err) {
    console.error('Get Config Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load config' });
  }
});

app.put('/api/config', requireToolAuth, (req, res) => {
  try {
    const updated = appConfigStore.updateConfig(req.body ?? {});
    res.json(updated);
  } catch (err) {
    console.error('Update Config Error:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update config' });
  }
});

function parseMcpToolName(fullToolName) {
  if (!fullToolName.startsWith('mcp.')) return null;

  const parts = fullToolName.split('.');
  if (parts.length < 3) {
    throw new Error(
      `Invalid MCP tool name '${fullToolName}'. Expected format: mcp.<server_id>.<tool_name>`
    );
  }

  const serverId = parts[1];
  const toolName = parts.slice(2).join('.');

  if (!serverId || !toolName) {
    throw new Error(`Invalid MCP tool name '${fullToolName}'. Missing server_id or tool_name.`);
  }

  return { serverId, toolName };
}

function toNamespacedMcpToolName(serverId, toolName) {
  return `mcp.${serverId}.${toolName}`;
}

function sortByToolIdentity(tools) {
  return [...tools].sort((a, b) => {
    const serverCompare = String(a.server_id).localeCompare(String(b.server_id));
    if (serverCompare !== 0) return serverCompare;
    return String(a.tool_name).localeCompare(String(b.tool_name));
  });
}

function toModelToolDefinition(tool) {
  const description = [
    `MCP server: ${tool.server_name} (${tool.server_id})`,
    tool.description || 'No description provided by MCP server.',
  ].join(' | ');

  return {
    type: 'function',
    function: {
      name: toNamespacedMcpToolName(tool.server_id, tool.tool_name),
      description,
      parameters:
        tool.input_schema && typeof tool.input_schema === 'object'
          ? tool.input_schema
          : { type: 'object', properties: {} },
    },
  };
}

async function discoverEnabledMcpTools() {
  const enabledServers = mcpConfigStore
    .listServers()
    .filter((server) => server.enabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  const collectedTools = [];
  const errors = [];

  for (const server of enabledServers) {
    try {
      const tools = await withMcpConnection(server, async (connection) => list_tools(connection));
      const sortedTools = tools.sort((a, b) => a.tool_name.localeCompare(b.tool_name));
      collectedTools.push(...sortedTools);
    } catch (err) {
      errors.push({
        server_id: server.id,
        server_name: server.name,
        error: err instanceof Error ? err.message : 'Unknown MCP discovery error',
      });
    }
  }

  return {
    tools: sortByToolIdentity(collectedTools),
    errors,
  };
}

async function executeToolCall({ toolName, args, replayOf = null }) {
  let event;

  try {
    const parsedMcp = parseMcpToolName(toolName);

    if (parsedMcp) {
      const server = mcpConfigStore.getServerById(parsedMcp.serverId);
      if (!server) {
        throw new Error(`MCP server '${parsedMcp.serverId}' was not found`);
      }
      if (!server.enabled) {
        throw new Error(`MCP server '${parsedMcp.serverId}' is disabled`);
      }

      event = toolEventLogger.startEvent({
        source: 'mcp',
        tool_name: toolName,
        mcp_tool_name: parsedMcp.toolName,
        server_id: server.id,
        server_name: server.name,
        args,
        replay_of: replayOf,
      });

      try {
        const result = await withMcpConnection(server, async (connection) =>
          call_tool(connection, parsedMcp.toolName, args)
        );
        const finalized = toolEventLogger.finalizeSuccess(event, result);
        toolEventLogger.persist(finalized);

        return {
          event: finalized,
          result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown MCP tool execution error';
        const errorResult = { error: message };
        const finalized = toolEventLogger.finalizeError(event, message, errorResult);
        toolEventLogger.persist(finalized);

        return {
          event: finalized,
          result: errorResult,
        };
      }
    }

    if (!nativeTools.isNativeTool(toolName)) {
      throw new Error(`Unsupported tool: ${toolName}`);
    }

    event = toolEventLogger.startEvent({
      source: 'native',
      tool_name: toolName,
      args,
      replay_of: replayOf,
    });

    try {
      const result = await nativeTools.execute(toolName, args);
      const finalized = toolEventLogger.finalizeSuccess(event, result);
      toolEventLogger.persist(finalized);

      return {
        event: finalized,
        result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown native tool execution error';
      const errorResult = { error: message };
      const finalized = toolEventLogger.finalizeError(event, message, errorResult);
      toolEventLogger.persist(finalized);

      return {
        event: finalized,
        result: errorResult,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown tool routing error';

    const fallbackEvent = toolEventLogger.startEvent({
      source: 'native',
      tool_name: toolName,
      args,
      replay_of: replayOf,
    });
    const finalized = toolEventLogger.finalizeError(fallbackEvent, message, { error: message });
    toolEventLogger.persist(finalized);

    return {
      event: finalized,
      result: { error: message },
    };
  }
}

if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR, { recursive: true });
}

app.get('/api/tools/definitions', async (req, res) => {
  try {
    const nativeToolDefinitions = nativeTools.listToolDefinitions();
    const { tools: mcpTools, errors } = await discoverEnabledMcpTools();
    const mcpDefinitions = mcpTools.map(toModelToolDefinition);

    res.json({
      tools: [...nativeToolDefinitions, ...mcpDefinitions],
      mcp_tools: mcpTools,
      errors,
    });
  } catch (err) {
    console.error('Tool Definitions Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list tool definitions' });
  }
});

// Backwards-compatible tool endpoints for existing native tool integrations
app.use('/api/tools', toolRateLimit);

app.post('/api/tools/read_file', requireToolAuth, async (req, res) => {
  const { result } = await executeToolCall({ toolName: 'read_file', args: req.body });
  if (result?.error) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

app.post('/api/tools/brave_search', requireToolAuth, async (req, res) => {
  const { result } = await executeToolCall({ toolName: 'brave_search', args: req.body });
  if (result?.error) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

app.post('/api/tools/load_skill', requireToolAuth, async (req, res) => {
  const { result } = await executeToolCall({ toolName: 'load_skill', args: req.body });
  if (result?.error) {
    return res.status(500).json(result);
  }
  return res.json(result);
});

app.post('/api/tools/execute', requireToolAuth, async (req, res) => {
  try {
    const { toolName, args } = req.body ?? {};
    if (!toolName || typeof toolName !== 'string') {
      return res.status(400).json({ error: 'toolName is required' });
    }

    const execution = await executeToolCall({
      toolName,
      args: args && typeof args === 'object' ? args : {},
    });

    res.json(execution);
  } catch (err) {
    console.error('Tool Execute Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to execute tool' });
  }
});

app.get('/api/tools/events', (req, res) => {
  try {
    const tool_name = req.query.tool_name;
    const status = req.query.status;
    const server_id = req.query.server_id;
    const limit = req.query.limit;

    const events = toolEventLogger.listEvents({
      tool_name: tool_name ? String(tool_name) : undefined,
      status: status ? String(status) : undefined,
      server_id: server_id ? String(server_id) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.json({ events });
  } catch (err) {
    console.error('List Tool Events Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list tool events' });
  }
});

app.get('/api/tools/events/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ error: 'event id is required' });
    }

    const event = toolEventLogger.getEventById(id);
    if (!event) {
      return res.status(404).json({ error: `Tool event '${id}' not found` });
    }

    res.json({ event });
  } catch (err) {
    console.error('Get Tool Event Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to get tool event' });
  }
});

app.post('/api/tools/replay/:eventId', requireToolAuth, async (req, res) => {
  try {
    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required' });
    }

    const original = toolEventLogger.getEventById(eventId);
    if (!original) {
      return res.status(404).json({ error: `Tool event '${eventId}' not found` });
    }

    const execution = await executeToolCall({
      toolName: original.tool_name,
      args: original.args ?? {},
      replayOf: original.id,
    });

    res.json(execution);
  } catch (err) {
    console.error('Replay Tool Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to replay tool call' });
  }
});

// GET all available skills + sync state
app.get('/api/skills', (req, res) => {
  try {
    const syncState = readSyncState(PROJECT_ROOT);

    if (!fs.existsSync(SKILLS_DIR)) {
      return res.json({ skills: [], syncState });
    }

    const skillFolders = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() || dirent.isSymbolicLink())
      .map((dirent) => dirent.name);

    const skills = [];
    for (const folder of skillFolders) {
      const skillMdPath = path.join(SKILLS_DIR, folder, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf8');
        const metadata = parseInternalSkillFrontmatter(content);
        skills.push({ ...metadata, folderName: folder });
      }
    }

    return res.json({ skills, syncState });
  } catch (err) {
    console.error('List Skills Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Error listing skills' });
  }
});

// POST sync skills from lock file
app.post('/api/skills/sync', requireToolAuth, async (req, res) => {
  try {
    const state = await runSync(PROJECT_ROOT);
    res.json({ success: true, syncState: state });
  } catch (err) {
    console.error('Sync Skills Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to sync skills' });
  }
});

app.get('/api/mcp/servers', (req, res) => {
  try {
    const servers = mcpConfigStore.listServers();
    res.json({ servers });
  } catch (err) {
    console.error('List MCP Servers Error:', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list MCP servers' });
  }
});

app.post('/api/mcp/servers', requireToolAuth, (req, res) => {
  try {
    const created = mcpConfigStore.addServer(req.body ?? {});
    res.json({ server: created });
  } catch (err) {
    console.error('Create MCP Server Error:', err);
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : 'Failed to create MCP server' });
  }
});

app.put('/api/mcp/servers/:id', requireToolAuth, (req, res) => {
  try {
    const updated = mcpConfigStore.updateServer(req.params.id, req.body ?? {});
    res.json({ server: updated });
  } catch (err) {
    console.error('Update MCP Server Error:', err);
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : 'Failed to update MCP server' });
  }
});

app.delete('/api/mcp/servers/:id', requireToolAuth, (req, res) => {
  try {
    mcpConfigStore.removeServer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete MCP Server Error:', err);
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : 'Failed to delete MCP server' });
  }
});

app.post('/api/mcp/servers/:id/test', requireToolAuth, async (req, res) => {
  try {
    const server = mcpConfigStore.getServerById(req.params.id);
    if (!server) {
      return res.status(404).json({ error: `MCP server '${req.params.id}' not found` });
    }

    const tools = await withMcpConnection(server, async (connection) => list_tools(connection));
    return res.json({
      success: true,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.tool_name),
    });
  } catch (err) {
    console.error('Test MCP Server Error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to connect to MCP server',
    });
  }
});

app.get('/api/mcp/tools', async (req, res) => {
  try {
    const query = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    const { tools, errors } = await discoverEnabledMcpTools();

    const filtered = query
      ? tools.filter((tool) => {
          const haystack = [tool.server_name, tool.server_id, tool.tool_name, tool.description]
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        })
      : tools;

    const grouped = filtered.reduce((acc, tool) => {
      if (!acc[tool.server_id]) {
        acc[tool.server_id] = {
          server_id: tool.server_id,
          server_name: tool.server_name,
          tools: [],
        };
      }

      acc[tool.server_id].tools.push(tool);
      return acc;
    }, {});

    return res.json({
      tools: filtered,
      grouped: Object.values(grouped).sort((a, b) => a.server_id.localeCompare(b.server_id)),
      errors,
    });
  } catch (err) {
    console.error('List MCP Tools Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Failed to list MCP tools' });
  }
});

// Save a chat session (create new)
app.post('/api/chats', requireToolAuth, (req, res) => {
  try {
    const { messages, title } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const safeTitle = (title || 'chat').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeTimestamp}_${safeTitle}.json`;
    const filepath = path.join(CHATS_DIR, filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify({ messages, title, timestamp, pinned: false }, null, 2)
    );
    return res.json({ success: true, filename });
  } catch (err) {
    console.error('Save Chat Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Error saving chat' });
  }
});

// Update a chat session (rename, pin, or overwrite messages)
app.put('/api/chats/:filename', requireToolAuth, (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename || !safeFilename.endsWith('.json')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filepath = path.join(CHATS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Chat file not found' });
    }

    const existing = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const { title, pinned, messages } = req.body ?? {};

    if (typeof title === 'string' && title.trim()) {
      existing.title = title.trim();
    }
    if (typeof pinned === 'boolean') {
      existing.pinned = pinned;
    }
    if (messages && Array.isArray(messages)) {
      existing.messages = messages;
    }

    fs.writeFileSync(filepath, JSON.stringify(existing, null, 2));
    return res.json({
      success: true,
      filename: safeFilename,
      title: existing.title,
      pinned: !!existing.pinned,
    });
  } catch (err) {
    console.error('Update Chat Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Error updating chat' });
  }
});

// Load all saved chats (metadata) – pinned first, then by timestamp
app.get('/api/chats', (req, res) => {
  try {
    const files = fs.readdirSync(CHATS_DIR).filter((file) => file.endsWith('.json'));
    const chats = files
      .map((file) => {
        const filepath = path.join(CHATS_DIR, file);
        try {
          const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
          return {
            filename: file,
            title: data.title || 'Untitled Chat',
            timestamp: data.timestamp || fs.statSync(filepath).mtime,
            pinned: !!data.pinned,
          };
        } catch {
          return null;
        }
      })
      .filter((chat) => chat !== null)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

    return res.json({ chats });
  } catch (err) {
    console.error('Load Chats Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Error loading chats' });
  }
});

// Load a specific chat file
app.get('/api/chats/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename || !safeFilename.endsWith('.json')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filepath = path.join(CHATS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Chat file not found' });
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return res.json(data);
  } catch (err) {
    console.error('Load Chat Error:', err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Error loading chat file' });
  }
});

// Health check endpoint (must respond quickly, never block)
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve built frontend in production (when not behind Vite dev server)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/v1')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Tool Execution Server running on http://127.0.0.1:${PORT}`);
});
