import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderModel } from '../providers/types';

interface ModelPickerProps {
  value: string;
  availableModels: ProviderModel[];
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

type ModelSort = 'alpha' | 'context';

function formatContextLength(contextLength?: number | null): string | null {
  if (typeof contextLength !== 'number' || !Number.isFinite(contextLength) || contextLength <= 0) {
    return null;
  }

  if (contextLength >= 1000) {
    return `${Math.round(contextLength / 1000)}k ctx`;
  }

  return `${contextLength} ctx`;
}

export function ModelPicker({
  value,
  availableModels,
  onModelChange,
  disabled = false,
  placeholder = 'Select a model...',
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visionOnly, setVisionOnly] = useState(false);
  const [toolCallingOnly, setToolCallingOnly] = useState(false);
  const [sortBy, setSortBy] = useState<ModelSort>('alpha');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const hasVisionMetadata = useMemo(
    () => availableModels.some((model) => typeof model.visionCapable === 'boolean'),
    [availableModels]
  );

  const hasToolCallingMetadata = useMemo(
    () => availableModels.some((model) => typeof model.toolCallingCapable === 'boolean'),
    [availableModels]
  );

  const hasContextLengthMetadata = useMemo(
    () => availableModels.some((model) => typeof model.contextLength === 'number'),
    [availableModels]
  );

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    const results: ProviderModel[] = [];

    for (const model of availableModels) {
      if (
        query.length > 0 &&
        !model.id.toLowerCase().includes(query) &&
        !model.name.toLowerCase().includes(query)
      ) {
        continue;
      }

      if (visionOnly && model.visionCapable !== true) {
        continue;
      }

      if (toolCallingOnly && model.toolCallingCapable !== true) {
        continue;
      }

      results.push(model);
    }

    const sorted = [...results];
    if (sortBy === 'context') {
      sorted.sort((a, b) => {
        const aContext = typeof a.contextLength === 'number' ? a.contextLength : -1;
        const bContext = typeof b.contextLength === 'number' ? b.contextLength : -1;
        if (aContext !== bContext) {
          return bContext - aContext;
        }
        return a.id.localeCompare(b.id);
      });
      return sorted;
    }

    sorted.sort((a, b) => a.id.localeCompare(b.id));
    return sorted;
  }, [availableModels, search, sortBy, toolCallingOnly, visionOnly]);

  const handleSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="model-picker-container">
      <button
        type="button"
        className="model-picker-trigger"
        onClick={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        title={value || placeholder}
      >
        <span className="model-picker-label">{value || placeholder}</span>
        <span className="model-picker-chevron">▼</span>
      </button>

      {isOpen && (
        <div className="model-picker-overlay" onClick={() => setIsOpen(false)}>
          <div className="model-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="model-picker-header">
              <input
                ref={searchInputRef}
                type="text"
                className="model-picker-search"
                placeholder="Search by model id or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="model-picker-toolbar">
                {hasVisionMetadata && (
                  <label className="model-picker-filter-toggle">
                    <input
                      type="checkbox"
                      checked={visionOnly}
                      onChange={(e) => setVisionOnly(e.target.checked)}
                    />
                    Vision capable
                  </label>
                )}

                {hasToolCallingMetadata && (
                  <label className="model-picker-filter-toggle">
                    <input
                      type="checkbox"
                      checked={toolCallingOnly}
                      onChange={(e) => setToolCallingOnly(e.target.checked)}
                    />
                    Tool calling
                  </label>
                )}

                <label className="model-picker-sort-control">
                  Sort
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as ModelSort)}
                  >
                    <option value="alpha">Alphabetical</option>
                    {hasContextLengthMetadata && <option value="context">Context length</option>}
                  </select>
                </label>
              </div>
            </div>

            <div className="model-picker-list">
              {filteredModels.length === 0 ? (
                <div className="model-picker-empty">No models found</div>
              ) : (
                filteredModels.map((model) => (
                  <button
                    key={model.id}
                    className={`model-picker-item ${model.id === value ? 'active' : ''}`}
                    onClick={() => handleSelect(model.id)}
                  >
                    <div className="model-item-id">{model.id}</div>
                    <div className="model-item-meta">
                      {model.name && model.name !== model.id && <span>{model.name}</span>}
                      {model.visionCapable === true && <span className="vision-badge">Vision</span>}
                      {model.toolCallingCapable === true && (
                        <span className="tool-badge">Tools</span>
                      )}
                      {formatContextLength(model.contextLength) && (
                        <span>{formatContextLength(model.contextLength)}</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
