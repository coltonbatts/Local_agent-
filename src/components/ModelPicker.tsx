import { useState, useMemo, useEffect, useRef } from 'react';
import type { ProviderModel } from '../providers/types';

interface ModelPickerProps {
    value: string;
    availableModels: ProviderModel[];
    onModelChange: (modelId: string) => void;
    disabled?: boolean;
    placeholder?: string;
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
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Focus search input when opening
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const filteredModels = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = query
            ? availableModels.filter(
                (m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
            )
            : availableModels;

        // Group by provider
        const groups: Record<string, ProviderModel[]> = {};
        filtered.forEach((model) => {
            const provider = model.provider === 'openrouter' ? 'OpenRouter' : 'Local';
            if (!groups[provider]) groups[provider] = [];
            groups[provider].push(model);
        });

        return groups;
    }, [availableModels, search]);

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
                                placeholder="Search models..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

                        <div className="model-picker-list">
                            {Object.keys(filteredModels).length === 0 ? (
                                <div className="model-picker-empty">No models found</div>
                            ) : (
                                <>
                                    {Object.entries(filteredModels).map(([groupName, models]) => (
                                        <div key={groupName}>
                                            <div className="model-picker-group-title">{groupName}</div>
                                            {models.map((model) => (
                                                <button
                                                    key={model.id}
                                                    className={`model-picker-item ${model.id === value ? 'active' : ''}`}
                                                    onClick={() => handleSelect(model.id)}
                                                >
                                                    <div className="model-item-id">{model.id}</div>
                                                    <div className="model-item-meta">
                                                        {model.name && <span>{model.name}</span>}
                                                        {model.visionCapable && <span className="vision-badge">Vision capable</span>}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
