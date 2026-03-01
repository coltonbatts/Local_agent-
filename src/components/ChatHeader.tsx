import { ModelPicker } from './ModelPicker';
import type { ProviderId, ProviderModel } from '../providers/types';

interface ChatHeaderProps {
  selectedProvider: ProviderId;
  modelName: string;
  availableModels: ProviderModel[];
  onModelChange: (model: string) => void;
  onProviderChange: (provider: ProviderId) => void;
  onRefreshModels: (forceRefresh?: boolean) => void;
  isModelsLoading: boolean;
  modelStatusText: string;
  modelStatusError: string | null;
  isGenerating: boolean;
  hasMessages: boolean;
  onSaveChat: () => void;
  onClearChat: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}

export function ChatHeader({
  selectedProvider,
  modelName,
  availableModels,
  onModelChange,
  onProviderChange,
  onRefreshModels,
  isModelsLoading,
  modelStatusText,
  modelStatusError,
  isGenerating,
  hasMessages,
  onSaveChat,
  onClearChat,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: ChatHeaderProps) {
  const disableProviderSwitch = isGenerating;

  return (
    <header className="chat-header">
      <button className="sidebar-toggle-mobile" onClick={onToggleLeftSidebar}>
        ☰
      </button>

      <div className="chat-header-main-controls">
        <div className="provider-picker-row">
          <span className="provider-picker-label">Provider</span>
          <div className="provider-picker-buttons" role="group" aria-label="Provider selector">
            <button
              type="button"
              className={`provider-pill ${selectedProvider === 'local' ? 'active' : ''}`}
              onClick={() => onProviderChange('local')}
              disabled={disableProviderSwitch}
            >
              Local
            </button>
            <button
              type="button"
              className={`provider-pill ${selectedProvider === 'openrouter' ? 'active' : ''}`}
              onClick={() => onProviderChange('openrouter')}
              disabled={disableProviderSwitch}
            >
              OpenRouter
            </button>
          </div>

          <div className="model-picker-header-wrapper">
            <ModelPicker
              value={modelName}
              availableModels={availableModels}
              onModelChange={onModelChange}
              disabled={isGenerating}
              placeholder="Select model"
            />
          </div>

          {selectedProvider === 'openrouter' && (
            <button
              type="button"
              className="refresh-models-btn"
              onClick={() => onRefreshModels(true)}
              disabled={isGenerating || isModelsLoading}
              title="Refresh OpenRouter models"
              aria-label="Refresh OpenRouter models"
            >
              ↻
            </button>
          )}
        </div>

        <div className={`provider-model-status ${modelStatusError ? 'error' : ''}`}>
          {modelStatusError ?? modelStatusText}
        </div>
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
