import {
  ProviderRequestError,
  extractErrorMessage,
  extractRequestId,
  readProviderError,
  toIsoTimestamp,
} from './types';
import type {
  ProviderChatCompletionInitResult,
  ProviderChatRequest,
  ProviderModel,
  ProviderModelApi,
  ProviderModelsResult,
} from './types';

const LOCAL_MODELS_ENDPOINT = '/v1/models';
const LOCAL_CHAT_COMPLETIONS_ENDPOINT = '/v1/chat/completions';

function toLocalModels(payload: unknown): ProviderModel[] {
  const data =
    payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: Array<{ id?: unknown; name?: unknown }> }).data
      : [];

  const models: ProviderModel[] = [];

  for (const raw of data) {
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) continue;

    models.push({
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
      provider: 'local',
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureOkOrThrow(response: Response, endpoint: string, model?: string) {
  if (response.ok) {
    return;
  }

  const errorBody = await readProviderError(response);
  const errorMessage = extractErrorMessage(errorBody);
  const requestId = extractRequestId(response.headers);
  const fallbackMessage = `Local provider error (HTTP ${response.status})`;

  throw new ProviderRequestError(errorMessage || fallbackMessage, {
    provider: 'local',
    status: response.status,
    requestId,
    endpoint,
    details: errorBody,
    ...(model ? { code: 'MODEL_REQUEST_FAILED' } : {}),
  });
}

export function createLocalOpenAICompatibleProvider(): ProviderModelApi {
  return {
    id: 'local',

    async getModels(): Promise<ProviderModelsResult> {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      const response = await fetch(LOCAL_MODELS_ENDPOINT, { headers });
      const requestId = extractRequestId(response.headers);
      const fetchedAt = Date.now();

      await ensureOkOrThrow(response, LOCAL_MODELS_ENDPOINT);

      const payload = (await response.json()) as unknown;

      return {
        models: toLocalModels(payload),
        fromCache: false,
        fetchedAt,
        debug: {
          provider: 'local',
          operation: 'models',
          endpoint: LOCAL_MODELS_ENDPOINT,
          status: response.status,
          requestId,
          headers,
          timestamp: toIsoTimestamp(fetchedAt),
        },
      };
    },

    async chatCompletion(request: ProviderChatRequest): Promise<ProviderChatCompletionInitResult> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

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

      const response = await fetch(LOCAL_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const requestId = extractRequestId(response.headers);

      await ensureOkOrThrow(response, LOCAL_CHAT_COMPLETIONS_ENDPOINT, request.model);

      return {
        response,
        debug: {
          provider: 'local',
          operation: 'chat',
          endpoint: LOCAL_CHAT_COMPLETIONS_ENDPOINT,
          model: request.model,
          status: response.status,
          requestId,
          headers,
          timestamp: toIsoTimestamp(),
        },
      };
    },
  };
}
