import {
  ProviderRequestError,
  extractErrorMessage,
  extractRequestId,
  readProviderError,
  redactAuthorizationHeader,
  toIsoTimestamp,
} from './types';
import type {
  OpenRouterConnectionStatus,
  OpenRouterSettings,
  ProviderChatCompletionInitResult,
  ProviderChatRequest,
  ProviderModel,
  ProviderModelApi,
  ProviderModelsResult,
  ProviderRuntimeOptions,
} from './types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODELS_ENDPOINT = `${OPENROUTER_BASE_URL}/models`;
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = `${OPENROUTER_BASE_URL}/chat/completions`;
const OPENROUTER_AUTH_KEY_ENDPOINT = `${OPENROUTER_BASE_URL}/auth/key`;
const OPENROUTER_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_MODELS_CACHE_KEY = 'openrouter_models_cache_v1';

export const DEFAULT_OPENROUTER_APP_TITLE = 'Local Chat UI';
export const DEFAULT_OPENROUTER_HTTP_REFERER = 'http://localhost';

interface OpenRouterModelRecord {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  input_modalities?: string[];
  architecture?: {
    input_modalities?: string[];
  };
}

interface OpenRouterModelsCacheRecord {
  fetchedAt: number;
  models: ProviderModel[];
}

let inMemoryModelsCache: OpenRouterModelsCacheRecord | null = null;

function normalizeOpenRouterSettings(settings?: OpenRouterSettings): OpenRouterSettings {
  return {
    apiKey: settings?.apiKey?.trim() ?? '',
    httpReferer: settings?.httpReferer?.trim() || DEFAULT_OPENROUTER_HTTP_REFERER,
    appTitle: settings?.appTitle?.trim() || DEFAULT_OPENROUTER_APP_TITLE,
  };
}

function toRedactedHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    Authorization: redactAuthorizationHeader(headers.Authorization),
  };
}

function ensureApiKey(settings: OpenRouterSettings, endpoint: string) {
  if (!settings.apiKey) {
    throw new ProviderRequestError('OpenRouter API key is required.', {
      provider: 'openrouter',
      code: 'OPENROUTER_API_KEY_MISSING',
      endpoint,
    });
  }
}

