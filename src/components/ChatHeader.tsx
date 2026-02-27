interface ChatHeaderProps {
  modelName: string;
  isGenerating: boolean;
  hasMessages: boolean;
  onSaveChat: () => void;
  onClearChat: () => void;
}

export function ChatHeader({
  modelName,
  isGenerating,
  hasMessages,
  onSaveChat,
  onClearChat,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
        <div className="model-indicator-pulse"></div>
        <h1 className="chat-title">
          Chatting with <span className="highlight-model">{modelName}</span>
        </h1>
        <button
          className="save-chat-button"
          onClick={onSaveChat}
          disabled={!hasMessages || isGenerating}
          title="Save current chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          Save
        </button>
        <button
          className="clear-chat-button"
          onClick={onClearChat}
          disabled={!hasMessages || isGenerating}
          title="Clear local chat history"
        >
          Clear Chat
        </button>
      </div>
    </header>
  );
}
