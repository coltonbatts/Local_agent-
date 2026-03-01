import type { Message, ToolDefinition } from '../types/chat';

export type ProviderId = 'local' | 'openrouter';

export interface OpenRouterSettings {
  apiKey: string;
  httpReferer: string;
  appTitle: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  description?: string | null;
  contextLength?: number | null;
  visionCapable?: boolean;
  toolCallingCapable?: boolean;
  provider: ProviderId;
}

export interface ProviderDebugInfo {
  provider: ProviderId;
  operation: 'models' | 'chat' | 'test';
  endpoint: string;
  model?: string;
  status?: number;
  requestId?: string | null;
  headers: Record<string, string>;
  fromCache?: boolean;
  timestamp: string;
}

export interface ProviderModelsResult {
  models: ProviderModel[];
  debug: ProviderDebugInfo;
  fromCache: boolean;
  fetchedAt: number | null;
}

export interface ProviderChatRequest {
  model: string;
  messages: Message[];
  tools: ToolDefinition[];
  stream: boolean;
  temperature: number;
  maxTokens: number;
}

export interface ProviderChatCompletionInitResult {
  response: Response;
  debug: ProviderDebugInfo;
}

export interface OpenRouterConnectionStatus {
  ok: boolean;
  message: string;
  modelCount: number;
  rateLimit?: string | null;
  credits?: string | null;
  requestId?: string | null;
  debug?: ProviderDebugInfo;
}

export interface ProviderRuntimeOptions {
  openRouterSettings?: OpenRouterSettings;
  forceRefresh?: boolean;
}

export interface ProviderModelApi {
  id: ProviderId;
  getModels: (options?: ProviderRuntimeOptions) => Promise<ProviderModelsResult>;
  chatCompletion: (
    request: ProviderChatRequest,
    options?: ProviderRuntimeOptions
  ) => Promise<ProviderChatCompletionInitResult>;
}

export interface ProviderErrorMeta {
  provider: ProviderId;
  status?: number;
  code?: string;
  requestId?: string | null;
  endpoint?: string;
  details?: unknown;
}

export class ProviderRequestError extends Error {
  readonly meta: ProviderErrorMeta;

  constructor(message: string, meta: ProviderErrorMeta) {
    super(message);
    this.name = 'ProviderRequestError';
    this.meta = meta;
  }
}

export function redactAuthorizationHeader(value: string | null | undefined): string {
  if (!value) return '';

  const trimmed = value.trim();
  const [scheme, token] = trimmed.split(/\s+/, 2);

  if (!scheme || !token) {
    return '***';
  }

  if (token.length <= 8) {
    return `${scheme} ***`;
  }

  return `${scheme} ${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function extractRequestId(headers: Headers): string | null {
  return (
    headers.get('x-request-id') ??
    headers.get('request-id') ??
    headers.get('x-openrouter-request-id') ??
    null
  );
}

export function toIsoTimestamp(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

export async function readProviderError(
  response: Response
): Promise<Record<string, unknown> | string | null> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

export function extractErrorMessage(errorBody: Record<string, unknown> | string | null): string {
  if (!errorBody) return 'Unknown provider error';

  if (typeof errorBody === 'string') {
    return errorBody;
  }

  const nestedError = errorBody.error;
  if (typeof nestedError === 'string') {
    return nestedError;
  }

  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === 'string') {
      return nestedMessage;
    }
  }

  const detail = errorBody.detail;
  if (typeof detail === 'string') {
    return detail;
  }

  const message = errorBody.message;
  if (typeof message === 'string') {
    return message;
  }

  return 'Unknown provider error';
}
