import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import './App.css'; // kept for consistency, empty now since we use index.css

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

interface Metrics {
  ttft: number | null; // Time to first token in ms
  tokensPerSec: number | null; // Generation speed
  totalTokens: number;
  totalLatency: number | null; // Total request time in ms
}

interface Skill {
  name: string;
  description: string;
  folderName: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({
    ttft: null,
    tokensPerSec: null,
    totalTokens: 0,
    totalLatency: null
  });

  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [modelName, setModelName] = useState('Local Model');
  const TOOL_API_KEY = import.meta.env.VITE_TOOL_API_KEY as string | undefined;

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.skills) setAvailableSkills(data.skills);
    } catch (e) {
      console.error("Failed to load skills", e);
    }
  };

  const fetchModel = async () => {
    try {
      const res = await fetch('/v1/models');
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        // Just grab the first model ID
        setModelName(data.data[0].id);
      }
    } catch (e) {
      console.error("Failed to load model name", e);
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchModel();
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];

    // Inject system prompt with skills if needed and it's the first message
    let requestMessages = [...newMessages];

    // We only need to inject the system message if we have skills.
    if (availableSkills.length > 0) {
      // Create system prompt describing available skills
      const skillsDesc = availableSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      const systemMsg: Message = {
        role: 'system',
        content: `You are a helpful AI assistant. You have access to the following skills (instructions) which you can read using the 'load_skill' tool:\n\n${skillsDesc}\n\nWhen a user asks you to do a task that matches one of these skills, ALWAYS use the 'load_skill' tool to read its instructions before completing the task. Follow the instructions precisely.`
      };

      // If the first message is not already a system message, unshift it. 
      // In a real robust system, we might replace an existing system prompt or append to it.
      if (requestMessages[0]?.role !== 'system') {
        requestMessages.unshift(systemMsg);
      } else {
        // Just replace for simplicity in this demo
        requestMessages[0] = systemMsg;
      }
    }

    setMessages(newMessages); // Don't show system prompt in UI
    setInput('');
    setIsGenerating(true);

    // Reset metrics for new generation
    setMetrics({
      ttft: null,
      tokensPerSec: null,
      totalTokens: 0,
      totalLatency: null
    });

    // Define available tools
    const tools = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file on the local file system.",
          parameters: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description: "The absolute or relative path to the file to read."
              }
            },
            required: ["filePath"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "brave_search",
          description: "Search the web using the Brave Search API. Use this to find current information, news, or answer questions requiring internet access.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query."
              }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "load_skill",
          description: "Load the instructions (SKILL.md) for a specific agent skill.",
          parameters: {
            type: "object",
            properties: {
              skillName: {
                type: "string",
                description: "The name of the skill to load (e.g., 'vercel-react-best-practices')."
              }
            },
            required: ["skillName"]
          }
        }
      }
    ];

    try {
      const toolHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        ...(TOOL_API_KEY ? { 'x-tool-api-key': TOOL_API_KEY } : {})
      };

      const streamAssistantResponse = async (messagesToSend: Message[], trackMetrics: boolean) => {
        // Add an empty assistant message to stream into
        setMessages(prev => [...prev, { role: 'assistant', content: '', tool_calls: [] }]);

        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'local-model', // LM Studio typically ignores this if only one model is loaded, but it's required by OpenAI spec
            messages: messagesToSend,
            tools: tools,
            stream: true,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          let errStr = `HTTP error! status: ${response.status}`;
          try {
            const errData = await response.json();
            errStr += ` - ${errData.error?.message || errData.error || errData.detail || 'Unknown server error'}`;
          } catch (e) {
            console.debug('Could not parse error response as JSON', e);
          }
          throw new Error(errStr);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder('utf-8');
        if (!reader) throw new Error("No reader available");

        const startTime = performance.now();
        let firstTokenTime: number | null = null;
        let tokenCount = 0;
        let assistantContent = '';
        let toolCalls: any[] = [];
        let streamBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (trackMetrics && firstTokenTime === null) {
            firstTokenTime = performance.now();
            setMetrics(prev => ({ ...prev, ttft: firstTokenTime - startTime }));
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
                  throw new Error(data.error.message || data.error || "Unknown stream error");
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
                        function: { name: toolCallDelta.function?.name || '', arguments: '' }
                      };
                    }
                    if (toolCallDelta.function?.arguments) {
                      toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                    }
                  }
                }

                if (delta?.content || delta?.tool_calls) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastMsg = updated[updated.length - 1];
                    updated[updated.length - 1] = {
                      ...lastMsg,
                      content: assistantContent,
                      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    };
                    return updated;
                  });

                  if (trackMetrics && firstTokenTime !== null) {
                    const currentTime = performance.now();
                    const genTimeSeconds = (currentTime - firstTokenTime) / 1000;
                    if (genTimeSeconds > 0) {
                      setMetrics(prev => ({
                        ...prev,
                        totalTokens: tokenCount,
                        tokensPerSec: tokenCount / genTimeSeconds
                      }));
                    }
                  }
                }
              } catch (e) {
                console.warn("Could not parse stream line", line, e);
              }
            }
          }
        }

        if (trackMetrics) {
          const endTime = performance.now();
          const totalLatency = endTime - startTime;
          const finalGenTimeSeconds = (endTime - (firstTokenTime || startTime)) / 1000;
          setMetrics(prev => ({
            ...prev,
            totalLatency,
            tokensPerSec: finalGenTimeSeconds > 0 ? tokenCount / finalGenTimeSeconds : 0
          }));
        }

        return { assistantContent, toolCalls };
      };

      let conversation: Message[] = requestMessages;
      let rounds = 0;
      const maxRounds = 3;

      while (true) {
        const { assistantContent, toolCalls } = await streamAssistantResponse(conversation, rounds === 0);
        conversation = [
          ...conversation,
          {
            role: 'assistant' as const,
            content: assistantContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          }
        ];

        if (!toolCalls || toolCalls.length === 0) break;
        rounds += 1;
        if (rounds > maxRounds) {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: '⚠️ Tool loop stopped after 3 rounds to prevent runaway execution.' }
          ]);
          break;
        }

        for (const tc of toolCalls) {
          let args;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

          let responseContent = "";
          try {
            const res = await fetch(`/api/tools/${tc.function.name}`, {
              method: 'POST',
              headers: toolHeaders,
              body: JSON.stringify(args)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Tool execution failed');
            responseContent = JSON.stringify(data);
          } catch (err: any) {
            responseContent = JSON.stringify({ error: err.message });
          }

          const toolMessage: Message = {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: tc.function.name,
            content: responseContent
          };
          conversation = [...conversation, toolMessage];
          setMessages(prev => [...prev, toolMessage]);
        }
      }
    } catch (error) {
      console.error("Error connecting to local model:", error);
      setMessages(prev => [
        ...prev.slice(0, -1), // remove the empty assistant message
        { role: 'assistant', content: '⚠️ Error connecting to local model. Is the server running at http://localhost:1234/v1?' }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  // Format Helper for Metrics
  const formatValue = (val: number | null, decimals = 2) => {
    if (val === null) return '--';
    return val.toFixed(decimals);
  };

  // Helper to parse <think> blocks natively
  const parseContentWithThoughts = (content: string) => {
    const parts = [];
    const regex = /<think>([\s\S]*?)(?:<\/think>|$)/g;

    let lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
      }
      parts.push({ type: 'think', content: match[1] });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.substring(lastIndex) });
    }
    return parts.length > 0 ? parts : [{ type: 'text', content }];
  };

  // Helper for rendering Markdown blocks with Syntax Highlighting
  const renderMarkdown = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? (
            <div className="code-block-wrapper">
              <div className="code-block-header">
                <span className="code-language">{match[1]}</span>
              </div>
              <SyntaxHighlighter
                {...props}
                children={String(children).replace(/\n$/, '')}
                style={vscDarkPlus as any}
                language={match[1]}
                PreTag="div"
                customStyle={{ margin: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
              />
            </div>
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          );
        }
      }}
    >
      {text}
    </ReactMarkdown>
  );

  return (
    <div className="app-container">
      {/* CENTER PANE - CHAT AREA */}
      <main className="glass-panel chat-area">
        <header className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
            <div className="model-indicator-pulse"></div>
            <h1 className="chat-title">Chatting with <span className="highlight-model">{modelName}</span></h1>
          </div>
        </header>

        <div className="messages-list">
          {messages.length === 0 && (
            <div className="message assistant">
              <div className="message-content">
                Hello! I am connected to your local model. How can I help you today?
              </div>
            </div>
          )}
          {messages.map((msg, idx) => {
            const isLastAssistantMessage = isGenerating && idx === messages.length - 1 && msg.role === 'assistant';

            return (
              <div key={idx} className={`message ${msg.role} ${isLastAssistantMessage ? 'generating' : ''}`}>
                {msg.role === 'tool' ? (
                  <details className="tool-result-details">
                    <summary className="tool-result-summary">
                      <span className="tool-icon">🛠</span>
                      Processed result from <span className="tool-name" title={msg.name}>
                        {msg.name && msg.name.length > 40 ? msg.name.substring(0, 40) + '...' : msg.name}
                      </span>
                    </summary>
                    <pre className="tool-result-content">{msg.content}</pre>
                  </details>
                ) : (
                  <div className="message-content">
                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="tool-calls-container">
                        {msg.tool_calls.map((tc: any, i: number) => (
                          <div key={i} className="tool-call-pill">
                            <span className="tool-icon">⚙️</span>
                            Executing <span className="tool-name" title={tc.function?.name}>
                              {tc.function?.name && tc.function.name.length > 40 ? tc.function.name.substring(0, 40) + '...' : tc.function?.name}
                            </span>...
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      msg.role === 'assistant' ? (
                        <div className="parsed-content">
                          {parseContentWithThoughts(msg.content).map((part, pIdx) => (
                            part.type === 'think' ? (
                              <details key={pIdx} className="tool-result-details thought-process">
                                <summary className="tool-result-summary">
                                  <span className="tool-icon">🧠</span>
                                  Model Thought Process
                                </summary>
                                <div className="tool-result-content">
                                  {renderMarkdown(part.content)}
                                </div>
                              </details>
                            ) : (
                              part.content.trim() !== '' && (
                                <div key={pIdx} className="assistant-bubble">
                                  {renderMarkdown(part.content)}
                                </div>
                              )
                            )
                          ))}
                        </div>
                      ) : (
                        <div className="message-bubble user-bubble">
                          {msg.content}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {isGenerating && (
            <div className="message assistant">
              <div className="message-content" style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                {messages[messages.length - 1].content === '' && (
                  <div className="assistant-bubble" style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="typing-indicator">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={handleSubmit}>
          <div className="input-container">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message local model..."
              disabled={isGenerating}
              rows={1}
            />
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isGenerating}
            >
              <svg className="send-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </form>
      </main>

      {/* RIGHT PANE - METRICS SIDEBAR */}
      <aside className="glass-panel metrics-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">
            <div className={`status-dot ${isGenerating ? 'generating' : ''}`}></div>
            System Telemetry
          </h2>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">TTFT (Time To First Token)</div>
            <div className="metric-value">
              {formatValue(metrics.ttft, 0)}
              <span className="metric-unit">ms</span>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Generation Speed</div>
            <div className="metric-value">
              {formatValue(metrics.tokensPerSec)}
              <span className="metric-unit">tok/s</span>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Total Latency</div>
            <div className="metric-value">
              {formatValue(metrics.totalLatency, 0)}
              <span className="metric-unit">ms</span>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Tokens Rendered</div>
            <div className="metric-value">
              {metrics.totalTokens}
            </div>
          </div>
        </div>

        <div className="connection-info">
          <div className="endpoint-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            localhost:1234
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;
