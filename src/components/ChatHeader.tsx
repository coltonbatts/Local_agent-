interface ChatHeaderProps {
  modelName: string;
  availableModels: string[];
  onModelChange: (model: string) => void;
  isGenerating: boolean;
  hasMessages: boolean;
  onSaveChat: () => void;
  onClearChat: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}

export function ChatHeader({
  modelName,
  availableModels,
  onModelChange,
  isGenerating,
  hasMessages,
  onSaveChat,
  onClearChat,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <button className="sidebar-toggle-mobile" onClick={onToggleLeftSidebar}>
        ☰
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <select
          style={{
            background: 'transparent',
            color: 'inherit',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-ui)',
            padding: '4px',
            outline: 'none',
          }}
          value={modelName}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={isGenerating}
        >
          {availableModels.length === 0 ? (
            <option value={modelName}>{modelName}</option>
          ) : (
            availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="chat-header-actions">
        <button onClick={onSaveChat} disabled={!hasMessages || isGenerating}>
          [SAVE]
        </button>
        <button onClick={onClearChat} disabled={!hasMessages || isGenerating}>
          [CLEAR]
        </button>
        <button className="sidebar-toggle-mobile" onClick={onToggleRightSidebar}>
          ⚙
        </button>
      </div>
    </header>
  );
}
