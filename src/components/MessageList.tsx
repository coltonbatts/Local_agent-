import type { RefObject } from 'react';
import { parseContentWithThoughts } from '../utils/parseContentWithThoughts';
import { renderMarkdown } from '../utils/renderMarkdown';
import { ToolResultDisplay } from './ToolResultDisplay';
import type { Message, ToolCall } from '../types/chat';

interface MessageListProps {
  messages: Message[];
  isGenerating: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

function truncateName(value?: string) {
  if (!value) return value;
  return value.length > 40 ? `${value.substring(0, 40)}...` : value;
}

export function MessageList({ messages, isGenerating, messagesEndRef }: MessageListProps) {
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
        const isLastAssistantMessage = isGenerating && idx === messages.length - 1 && msg.role === 'assistant';

        return (
          <div key={idx} className={`message ${msg.role} ${isLastAssistantMessage ? 'generating' : ''}`}>
            {msg.role === 'tool' ? (
              <ToolResultDisplay
                icon="🛠"
                summary={(
                  <>
                    Processed result from{' '}
                    <span className="tool-name" title={msg.name}>
                      {truncateName(msg.name)}
                    </span>
                  </>
                )}
                content={msg.content}
                contentClassName="tool-result-content"
                renderAsPre
              />
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

                {msg.content && (
                  msg.role === 'assistant' ? (
                    <div className="parsed-content">
                      {parseContentWithThoughts(msg.content).map((part, partIndex) => (
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
                      ))}
                    </div>
                  ) : (
                    <div className="message-bubble user-bubble">{msg.content}</div>
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
