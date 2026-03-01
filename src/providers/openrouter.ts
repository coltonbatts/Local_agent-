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
const OPENROUTER_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_MODELS_CACHE_KEY = 'openrouter_models_cache_v1';
const OPENROUTER_FETCH_TIMEOUT_MS = 15_000;

export const DEFAULT_OPENROUTER_APP_TITLE = 'Local Chat UI';
export const DEFAULT_OPENROUTER_HTTP_REFERER = 'http://localhost';

interface OpenRouterModelRecord {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  input_modalities?: string[];
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    supported_parameters?: string[];
  };
}

interface OpenRouterModelsCacheRecord {
  fetchedAt: number;
  etag?: string | null;
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
    throw new ProviderRequestError('Missing OpenRouter API key. Add it in Settings.', {
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

function isValidCacheRecord(record: unknown): record is OpenRouterModelsCacheRecord {
  if (!record || typeof record !== 'object') return false;

  const typed = record as {
    fetchedAt?: unknown;
    models?: unknown;
    etag?: unknown;
  };

  return (
    typeof typed.fetchedAt === 'number' &&
    Array.isArray(typed.models) &&
    (typeof typed.etag === 'undefined' || typed.etag === null || typeof typed.etag === 'string')
  );
}

function readLocalStorageCache(): OpenRouterModelsCacheRecord | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(OPENROUTER_MODELS_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCacheRecord(parsed)) {
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

function getMergedCacheRecord(): OpenRouterModelsCacheRecord | null {
  const storageCache = readLocalStorageCache();

  if (!inMemoryModelsCache) {
    return storageCache;
  }

  if (!storageCache) {
    return inMemoryModelsCache;
  }

  return inMemoryModelsCache.fetchedAt >= storageCache.fetchedAt ? inMemoryModelsCache : storageCache;
}

function setCacheRecord(cache: OpenRouterModelsCacheRecord) {
  inMemoryModelsCache = cache;
  writeLocalStorageCache(cache);
}

function extractModalities(model: OpenRouterModelRecord): string[] {
  const root = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  const architecture = Array.isArray(model.architecture?.input_modalities)
    ? model.architecture.input_modalities
    : [];

  return [...root, ...architecture].map((value) => String(value).toLowerCase());
}

function extractSupportedParameters(model: OpenRouterModelRecord): string[] {
  const root = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  const architecture = Array.isArray(model.architecture?.supported_parameters)
    ? model.architecture.supported_parameters
    : [];

  return [...root, ...architecture].map((value) => String(value).toLowerCase());
}

function toOpenRouterModels(payload: unknown): ProviderModel[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid JSON payload');
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error('Missing model data array');
  }

  const models: ProviderModel[] = [];

  for (const rawRecord of data) {
    const record = rawRecord as OpenRouterModelRecord;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) continue;

    const modalities = extractModalities(record);
    const supportedParameters = extractSupportedParameters(record);

    const visionCapable =
      modalities.length > 0
        ? modalities.some((value) => value.includes('image') || value.includes('vision'))
        : undefined;
    const toolCallingCapable =
      supportedParameters.length > 0
        ? supportedParameters.some(
            (value) => value === 'tools' || value === 'tool_choice' || value.startsWith('tool_')
          )
        : undefined;

    models.push({
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : id,
      description: typeof record.description === 'string' ? record.description : null,
      contextLength:
        typeof record.context_length === 'number' && Number.isFinite(record.context_length)
          ? record.context_length
          : null,
      visionCapable,
      toolCallingCapable,
      provider: 'openrouter',
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function getProviderSpecificMessage(status: number, baseMessage: string): string {
  if (status === 401 || status === 403) {
    return 'OpenRouter API key is invalid or unauthorized (401/403).';
  }
  if (status === 404) {
    return `OpenRouter resource not found: ${baseMessage}`;
  }
  if (status === 429) {
    return `OpenRouter rate limit reached: ${baseMessage}`;
  }

  return baseMessage;
}

async function ensureOkOrThrow(
  response: Response,
  endpoint: string,
  code: string,
  model?: string
) {
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
    code,
    details: {
      ...((errorBody && typeof errorBody === 'object' ? errorBody : { raw: errorBody }) as Record<
        string,
        unknown
      >),
      ...(model ? { model } : {}),
    },
  });
}

async function fetchWithTimeout(
  endpoint: string,
  init: RequestInit,
  timeoutMs = OPENROUTER_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(endpoint, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderRequestError(
        `OpenRouter request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        {
          provider: 'openrouter',
          code: 'OPENROUTER_TIMEOUT',
          endpoint,
        }
      );
    }

    throw new ProviderRequestError(
      'Network / CORS error while reaching OpenRouter. Check your connection and proxy settings.',
      {
        provider: 'openrouter',
        code: 'OPENROUTER_NETWORK_ERROR',
        endpoint,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createOpenRouterProvider(): ProviderModelApi & {
  testConnection: (settings: OpenRouterSettings) => Promise<OpenRouterConnectionStatus>;
} {
  return {
    id: 'openrouter',

    async getModels(options?: ProviderRuntimeOptions): Promise<ProviderModelsResult> {
      const now = Date.now();
      const settings = normalizeOpenRouterSettings(options?.openRouterSettings);
      ensureApiKey(settings, OPENROUTER_MODELS_ENDPOINT);

      const cachedRecord = getMergedCacheRecord();
      if (cachedRecord) {
        inMemoryModelsCache = cachedRecord;
      }

      const headers = buildOpenRouterHeaders(settings);

      if (!options?.forceRefresh && cachedRecord && isCacheFresh(cachedRecord, now)) {
        return {
          models: cachedRecord.models,
          fromCache: true,
          fetchedAt: cachedRecord.fetchedAt,
          debug: {
            provider: 'openrouter',
            operation: 'models',
            endpoint: OPENROUTER_MODELS_ENDPOINT,
            status: 200,
            requestId: null,
            headers: toRedactedHeaders(headers),
            fromCache: true,
            timestamp: toIsoTimestamp(now),
          },
        };
      }

      if (cachedRecord?.etag) {
        headers['If-None-Match'] = cachedRecord.etag;
      }

      const response = await fetchWithTimeout(OPENROUTER_MODELS_ENDPOINT, {
        method: 'GET',
        headers,
      });

      if (response.status === 304 && cachedRecord) {
        const refreshedCache: OpenRouterModelsCacheRecord = {
          ...cachedRecord,
          fetchedAt: now,
        };
        setCacheRecord(refreshedCache);

        return {
          models: refreshedCache.models,
          fromCache: true,
          fetchedAt: refreshedCache.fetchedAt,
          debug: {
            provider: 'openrouter',
            operation: 'models',
            endpoint: OPENROUTER_MODELS_ENDPOINT,
            status: response.status,
            requestId: extractRequestId(response.headers),
            headers: toRedactedHeaders(headers),
            fromCache: true,
            timestamp: toIsoTimestamp(now),
          },
        };
      }

      await ensureOkOrThrow(response, OPENROUTER_MODELS_ENDPOINT, 'OPENROUTER_MODELS_FAILED');

      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        throw new ProviderRequestError('OpenRouter models response could not be parsed.', {
          provider: 'openrouter',
          code: 'OPENROUTER_MODELS_PARSE_ERROR',
          endpoint: OPENROUTER_MODELS_ENDPOINT,
          status: response.status,
          requestId: extractRequestId(response.headers),
        });
      }

      let models: ProviderModel[];
      try {
        models = toOpenRouterModels(payload);
      } catch {
        throw new ProviderRequestError('OpenRouter models response had an unexpected format.', {
          provider: 'openrouter',
          code: 'OPENROUTER_MODELS_PARSE_ERROR',
          endpoint: OPENROUTER_MODELS_ENDPOINT,
          status: response.status,
          requestId: extractRequestId(response.headers),
        });
      }

      const cacheRecord: OpenRouterModelsCacheRecord = {
        fetchedAt: now,
        etag: response.headers.get('etag'),
        models,
      };
      setCacheRecord(cacheRecord);

      return {
        models,
        fromCache: false,
        fetchedAt: cacheRecord.fetchedAt,
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

    async chatCompletion(
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

      let response: Response;
      try {
        response = await fetch(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new ProviderRequestError(
          'Network / CORS error while reaching OpenRouter chat endpoint.',
          {
            provider: 'openrouter',
            code: 'OPENROUTER_NETWORK_ERROR',
            endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
          }
        );
      }

      await ensureOkOrThrow(
        response,
        OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
        'OPENROUTER_CHAT_FAILED',
        request.model
      );

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
      ensureApiKey(normalized, OPENROUTER_MODELS_ENDPOINT);

      const modelsResult = await this.getModels({
        openRouterSettings: normalized,
        forceRefresh: true,
      });

      return {
        ok: true,
        message: `Connected to OpenRouter · ${modelsResult.models.length} models loaded`,
        modelCount: modelsResult.models.length,
        requestId: modelsResult.debug.requestId,
        debug: {
          provider: 'openrouter',
          operation: 'test',
          endpoint: OPENROUTER_MODELS_ENDPOINT,
          status: modelsResult.debug.status,
          requestId: modelsResult.debug.requestId,
          headers: modelsResult.debug.headers,
          timestamp: toIsoTimestamp(),
        },
      };
    },
  };
}
