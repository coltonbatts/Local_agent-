import type { Message, Metrics, ToolCall, ToolDefinition, ToolExecutionEvent } from '../types/chat';

/** Empty fallback when /api/tools/definitions fails. Backend is the single source of truth. */
const EMPTY_TOOL_DEFINITIONS: ToolDefinition[] = [];

interface GenerationCallbacks {
  appendEmptyAssistant: () => void;
  updateLastAssistant: (content: string, toolCalls?: ToolCall[]) => void;
  appendMessage: (message: Message) => void;
  appendAssistantWarning: (content: string) => void;
  updateMetrics: (updater: (prev: Metrics) => Metrics) => void;
}

interface RunToolConversationParams {
  initialConversation: Message[];
  modelName: string;
  tools?: ToolDefinition[];
  toolApiKey?: string;
  callbacks: GenerationCallbacks;
  maxRounds?: number;
  maxToolCallsPerMessage?: number;
  temperature?: number;
  maxTokens?: number;
  toolsEnabled?: boolean;
}

interface ToolExecutionApiResponse {
  event: ToolExecutionEvent;
  result: unknown;
}

function createClientSideToolErrorEvent(
  toolName: string,
  args: Record<string, unknown>,
  errorMessage: string
): ToolExecutionEvent {
  const nowIso = new Date().toISOString();
  return {
    id: `client_error_${Date.now()}`,
    sequence: -1,
    source: toolName.startsWith('mcp.') ? 'mcp' : 'native',
    tool_name: toolName,
    mcp_tool_name: null,
    server_id: null,
    server_name: null,
    replay_of: null,
    args,
    started_at: nowIso,
    ended_at: nowIso,
    duration_ms: 0,
    status: 'error',
    error_message: errorMessage,
    result: { error: errorMessage },
  };
}

