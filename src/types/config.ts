export interface ProfileConfig {
  label: string;
  temperature: number;
  maxTokens: number;
  toolsEnabled: boolean;
}

export type ModelProvider = 'local' | 'openrouter';

export interface ProviderModelSelections {
  local: string | null;
  openrouter: string | null;
}

export interface OpenRouterConfig {
  apiKey: string;
  httpReferer: string;
  appTitle: string;
}

export interface AppConfig {
  modelBaseUrl: string;
  defaultModel: string | null;
  provider: ModelProvider;
  providerModelSelections: ProviderModelSelections;
  openrouter: OpenRouterConfig;
  temperature: number;
  maxTokens: number;
  activeProfile: string;
  chatAutosave?: boolean;
  profiles: Record<string, ProfileConfig>;
}
