import fs from 'fs';
import path from 'path';

const DEFAULT_MAX_STRING = 8_000;
const DEFAULT_MAX_ARRAY = 200;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERNS = ['password', 'secret', 'token', 'apikey', 'api_key', 'authorization', 'cookie'];

function ensureLogFile(logFilePath) {
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '');
  }
}

function isSensitiveKey(key) {
  const lowered = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowered.includes(pattern));
}

function sanitizeValue(value, depth = 0) {
  if (depth > 8) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length <= DEFAULT_MAX_STRING) return value;
    return `${value.slice(0, DEFAULT_MAX_STRING)}… [truncated ${value.length - DEFAULT_MAX_STRING} chars]`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, DEFAULT_MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > DEFAULT_MAX_ARRAY) {
      sliced.push(`[truncated ${value.length - DEFAULT_MAX_ARRAY} items]`);
    }
    return sliced;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const sanitized = {};

    for (const [key, child] of entries) {
      sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(child, depth + 1);
    }

    return sanitized;
  }

  return String(value);
}

function parseEvents(logFilePath) {
  ensureLogFile(logFilePath);

  const content = fs.readFileSync(logFilePath, 'utf8');
  if (!content.trim()) return [];

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function initializeSequence(logFilePath) {
  const events = parseEvents(logFilePath);
  return events.reduce((max, event) => {
    const seq = typeof event.sequence === 'number' ? event.sequence : 0;
    return Math.max(max, seq);
  }, 0);
}

export function createToolEventLogger(projectRoot) {
  const logFilePath = path.join(projectRoot, 'logs', 'tool-calls.jsonl');
  ensureLogFile(logFilePath);

  let sequence = initializeSequence(logFilePath);

  function startEvent({
    tool_name,
    args,
    source,
    server_id = null,
    server_name = null,
    mcp_tool_name = null,
    replay_of = null,
  }) {
    sequence += 1;

    return {
      id: `tool_evt_${sequence}`,
      sequence,
      source,
      tool_name,
      mcp_tool_name,
      server_id,
      server_name,
      replay_of,
      args: cloneJsonSafe(args ?? {}),
      args_preview: sanitizeValue(args ?? {}),
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_ms: null,
      status: 'running',
      error_message: null,
      result: null,
    };
  }

  function finalizeSuccess(event, result) {
    const endedAt = new Date();
    const started = new Date(event.started_at);

    return {
      ...event,
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - started.getTime(),
      status: 'success',
      result: sanitizeValue(result),
      error_message: null,
    };
  }

  function finalizeError(event, errorMessage, partialResult = null) {
    const endedAt = new Date();
    const started = new Date(event.started_at);

    return {
      ...event,
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - started.getTime(),
      status: 'error',
      result: sanitizeValue(partialResult),
      error_message: String(errorMessage || 'Unknown tool execution error'),
    };
  }

  function persist(event) {
    fs.appendFileSync(logFilePath, `${JSON.stringify(event)}\n`);
    return event;
  }

  function getEventById(id) {
    const events = parseEvents(logFilePath);
    return events.find((event) => event.id === id) ?? null;
  }

  function listEvents(filters = {}) {
    const events = parseEvents(logFilePath);
    let filtered = events;

    const { tool_name, status, server_id, limit = 100 } = filters;

    if (tool_name && typeof tool_name === 'string') {
      const needle = tool_name.trim().toLowerCase();
      if (needle) {
        filtered = filtered.filter((e) => {
          const name = (e.tool_name || '').toLowerCase();
          const mcpName = (e.mcp_tool_name || '').toLowerCase();
          return name.includes(needle) || mcpName.includes(needle);
        });
      }
    }

    if (status && typeof status === 'string') {
      const needle = status.trim().toLowerCase();
      if (needle) {
        filtered = filtered.filter((e) => (e.status || '').toLowerCase() === needle);
      }
    }

    if (server_id && typeof server_id === 'string') {
      const needle = server_id.trim().toLowerCase();
      if (needle) {
        filtered = filtered.filter((e) => (e.server_id || '').toLowerCase() === needle);
      }
    }

    filtered.sort((a, b) => (b.sequence || 0) - (a.sequence || 0));
    return filtered.slice(0, Math.max(0, Number(limit) || 100));
  }

  return {
    startEvent,
    finalizeSuccess,
    finalizeError,
    persist,
    getEventById,
    listEvents,
  };
}
