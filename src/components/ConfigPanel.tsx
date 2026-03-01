import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_OPENROUTER_APP_TITLE,
  DEFAULT_OPENROUTER_HTTP_REFERER,
} from '../providers/openrouter';
import type {
  OpenRouterConnectionStatus,
  OpenRouterSettings,
  ProviderDebugInfo,
  ProviderId,
  ProviderModel,
} from '../providers/types';
import type { AppConfig } from '../types/config';
import { ModelPicker } from './ModelPicker';

interface ConfigPanelProps {
  config: AppConfig | null;
  availableModels: ProviderModel[];
  onConfigChange: (patch: Partial<AppConfig>) => Promise<AppConfig | void>;
  onRefreshModels: (forceRefresh?: boolean) => void;
  onTestOpenRouterConnection: (settings: OpenRouterSettings) => Promise<OpenRouterConnectionStatus>;
  lastProviderDebug: ProviderDebugInfo | null;
  onRequireOpenRouterKey: () => void;
  openRouterKeyPrompt?: string | null;
}

const DEFAULT_PROVIDER: ProviderId = 'local';

export function ConfigPanel({
  config,
  availableModels,
  onConfigChange,
  onRefreshModels,
  onTestOpenRouterConnection,
  lastProviderDebug,
  onRequireOpenRouterKey,
  openRouterKeyPrompt = null,
}: ConfigPanelProps) {
  const [modelBaseUrl, setModelBaseUrl] = useState(config?.modelBaseUrl ?? 'http://127.0.0.1:1234/v1');
  const [provider, setProvider] = useState<ProviderId>(config?.provider ?? DEFAULT_PROVIDER);
  const [defaultModel, setDefaultModel] = useState('');

  const [temperature, setTemperature] = useState(config?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 4096);
  const [activeProfile, setActiveProfile] = useState(config?.activeProfile ?? 'default');

  const [openRouterApiKey, setOpenRouterApiKey] = useState(config?.openrouter?.apiKey ?? '');
  const [openRouterReferer, setOpenRouterReferer] = useState(
    config?.openrouter?.httpReferer ?? DEFAULT_OPENROUTER_HTTP_REFERER
  );
  const [openRouterTitle, setOpenRouterTitle] = useState(
    config?.openrouter?.appTitle ?? DEFAULT_OPENROUTER_APP_TITLE
  );

  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  useEffect(() => {
    if (!config) return;

    setModelBaseUrl(config.modelBaseUrl);
    setProvider(config.provider ?? DEFAULT_PROVIDER);
    setTemperature(config.temperature);
    setMaxTokens(config.maxTokens);
    setActiveProfile(config.activeProfile);

    setOpenRouterApiKey(config.openrouter?.apiKey ?? '');
    setOpenRouterReferer(config.openrouter?.httpReferer ?? DEFAULT_OPENROUTER_HTTP_REFERER);
    setOpenRouterTitle(config.openrouter?.appTitle ?? DEFAULT_OPENROUTER_APP_TITLE);
  }, [config]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const savedSelection = config.providerModelSelections?.[provider] ?? null;
    const fallback = provider === config.provider ? config.defaultModel : null;
    setDefaultModel(savedSelection ?? fallback ?? '');
  }, [config, provider]);


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
      void save({
        activeProfile: profileId,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
      });
    }
  };

  const handleSaveAll = () => {
    if (provider === 'openrouter' && openRouterApiKey.trim().length === 0) {
      setStatus('OpenRouter API key is required before selecting OpenRouter provider.');
      onRequireOpenRouterKey();
      return;
    }

    const currentSelections = {
      local: config?.providerModelSelections?.local ?? null,
      openrouter: config?.providerModelSelections?.openrouter ?? null,
    };

    currentSelections[provider] = defaultModel || null;

    void save({
      modelBaseUrl,
      provider,
      defaultModel: defaultModel || null,
      providerModelSelections: currentSelections,
      openrouter: {
        apiKey: openRouterApiKey.trim(),
        httpReferer: openRouterReferer.trim() || DEFAULT_OPENROUTER_HTTP_REFERER,
        appTitle: openRouterTitle.trim() || DEFAULT_OPENROUTER_APP_TITLE,
      },
      temperature,
      maxTokens,
      activeProfile,
    });
  };

  const handleProviderChange = (nextProvider: ProviderId) => {
    if (nextProvider === 'openrouter' && openRouterApiKey.trim().length === 0) {
      setStatus('OpenRouter API key is required before selecting OpenRouter provider.');
      onRequireOpenRouterKey();
      return;
    }
    setProvider(nextProvider);
  };

  const handleTestConnection = async () => {
    if (openRouterApiKey.trim().length === 0) {
      setConnectionStatus('Enter an OpenRouter API key first.');
      onRequireOpenRouterKey();
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus(null);

    try {
      const result = await onTestOpenRouterConnection({
        apiKey: openRouterApiKey.trim(),
        httpReferer: openRouterReferer.trim() || DEFAULT_OPENROUTER_HTTP_REFERER,
        appTitle: openRouterTitle.trim() || DEFAULT_OPENROUTER_APP_TITLE,
      });

      setConnectionStatus(result.message);
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : 'OpenRouter connection failed');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const profileOptions = config?.profiles
    ? Object.entries(config.profiles).map(([id, p]) => ({ id, ...p }))
    : [];

  return (
    <section className="config-panel">
      <h3 className="config-section-title">Config</h3>

      <div className="config-field">
        <label>Provider</label>
        <select value={provider} onChange={(e) => handleProviderChange(e.target.value as ProviderId)}>
          <option value="local">Local OpenAI-compatible</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>

      <div className="config-field">
        <label>Model base URL (local provider)</label>
        <input
          type="url"
          value={modelBaseUrl}
          onChange={(e) => setModelBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:1234/v1"
        />
        <span className="config-hint">LM Studio, Ollama, llama.cpp, and other OpenAI-compatible servers.</span>
      </div>

      <div className="config-field">
        <label>Default model ({availableModels.length} available)</label>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <ModelPicker
            value={defaultModel}
            availableModels={availableModels}
            onModelChange={(id) => setDefaultModel(id)}
          />
          <button
            type="button"
            className="refresh-models-btn"
            onClick={() => onRefreshModels(true)}
            title="Refresh models"
            style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ↻
          </button>
        </div>
      </div>

      <h4 className="config-subsection-title">OpenRouter</h4>
      <div className="config-field">
        <label>API key</label>
        <input
          type="password"
          value={openRouterApiKey}
          onChange={(e) => setOpenRouterApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-..."
        />
        {openRouterKeyPrompt && <span className="config-hint config-warning">{openRouterKeyPrompt}</span>}
      </div>

      <div className="config-field">
        <label>HTTP-Referer</label>
        <input
          type="text"
          value={openRouterReferer}
          onChange={(e) => setOpenRouterReferer(e.target.value)}
          placeholder={DEFAULT_OPENROUTER_HTTP_REFERER}
        />
      </div>

      <div className="config-field">
        <label>X-OpenRouter-Title</label>
        <input
          type="text"
          value={openRouterTitle}
          onChange={(e) => setOpenRouterTitle(e.target.value)}
          placeholder={DEFAULT_OPENROUTER_APP_TITLE}
        />
      </div>

      <div className="config-actions">
        <button
          type="button"
          onClick={() => void handleTestConnection()}
          disabled={isTestingConnection || openRouterApiKey.trim().length === 0}
        >
          {isTestingConnection ? 'Testing…' : 'Test OpenRouter'}
        </button>
      </div>
      {connectionStatus && <div className="config-status">{connectionStatus}</div>}

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

      <h4 className="config-subsection-title">Provider Debug</h4>
      {lastProviderDebug ? (
        <div className="provider-debug-panel">
          <div>
            <span className="provider-debug-label">Provider:</span> {lastProviderDebug.provider}
          </div>
          <div>
            <span className="provider-debug-label">Operation:</span> {lastProviderDebug.operation}
          </div>
          <div>
            <span className="provider-debug-label">Model:</span> {lastProviderDebug.model ?? '--'}
          </div>
          <div>
            <span className="provider-debug-label">Status:</span> {lastProviderDebug.status ?? '--'}
          </div>
          <div>
            <span className="provider-debug-label">Request ID:</span>{' '}
            {lastProviderDebug.requestId ?? '--'}
          </div>
          <div>
            <span className="provider-debug-label">Endpoint:</span> {lastProviderDebug.endpoint}
          </div>
          <pre className="provider-debug-headers">{JSON.stringify(lastProviderDebug.headers, null, 2)}</pre>
        </div>
      ) : (
        <span className="config-hint">No provider requests recorded yet.</span>
      )}
    </section>
  );
}
