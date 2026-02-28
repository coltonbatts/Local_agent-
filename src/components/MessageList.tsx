import type { RefObject } from 'react';
import { parseContentWithThoughts } from '../utils/parseContentWithThoughts';
import { renderMarkdown } from '../utils/renderMarkdown';
import { ToolResultDisplay } from './ToolResultDisplay';
import type { Message, ToolCall, ToolExecutionEvent } from '../types/chat';

interface MessageListProps {
  messages: Message[];
  isGenerating: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onReplayToolCall?: (eventId: string) => void;
  replayingEventId?: string | null;
}

function truncateName(value?: string) {
  if (!value) return value;
  return value.length > 40 ? `${value.substring(0, 40)}...` : value;
}

function formatDuration(durationMs: number | null | undefined) {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '--';
  return `${durationMs}ms`;
}

function toPrettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function getToolSummary(msg: Message, event?: ToolExecutionEvent) {
  if (event?.source === 'mcp') {
    const serverLabel = event.server_name || event.server_id || 'unknown-server';
    const toolLabel = event.mcp_tool_name || msg.name || event.tool_name;
    return `MCP: ${serverLabel} / ${toolLabel}`;
  }

  return `Tool: ${msg.name || event?.tool_name || 'unknown'}`;
}

export function MessageList({
  messages,
  isGenerating,
  messagesEndRef,
  onReplayToolCall,
  replayingEventId,
}: MessageListProps) {
  return (
    <div className="messages-list">
      {messages.length === 0 && (
        <div className="message assistant">
          <div className="message-content">
            Hello! I am connected to your local model. How can I help you today?
          </div>
        </div>
      )}

      {messages.map((msg, idx) => {
        const isLastAssistantMessage =
          isGenerating && idx === messages.length - 1 && msg.role === 'assistant';

        return (
          <div
            key={idx}
            className={`message ${msg.role} ${isLastAssistantMessage ? 'generating' : ''}`}
          >
            {msg.role === 'tool' ? (
              (() => {
                const event = msg.tool_event;
                const parsedContent = parseJsonContent(msg.content);
                const argsForDisplay = event?.args ?? {};
                const resultForDisplay = event?.result ?? parsedContent;

                return (
                  <ToolResultDisplay
                    icon="🛠"
                    summary={
                      <>
                        <span className="tool-name" title={event?.tool_name || msg.name}>
                          {truncateName(getToolSummary(msg, event))}
                        </span>
                        {event && (
                          <span className="tool-meta-inline">
                            #{event.sequence > 0 ? event.sequence : 'local'} · {event.status} ·{' '}
                            {formatDuration(event.duration_ms)}
                          </span>
                        )}
                      </>
                    }
                    content={
                      <div className="tool-event-body">
                        {event && (
                          <div className="tool-event-meta">
                            <div>Started: {new Date(event.started_at).toLocaleString()}</div>
                            <div>
                              Ended:{' '}
                              {event.ended_at ? new Date(event.ended_at).toLocaleString() : '--'}
                            </div>
                            <div>Status: {event.status}</div>
                            {event.error_message && <div>Error: {event.error_message}</div>}
                            {event.replay_of && <div>Replay of: {event.replay_of}</div>}
                          </div>
                        )}

                        {event?.id && onReplayToolCall && (
                          <div className="tool-event-actions">
                            <button
                              onClick={(eventClick) => {
                                eventClick.preventDefault();
                                eventClick.stopPropagation();
                                onReplayToolCall(event.id);
                              }}
                              disabled={replayingEventId === event.id || isGenerating}
                            >
                              {replayingEventId === event.id ? '[REPLAYING]' : '[REPLAY TOOL CALL]'}
                            </button>
                          </div>
                        )}

                        <div className="tool-event-section">
                          <div className="tool-event-label">Args</div>
                          <pre className="tool-result-content">{toPrettyJson(argsForDisplay)}</pre>
                        </div>

                        <div className="tool-event-section">
                          <div className="tool-event-label">Result</div>
                          <pre className="tool-result-content">
                            {toPrettyJson(resultForDisplay)}
                          </pre>
                        </div>
                      </div>
                    }
                    contentClassName="tool-result-content-wrapper"
                  />
                );
              })()
            ) : (
              <div className="message-content">
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className="tool-calls-container">
                    {msg.tool_calls.map((tc: ToolCall, i: number) => (
                      <div key={i} className="tool-call-pill">
                        <span className="tool-icon">⚙️</span>
                        Executing{' '}
                        <span className="tool-name" title={tc.function?.name}>
                          {truncateName(tc.function?.name)}
                        </span>
                        ...
                      </div>
                    ))}
                  </div>
                )}

                {msg.content &&
                  (msg.role === 'assistant' ? (
                    <div className="parsed-content">
                      {parseContentWithThoughts(msg.content).map((part, partIndex) =>
                        part.type === 'think' ? (
                          <ToolResultDisplay
                            key={partIndex}
                            icon="🧠"
                            summary="Model Thought Process"
                            content={renderMarkdown(part.content)}
                            className="thought-process"
                            contentClassName="tool-result-content"
                          />
                        ) : (
                          part.content.trim() !== '' && (
                            <div key={partIndex} className="assistant-bubble">
                              {renderMarkdown(part.content)}
                            </div>
                          )
                        )
                      )}
                    </div>
                  ) : (
                    <div className="message-bubble user-bubble">{msg.content}</div>
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {isGenerating && (
        <div className="message assistant">
          <div
            className="message-content"
            style={{ display: 'flex', alignItems: 'center', height: '100%' }}
          >
            {messages[messages.length - 1]?.content === '' && (
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
  );
}
