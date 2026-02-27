export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
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
}
