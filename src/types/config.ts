export interface ProfileConfig {
  label: string;
  temperature: number;
  maxTokens: number;
  toolsEnabled: boolean;
}

export interface AppConfig {
  modelBaseUrl: string;
  defaultModel: string | null;
  temperature: number;
  maxTokens: number;
  activeProfile: string;
  profiles: Record<string, ProfileConfig>;
}
