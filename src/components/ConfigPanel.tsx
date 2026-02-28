import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from '../types/config';

interface ConfigPanelProps {
  config: AppConfig | null;
  availableModels: string[];
  onConfigChange: (patch: Partial<AppConfig>) => Promise<AppConfig | void>;
  onRefreshModels: () => void;
}

export function ConfigPanel({
  config,
  availableModels,
  onConfigChange,
  onRefreshModels,
}: ConfigPanelProps) {
  const [modelBaseUrl, setModelBaseUrl] = useState(config?.modelBaseUrl ?? 'http://127.0.0.1:1234');
  const [defaultModel, setDefaultModel] = useState(config?.defaultModel ?? '');
  const [temperature, setTemperature] = useState(config?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 4096);
  const [activeProfile, setActiveProfile] = useState(config?.activeProfile ?? 'default');
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setModelBaseUrl(config.modelBaseUrl);
      setDefaultModel(config.defaultModel ?? '');
      setTemperature(config.temperature);
      setMaxTokens(config.maxTokens);
      setActiveProfile(config.activeProfile);
    }
  }, [config]);

  const save = useCallback(
    async (patch: Partial<AppConfig>) => {
      setIsSaving(true);
      setStatus(null);
      try {
        await onConfigChange(patch);
        setStatus('Saved');
        setTimeout(() => setStatus(null), 2000);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setIsSaving(false);
      }
    },
    [onConfigChange]
  );

  const handleProfileChange = (profileId: string) => {
    const profile = config?.profiles?.[profileId];
    if (profile) {
      setActiveProfile(profileId);
      setTemperature(profile.temperature);
      setMaxTokens(profile.maxTokens);
      save({
        activeProfile: profileId,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
      });
    }
  };

  const handleSaveAll = () => {
    save({
      modelBaseUrl,
      defaultModel: defaultModel || null,
      temperature,
      maxTokens,
      activeProfile,
    });
  };

  const profileOptions = config?.profiles
    ? Object.entries(config.profiles).map(([id, p]) => ({ id, ...p }))
    : [];

  return (
    <section className="config-panel">
      <h3 className="config-section-title">Config</h3>

      <div className="config-field">
        <label>Model base URL</label>
        <input
          type="url"
          value={modelBaseUrl}
          onChange={(e) => setModelBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:1234"
        />
        <span className="config-hint">LM Studio, Ollama, llama.cpp, OpenRouter, etc.</span>
      </div>

      <div className="config-field">
        <label>Default model</label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">Auto (first available)</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" onClick={onRefreshModels} title="Refresh models">
            ↻
          </button>
        </div>
      </div>

      <div className="config-field">
        <label>Profile</label>
        <select value={activeProfile} onChange={(e) => handleProfileChange(e.target.value)}>
          {profileOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="config-field">
        <label>Temperature</label>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </div>

      <div className="config-field">
        <label>Max tokens</label>
        <input
          type="number"
          min={1}
          max={128000}
          step={256}
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
        />
      </div>

      <div className="config-actions">
        <button onClick={handleSaveAll} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        {status && <span className="config-status">{status}</span>}
      </div>
    </section>
  );
}