async function streamAssistantResponse(
  messagesToSend: Message[],
  modelName: string,
  tools: ToolDefinition[],
  trackMetrics: boolean,
  callbacks: GenerationCallbacks,
  temperature: number,
  maxTokens: number
) {
  callbacks.appendEmptyAssistant();

  const body: Record<string, unknown> = {
    model: modelName,
    messages: messagesToSend,
    stream: true,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errStr = `HTTP error! status: ${response.status}`;
    try {
      const errData = await response.json();
      errStr += ` - ${errData.error?.message || errData.error || errData.detail || 'Unknown server error'}`;
    } catch (err) {
      console.debug('Could not parse error response as JSON', err);
    }
    throw new Error(errStr);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder('utf-8');
  if (!reader) throw new Error('No reader available');

  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let assistantContent = '';
  const toolCalls: ToolCall[] = [];
  let streamBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (trackMetrics && firstTokenTime === null) {
      firstTokenTime = performance.now();
      const currentFirstTokenTime = firstTokenTime;
      callbacks.updateMetrics((prev) => ({ ...prev, ttft: currentFirstTokenTime - startTime }));
    }

    const chunk = decoder.decode(value, { stream: true });
    streamBuffer += chunk;
    const lines = streamBuffer.split('\n');
    streamBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmedLine.slice(6));
          if (data.error) {
            throw new Error(data.error.message || data.error || 'Unknown stream error');
          }
          const delta = data.choices?.[0]?.delta;

          if (delta?.content) {
            assistantContent += delta.content;
            if (trackMetrics) tokenCount++;
          }

          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index ?? 0;
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCallDelta.id || `call_${Date.now()}_${index}`,
                  type: 'function',
                  function: { name: toolCallDelta.function?.name || '', arguments: '' },
                };
              }
              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }

          if (delta?.content || delta?.tool_calls) {
            callbacks.updateLastAssistant(
              assistantContent,
              toolCalls.length > 0 ? toolCalls : undefined
            );

            if (trackMetrics && firstTokenTime !== null) {
              const currentTime = performance.now();
              const genTimeSeconds = (currentTime - firstTokenTime) / 1000;
              if (genTimeSeconds > 0) {
                callbacks.updateMetrics((prev) => ({
                  ...prev,
                  totalTokens: tokenCount,
                  tokensPerSec: tokenCount / genTimeSeconds,
                }));
              }
            }
          }
        } catch (err) {
          console.warn('Could not parse stream line', line, err);
        }
      }
    }
  }

  if (trackMetrics) {
    const endTime = performance.now();
    const totalLatency = endTime - startTime;
    const actualFirstTokenTime = firstTokenTime ?? startTime;
    const finalGenTimeSeconds = (endTime - actualFirstTokenTime) / 1000;
    callbacks.updateMetrics((prev) => ({
      ...prev,
      totalLatency,
      tokensPerSec: finalGenTimeSeconds > 0 ? tokenCount / finalGenTimeSeconds : 0,
    }));
  }

  return { assistantContent, toolCalls };
}

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  toolHeaders: HeadersInit
): Promise<ToolExecutionApiResponse> {
  const res = await fetch('/api/tools/execute', {
    method: 'POST',
    headers: toolHeaders,
    body: JSON.stringify({ toolName, args }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.hint ?? data.error ?? 'Tool execution failed';
    throw new Error(msg);
  }

  return data;
}

export async function runToolConversation({
  initialConversation,
  modelName,
  tools,
  toolApiKey,
  callbacks,
  maxRounds = 3,
  maxToolCallsPerMessage = 10,
  temperature = 0.7,
  maxTokens = 4096,
  toolsEnabled = true,
}: RunToolConversationParams) {
  const toolHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(toolApiKey ? { 'x-tool-api-key': toolApiKey } : {}),
  };

  const toolsToUse = toolsEnabled && tools && tools.length > 0 ? tools : EMPTY_TOOL_DEFINITIONS;

  let conversation: Message[] = initialConversation;
  let rounds = 0;

  while (true) {
    const { assistantContent, toolCalls } = await streamAssistantResponse(
      conversation,
      modelName,
      toolsToUse,
      rounds === 0,
      callbacks,
      temperature,
      maxTokens
    );

    conversation = [
      ...conversation,
      {
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    ];

    if (!toolCalls || toolCalls.length === 0) break;

    rounds += 1;
    if (rounds > maxRounds) {
      callbacks.appendAssistantWarning(
        `⚠️ Tool loop stopped after ${maxRounds} rounds to prevent runaway execution.`
      );
      break;
    }

    const toolsByName = new Map((tools ?? []).map((t) => [t.function.name, t.function]));
    let toolCallsToRun = toolCalls;
    if (toolCalls.length > maxToolCallsPerMessage) {
      toolCallsToRun = toolCalls.slice(0, maxToolCallsPerMessage);
      callbacks.appendAssistantWarning(
        `⚠️ Capped at ${maxToolCallsPerMessage} tool calls per message (model requested ${toolCalls.length}).`
      );
    }

    for (const tc of toolCallsToRun) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const fnDef = toolsByName.get(tc.function.name);
      if (fnDef?.requires_confirmation) {
        const toolMessage: Message = {
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify({
            error: 'Tool requires user confirmation. Skipped.',
            code: 'REQUIRES_CONFIRMATION',
          }),
          tool_event: createClientSideToolErrorEvent(
            tc.function.name,
            args,
            'Tool requires user confirmation. Skipped.'
          ),
        };
        conversation = [...conversation, toolMessage];
        callbacks.appendMessage(toolMessage);
        continue;
      }

      let execution: ToolExecutionApiResponse;
      try {
        execution = await executeToolCall(tc.function.name, args, toolHeaders);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown tool execution error';
        execution = {
          event: createClientSideToolErrorEvent(tc.function.name, args, errorMessage),
          result: { error: errorMessage },
        };
      }

      const toolMessage: Message = {
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(execution.result),
        tool_event: execution.event,
      };

      conversation = [...conversation, toolMessage];
      callbacks.appendMessage(toolMessage);
    }
  }
}
