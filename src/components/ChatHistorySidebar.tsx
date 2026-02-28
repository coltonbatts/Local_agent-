import type { ChatMetadata } from '../types/chat';

interface ChatHistorySidebarProps {
  chats: ChatMetadata[];
  currentChatFilename: string | null;
  isOpen?: boolean;
  onClose?: () => void;
  onCreateNewChat: () => void;
  onLoadChat: (filename: string) => void;
}

export function ChatHistorySidebar({
  chats,
  currentChatFilename,
  isOpen,
  onClose,
  onCreateNewChat,
  onLoadChat,
}: ChatHistorySidebarProps) {
  return (
    <>
      {isOpen && <div className="mobile-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <header className="sidebar-header">
          <h2 className="sidebar-title">History</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="new-chat-button" onClick={onCreateNewChat}>
              + New
            </button>
            {onClose && (
              <button className="sidebar-toggle-mobile" onClick={onClose} aria-label="Close Sidebar">
                ✕
              </button>
            )}
          </div>
        </header>

        <div className="chat-list">
          {chats.length === 0 && <div className="empty-history">No saved chats yet</div>}
          {chats.map((chat) => (
            <div
              key={chat.filename}
              className={`chat-item ${currentChatFilename === chat.filename ? 'active' : ''}`}
              onClick={() => {
                onLoadChat(chat.filename);
                if (onClose) onClose();
              }}
            >
              <div className="chat-item-title">{chat.title}</div>
              <div className="chat-item-date">
                {(() => {
                  let date = new Date(chat.timestamp);
                  if (isNaN(date.getTime()) && typeof chat.timestamp === 'string') {
                    const fixed = chat.timestamp.replace(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, '$1T$2:$3:$4.$5Z');
                    date = new Date(fixed);
                  }
                  return isNaN(date.getTime()) ? 'Unknown Date' : date.toLocaleDateString();
                })()}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
