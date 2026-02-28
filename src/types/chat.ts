export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolExecutionEvent {
  id: string;
  sequence: number;
  source: 'native' | 'mcp';
  tool_name: string;
  mcp_tool_name?: string | null;
  server_id?: string | null;
  server_name?: string | null;
  replay_of?: string | null;
  args: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'success' | 'error';
  error_message: string | null;
  result: unknown;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  tool_event?: ToolExecutionEvent;
}

export interface Metrics {
  ttft: number | null;
  tokensPerSec: number | null;
  totalTokens: number;
  totalLatency: number | null;
}

export interface Skill {
  name: string;
  description: string;
  folderName: string;
}

export interface ChatMetadata {
  filename: string;
  title: string;
  timestamp: string;
  pinned?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** When true, tool execution is skipped until user confirms. Prevents runaway risky ops. */
    requires_confirmation?: boolean;
  };
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  capabilities_warning?: string;
}

export interface McpToolDescriptor {
  server_id: string;
  server_name: string;
  tool_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_hint?: string;
}

export interface McpToolsGroup {
  server_id: string;
  server_name: string;
  tools: McpToolDescriptor[];
}
