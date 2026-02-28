import { useState } from 'react';
import type { ChatMetadata } from '../types/chat';
import type { AppConfig } from '../types/config';

interface ChatHistorySidebarProps {
  chats: ChatMetadata[];
  currentChatFilename: string | null;
  isOpen?: boolean;
  onClose?: () => void;
  onCreateNewChat: () => void;
  onLoadChat: (filename: string) => void;
  onRenameChat: (filename: string, newTitle: string) => void;
  onTogglePinChat: (filename: string, pinned: boolean) => void;
  onExportChat: () => void;
  onSaveChat: () => void;
  onSaveChatAsNew: () => void;
  config: AppConfig | null;
  onConfigChange: (patch: Partial<AppConfig>) => Promise<AppConfig | void>;
  hasMessages: boolean;
  isGenerating: boolean;
}

function formatDate(timestamp: string): string {
  let date = new Date(timestamp);
  if (isNaN(date.getTime()) && typeof timestamp === 'string') {
    const fixed = timestamp.replace(
      /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
      '$1T$2:$3:$4.$5Z'
    );
    date = new Date(fixed);
  }
  return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString();
}

export function ChatHistorySidebar({
  chats,
  currentChatFilename,
  isOpen,
  onClose,
  onCreateNewChat,
  onLoadChat,
  onRenameChat,
  onTogglePinChat,
  onExportChat,
  onSaveChat,
  onSaveChatAsNew,
  config,
  onConfigChange,
  hasMessages,
  isGenerating,
}: ChatHistorySidebarProps) {
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const chatAutosave = config?.chatAutosave ?? false;
  const isScratchpad = !currentChatFilename;
  const currentTitle = currentChatFilename
    ? (chats.find((c) => c.filename === currentChatFilename)?.title ?? 'Project')
    : 'Scratchpad';

  const handleRenameStart = (chat: ChatMetadata) => {
    setEditingFilename(chat.filename);
    setEditTitle(chat.title);
  };

  const handleRenameSubmit = () => {
    if (editingFilename && editTitle.trim()) {
      onRenameChat(editingFilename, editTitle.trim());
      setEditingFilename(null);
      setEditTitle('');
    }
  };

  const handleRenameCancel = () => {
    setEditingFilename(null);
    setEditTitle('');
  };

  const toggleAutosave = async () => {
    await onConfigChange({ chatAutosave: !chatAutosave });
  };

  return (
    <>
      {isOpen && <div className="mobile-overlay" onClick={onClose} />}
      <aside className={`sidebar chats-sidebar ${isOpen ? 'open' : ''}`}>
        <header className="sidebar-header">
          <h2 className="sidebar-title">Chats</h2>
          <div className="chats-sidebar-header-actions">
            <button
              className="new-chat-button"
              onClick={onCreateNewChat}
              disabled={isGenerating}
              title="New scratchpad"
            >
              + New
            </button>
            {onClose && (
              <button
                className="sidebar-toggle-mobile"
                onClick={onClose}
                aria-label="Close Sidebar"
              >
                ✕
              </button>
            )}
          </div>
        </header>

        <div className="chats-mode-indicator">
          <span className="chats-mode-label">{isScratchpad ? 'Scratchpad' : 'Project'}</span>
          {!isScratchpad && (
            <span className="chats-mode-title" title={currentTitle}>
              {currentTitle}
            </span>
          )}
        </div>

        <div className="chats-actions">
          <label className="chats-autosave-toggle">
            <input
              type="checkbox"
              checked={chatAutosave}
              onChange={() => void toggleAutosave()}
              disabled={isScratchpad}
            />
            <span>Autosave</span>
          </label>
          <span className="chats-autosave-hint">
            {chatAutosave ? 'Saving to filesystem' : 'Manual save only'}
          </span>
        </div>

        <div className="chats-save-actions">
          <button
            onClick={onSaveChat}
            disabled={!hasMessages || isGenerating}
            title={isScratchpad ? 'Save as new project' : 'Save project'}
          >
            {isScratchpad ? 'Save as project' : 'Save'}
          </button>
          {!isScratchpad && (
            <button
              onClick={onSaveChatAsNew}
              disabled={!hasMessages || isGenerating}
              title="Save a copy as new project"
            >
              Save copy
            </button>
          )}
          <button
            onClick={onExportChat}
            disabled={!hasMessages}
            title="Export conversation + tool events as JSON"
          >
            Export
          </button>
        </div>

        <div className="chat-list">
          {chats.length === 0 && (
            <div className="empty-history">No projects yet. Save to create one.</div>
          )}
          {chats.map((chat) => (
            <div
              key={chat.filename}
              className={`chat-item ${currentChatFilename === chat.filename ? 'active' : ''} ${chat.pinned ? 'pinned' : ''}`}
            >
              {editingFilename === chat.filename ? (
                <div className="chat-item-edit">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit();
                      if (e.key === 'Escape') handleRenameCancel();
                    }}
                    autoFocus
                    className="chat-item-edit-input"
                  />
                  <div className="chat-item-edit-actions">
                    <button type="button" onClick={handleRenameSubmit}>
                      ✓
                    </button>
                    <button type="button" onClick={handleRenameCancel}>
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="chat-item-content"
                    onClick={() => {
                      onLoadChat(chat.filename);
                      if (onClose) onClose();
                    }}
                  >
                    <div className="chat-item-title" title={chat.title}>
                      {chat.title}
                    </div>
                    <div className="chat-item-date">{formatDate(chat.timestamp)}</div>
                  </div>
                  <div className="chat-item-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePinChat(chat.filename, !chat.pinned);
                      }}
                      title={chat.pinned ? 'Unpin' : 'Pin'}
                      className={chat.pinned ? 'pinned' : ''}
                    >
                      {chat.pinned ? '📌' : '○'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameStart(chat);
                      }}
                      title="Rename"
                    >
                      ✎
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
