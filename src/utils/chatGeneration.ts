import type { Message, Metrics, ToolCall } from '../types/chat';

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file on the local file system.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The absolute or relative path to the file to read.',
          },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brave_search',
      description:
        'Search the web using the Brave Search API. Use this to find current information, news, or answer questions requiring internet access.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load the instructions (SKILL.md) for a specific agent skill.',
      parameters: {
        type: 'object',
        properties: {
          skillName: {
            type: 'string',
            description: "The name of the skill to load (e.g., 'vercel-react-best-practices').",
          },
        },
        required: ['skillName'],
      },
    },
  },
] as const;

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
  toolApiKey?: string;
  callbacks: GenerationCallbacks;
  maxRounds?: number;
}

async function streamAssistantResponse(
  messagesToSend: Message[],
  modelName: string,
  trackMetrics: boolean,
  callbacks: GenerationCallbacks,
) {
  callbacks.appendEmptyAssistant();

  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: messagesToSend,
      tools: TOOL_DEFINITIONS,
      stream: true,
      temperature: 0.7,
    }),
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
            callbacks.updateLastAssistant(assistantContent, toolCalls.length > 0 ? toolCalls : undefined);

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

export async function runToolConversation({
  initialConversation,
  modelName,
  toolApiKey,
  callbacks,
  maxRounds = 3,
}: RunToolConversationParams) {
  const toolHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(toolApiKey ? { 'x-tool-api-key': toolApiKey } : {}),
  };

  let conversation: Message[] = initialConversation;
  let rounds = 0;

  while (true) {
    const { assistantContent, toolCalls } = await streamAssistantResponse(conversation, modelName, rounds === 0, callbacks);
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
      callbacks.appendAssistantWarning('⚠️ Tool loop stopped after 3 rounds to prevent runaway execution.');
      break;
    }

    for (const tc of toolCalls) {
      let args;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      let responseContent = '';
      try {
        const res = await fetch(`/api/tools/${tc.function.name}`, {
          method: 'POST',
          headers: toolHeaders,
          body: JSON.stringify(args),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Tool execution failed');
        responseContent = JSON.stringify(data);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown tool execution error';
        responseContent = JSON.stringify({ error: errorMessage });
      }

      const toolMessage: Message = {
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: responseContent,
      };
      conversation = [...conversation, toolMessage];
      callbacks.appendMessage(toolMessage);
    }
  }
}
