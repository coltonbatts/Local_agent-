import { ModelPicker } from './ModelPicker';
import type { ProviderModel } from '../providers/types';

interface ChatHeaderProps {
  modelName: string;
  availableModels: ProviderModel[];
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

      <div className="model-picker-header-wrapper">
        <ModelPicker
          value={modelName}
          availableModels={availableModels}
          onModelChange={onModelChange}
          disabled={isGenerating}
        />
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
