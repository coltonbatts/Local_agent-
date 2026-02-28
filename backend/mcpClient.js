import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_CLIENT_INFO = { name: 'local-chat-mcp-client', version: '1.0.0' };
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function createTransport(serverConfig) {
  if (serverConfig.transport === 'stdio') {
    if (!serverConfig.command) {
      throw new Error(`MCP server '${serverConfig.id}' is missing 'command' for stdio transport`);
    }

    return new StdioClientTransport({
      command: serverConfig.command,
      args: Array.isArray(serverConfig.args) ? serverConfig.args : [],
      env: serverConfig.env ? { ...process.env, ...serverConfig.env } : undefined,
      stderr: 'pipe',
    });
  }

  if (!serverConfig.url) {
    throw new Error(`MCP server '${serverConfig.id}' is missing 'url' for ${serverConfig.transport} transport`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(serverConfig.url);
  } catch {
    throw new Error(`MCP server '${serverConfig.id}' has invalid URL: ${serverConfig.url}`);
  }

  if (serverConfig.transport === 'http') {
    return new StreamableHTTPClientTransport(parsedUrl);
  }

  if (serverConfig.transport === 'sse') {
    return new SSEClientTransport(parsedUrl);
  }

  throw new Error(`Unsupported MCP transport '${serverConfig.transport}'`);
}

function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  return schema;
}

function normalizeToolResult(result) {
  return {
    content: result.content ?? [],
    structuredContent: result.structuredContent ?? null,
    isError: Boolean(result.isError),
    raw: result,
  };
}

export async function connect(serverConfig, options = {}) {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const transport = createTransport(serverConfig);
  const client = new Client(MCP_CLIENT_INFO, { capabilities: {} });

  transport.onerror = (error) => {
    console.error(`[MCP:${serverConfig.id}] transport error`, error);
  };

  await withTimeout(client.connect(transport), connectTimeoutMs, `connect(${serverConfig.id})`);

  return {
    serverConfig,
    client,
    transport,
    connectedAt: new Date().toISOString(),
  };
}

export async function list_tools(connection, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;

  const response = await withTimeout(
    connection.client.listTools(),
    timeoutMs,
    `list_tools(${connection.serverConfig.id})`,
  );

  const tools = Array.isArray(response.tools) ? response.tools : [];

  return tools.map((tool) => ({
    server_id: connection.serverConfig.id,
    server_name: connection.serverConfig.name,
    tool_name: tool.name,
    description: tool.description ?? '',
    input_schema: normalizeInputSchema(tool.inputSchema),
    output_hint: tool.outputSchema ? 'Tool has an output schema' : undefined,
  }));
}

export async function call_tool(connection, toolName, argsJson, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;

  const result = await withTimeout(
    connection.client.callTool({
      name: toolName,
      arguments: argsJson && typeof argsJson === 'object' ? argsJson : {},
    }),
    timeoutMs,
    `call_tool(${connection.serverConfig.id}/${toolName})`,
  );

  return normalizeToolResult(result);
}

export async function disconnect(connection) {
  if (!connection) return;
  try {
    await connection.transport.close();
  } catch (err) {
    console.warn(`[MCP:${connection.serverConfig?.id ?? 'unknown'}] disconnect warning`, err);
  }
}

export async function withMcpConnection(serverConfig, fn, options = {}) {
  const connection = await connect(serverConfig, options);
  try {
    return await fn(connection);
  } finally {
    await disconnect(connection);
  }
}