function buildOpenRouterHeaders(
  settings: OpenRouterSettings,
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.apiKey}`,
    'HTTP-Referer': settings.httpReferer,
    'X-OpenRouter-Title': settings.appTitle,
  };

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function isCacheFresh(cache: OpenRouterModelsCacheRecord, now: number): boolean {
  return now - cache.fetchedAt <= OPENROUTER_MODELS_CACHE_TTL_MS;
}

function readLocalStorageCache(now: number): OpenRouterModelsCacheRecord | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(OPENROUTER_MODELS_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as OpenRouterModelsCacheRecord;
    if (!Array.isArray(parsed.models) || typeof parsed.fetchedAt !== 'number') {
      return null;
    }

    if (!isCacheFresh(parsed, now)) {
      window.localStorage.removeItem(OPENROUTER_MODELS_CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeLocalStorageCache(cache: OpenRouterModelsCacheRecord) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(OPENROUTER_MODELS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache persistence is best-effort only.
  }
}

function extractModalities(model: OpenRouterModelRecord): string[] {
  const root = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  const architecture = Array.isArray(model.architecture?.input_modalities)
    ? model.architecture.input_modalities
    : [];

  return [...root, ...architecture].map((value) => String(value).toLowerCase());
}

function toOpenRouterModels(payload: unknown): ProviderModel[] {
  const records =
    payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)
      ? ((payload as { data: OpenRouterModelRecord[] }).data ?? [])
      : [];

  const models: ProviderModel[] = [];

  for (const record of records) {
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) continue;

    const modalities = extractModalities(record);
    const visionCapable = modalities.some((value) => value.includes('image'));

    models.push({
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : id,
      description: typeof record.description === 'string' ? record.description : null,
      contextLength:
        typeof record.context_length === 'number' && Number.isFinite(record.context_length)
          ? record.context_length
          : null,
      visionCapable,
      provider: 'openrouter',
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function getProviderSpecificMessage(status: number, baseMessage: string): string {
  if (status === 401 || status === 403) {
    return `OpenRouter authentication failed: ${baseMessage}`;
  }
  if (status === 404) {
    return `OpenRouter resource not found: ${baseMessage}`;
  }
  if (status === 429) {
    return `OpenRouter rate limit reached: ${baseMessage}`;
  }

  return baseMessage;
}

async function ensureOkOrThrow(response: Response, endpoint: string, model?: string) {
  if (response.ok) {
    return;
  }

  const errorBody = await readProviderError(response);
  const baseMessage = extractErrorMessage(errorBody);
  const message = getProviderSpecificMessage(response.status, baseMessage);

  throw new ProviderRequestError(message, {
    provider: 'openrouter',
    status: response.status,
    requestId: extractRequestId(response.headers),
    endpoint,
    code: model ? 'OPENROUTER_CHAT_FAILED' : 'OPENROUTER_REQUEST_FAILED',
    details: errorBody,
  });
}

function parseRateLimitInfo(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const rateLimit = (payload as { data?: { rate_limit?: Record<string, unknown> } }).data
    ?.rate_limit;

  if (!rateLimit || typeof rateLimit !== 'object') return null;

  const requests =
    typeof rateLimit.requests === 'number'
      ? rateLimit.requests
      : typeof rateLimit.limit === 'number'
        ? rateLimit.limit
        : null;

  const interval =
    typeof rateLimit.interval === 'string'
      ? rateLimit.interval
      : typeof rateLimit.window === 'string'
        ? rateLimit.window
        : null;

  if (requests !== null && interval) {
    return `${requests} req/${interval}`;
  }
  if (requests !== null) {
    return `${requests} requests/window`;
  }
  if (interval) {
    return interval;
  }

  return null;
}

function parseCreditsInfo(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = (payload as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== 'object') return null;

  const limitCandidate = data.limit;
  const usageCandidate = data.usage;

  if (typeof limitCandidate === 'number' && typeof usageCandidate === 'number') {
    const remaining = Math.max(limitCandidate - usageCandidate, 0);
    return `${remaining.toFixed(2)} remaining (${usageCandidate.toFixed(2)} used)`;
  }

  return null;
}

export function createOpenRouterProvider(): ProviderModelApi & {
  testConnection: (settings: OpenRouterSettings) => Promise<OpenRouterConnectionStatus>;
} {
  return {
    id: 'openrouter',

    async listModels(options?: ProviderRuntimeOptions): Promise<ProviderModelsResult> {
      const now = Date.now();
      const settings = normalizeOpenRouterSettings(options?.openRouterSettings);
      ensureApiKey(settings, OPENROUTER_MODELS_ENDPOINT);

      if (!options?.forceRefresh) {
        if (inMemoryModelsCache && isCacheFresh(inMemoryModelsCache, now)) {
          return {
            models: inMemoryModelsCache.models,
            fromCache: true,
            debug: {
              provider: 'openrouter',
              operation: 'models',
              endpoint: OPENROUTER_MODELS_ENDPOINT,
              status: 200,
              requestId: null,
              headers: toRedactedHeaders(buildOpenRouterHeaders(settings)),
              fromCache: true,
              timestamp: toIsoTimestamp(now),
            },
          };
        }

        const localStorageCache = readLocalStorageCache(now);
        if (localStorageCache) {
          inMemoryModelsCache = localStorageCache;
          return {
            models: localStorageCache.models,
            fromCache: true,
            debug: {
              provider: 'openrouter',
              operation: 'models',
              endpoint: OPENROUTER_MODELS_ENDPOINT,
              status: 200,
              requestId: null,
              headers: toRedactedHeaders(buildOpenRouterHeaders(settings)),
              fromCache: true,
              timestamp: toIsoTimestamp(now),
            },
          };
        }
      }

      const headers = buildOpenRouterHeaders(settings);
      const response = await fetch(OPENROUTER_MODELS_ENDPOINT, {
        method: 'GET',
        headers,
      });

      await ensureOkOrThrow(response, OPENROUTER_MODELS_ENDPOINT);
      const payload = (await response.json()) as unknown;
      const models = toOpenRouterModels(payload);

      const cacheRecord: OpenRouterModelsCacheRecord = {
        fetchedAt: now,
        models,
      };
      inMemoryModelsCache = cacheRecord;
      writeLocalStorageCache(cacheRecord);

      return {
        models,
        fromCache: false,
        debug: {
          provider: 'openrouter',
          operation: 'models',
          endpoint: OPENROUTER_MODELS_ENDPOINT,
          status: response.status,
          requestId: extractRequestId(response.headers),
          headers: toRedactedHeaders(headers),
          fromCache: false,
          timestamp: toIsoTimestamp(now),
        },
      };
    },

    async createChatCompletion(
      request: ProviderChatRequest,
      options?: ProviderRuntimeOptions
    ): Promise<ProviderChatCompletionInitResult> {
      const settings = normalizeOpenRouterSettings(options?.openRouterSettings);
      ensureApiKey(settings, OPENROUTER_CHAT_COMPLETIONS_ENDPOINT);

      const headers = buildOpenRouterHeaders(settings, true);
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        stream: request.stream,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };

      if (request.tools.length > 0) {
        body.tools = request.tools;
      }

      const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      await ensureOkOrThrow(response, OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, request.model);

      return {
        response,
        debug: {
          provider: 'openrouter',
          operation: 'chat',
          endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
          model: request.model,
          status: response.status,
          requestId: extractRequestId(response.headers),
          headers: toRedactedHeaders(headers),
          timestamp: toIsoTimestamp(),
        },
      };
    },

    async testConnection(settings: OpenRouterSettings): Promise<OpenRouterConnectionStatus> {
      const normalized = normalizeOpenRouterSettings(settings);
      ensureApiKey(normalized, OPENROUTER_AUTH_KEY_ENDPOINT);

      const headers = buildOpenRouterHeaders(normalized);
      const keyRes = await fetch(OPENROUTER_AUTH_KEY_ENDPOINT, {
        method: 'GET',
        headers,
      });

      await ensureOkOrThrow(keyRes, OPENROUTER_AUTH_KEY_ENDPOINT);
      const keyPayload = (await keyRes.json()) as unknown;

      const modelsResult = await this.listModels({
        openRouterSettings: normalized,
        forceRefresh: true,
      });

      const rateLimit = parseRateLimitInfo(keyPayload);
      const credits = parseCreditsInfo(keyPayload);

      const summaryParts = [`Connected to OpenRouter`, `${modelsResult.models.length} models loaded`];
      if (rateLimit) {
        summaryParts.push(`rate limit: ${rateLimit}`);
      }
      if (credits) {
        summaryParts.push(`credits: ${credits}`);
      }

      return {
        ok: true,
        message: summaryParts.join(' · '),
        modelCount: modelsResult.models.length,
        rateLimit,
        credits,
        requestId: extractRequestId(keyRes.headers),
        debug: {
          provider: 'openrouter',
          operation: 'test',
          endpoint: OPENROUTER_AUTH_KEY_ENDPOINT,
          status: keyRes.status,
          requestId: extractRequestId(keyRes.headers),
          headers: toRedactedHeaders(headers),
          timestamp: toIsoTimestamp(),
        },
      };
    },
  };
}
