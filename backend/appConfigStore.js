import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG = {
  modelBaseUrl: 'http://127.0.0.1:1234',
  defaultModel: null,
  temperature: 0.7,
  maxTokens: 4096,
  activeProfile: 'default',
  profiles: {
    default: { label: 'Default', temperature: 0.7, maxTokens: 4096, toolsEnabled: true },
    fast: { label: 'Fast', temperature: 0.3, maxTokens: 1024, toolsEnabled: true },
    accurate: { label: 'Accurate', temperature: 0.1, maxTokens: 8192, toolsEnabled: true },
    vision: { label: 'Vision', temperature: 0.5, maxTokens: 4096, toolsEnabled: true },
    'no-tools': { label: 'No tools', temperature: 0.7, maxTokens: 4096, toolsEnabled: false },
  },
};

function ensureConfigFile(configPath) {
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function loadConfig(configPath) {
  ensureConfigFile(configPath);
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeWithDefaults(parsed) {
  const merged = { ...DEFAULT_CONFIG, ...parsed };
  if (parsed?.profiles && typeof parsed.profiles === 'object') {
    merged.profiles = { ...DEFAULT_CONFIG.profiles, ...parsed.profiles };
  }
  return merged;
}

function saveConfig(configPath, config) {
  ensureConfigFile(configPath);
  const toWrite = {
    modelBaseUrl: config.modelBaseUrl ?? DEFAULT_CONFIG.modelBaseUrl,
    defaultModel: config.defaultModel ?? DEFAULT_CONFIG.defaultModel,
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    activeProfile: config.activeProfile ?? DEFAULT_CONFIG.activeProfile,
    profiles: config.profiles ?? DEFAULT_CONFIG.profiles,
  };
  fs.writeFileSync(configPath, JSON.stringify(toWrite, null, 2));
}

export function createAppConfigStore(projectRoot) {
  const configPath = path.join(projectRoot, 'config', 'app-config.json');
  let cached = loadConfig(configPath);

  return {
    getConfig() {
      try {
        cached = loadConfig(configPath);
      } catch {
        // use cached
      }
      return { ...cached };
    },

    updateConfig(patch) {
      const current = loadConfig(configPath);
      const updated = { ...current, ...patch };
      saveConfig(configPath, updated);
      cached = updated;
      return { ...cached };
    },

    getActiveProfile() {
      const cfg = this.getConfig();
      const profile = cfg.profiles?.[cfg.activeProfile] ?? cfg.profiles?.default;
      return profile ?? {
        temperature: cfg.temperature ?? 0.7,
        maxTokens: cfg.maxTokens ?? 4096,
        toolsEnabled: true,
      };
    },

    getModelBaseUrl() {
      return this.getConfig().modelBaseUrl ?? DEFAULT_CONFIG.modelBaseUrl;
    },
  };
}
