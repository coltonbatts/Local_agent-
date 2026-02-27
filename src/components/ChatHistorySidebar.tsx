import type { ChatMetadata } from '../types/chat';

interface ChatHistorySidebarProps {
  chats: ChatMetadata[];
  currentChatFilename: string | null;
  onCreateNewChat: () => void;
  onLoadChat: (filename: string) => void;
}

export function ChatHistorySidebar({
  chats,
  currentChatFilename,
  onCreateNewChat,
  onLoadChat,
}: ChatHistorySidebarProps) {
  return (
    <aside className="glass-panel history-sidebar">
      <header className="sidebar-header">
        <h2 className="sidebar-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 3"></path>
            <circle cx="12" cy="12" r="9"></circle>
          </svg>
          Chat History
        </h2>
        <button className="new-chat-button" onClick={onCreateNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Chat
        </button>
      </header>

      <div className="chat-list">
        {chats.length === 0 && <div className="empty-history">No saved chats yet</div>}
        {chats.map((chat) => (
          <div
            key={chat.filename}
            className={`chat-item ${currentChatFilename === chat.filename ? 'active' : ''}`}
            onClick={() => onLoadChat(chat.filename)}
          >
            <div className="chat-item-title">{chat.title}</div>
            <div className="chat-item-date">{new Date(chat.timestamp).toLocaleDateString()}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}
