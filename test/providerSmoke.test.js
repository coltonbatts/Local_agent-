import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const runSmoke = process.env.RUN_PROVIDER_SMOKE === '1';
const maybeDescribe = runSmoke ? describe : describe.skip;

const LOCAL_PROVIDER_BASE_URL =
  process.env.LOCAL_PROVIDER_BASE_URL?.trim() || 'http://127.0.0.1:3001/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER?.trim() || 'http://localhost';
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE?.trim() || 'Local Chat UI Smoke Test';

async function readJsonOrThrow(response, label) {
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.error || payload?.detail || `${label} failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

maybeDescribe('provider smoke checks', () => {
  it('local provider lists models and completes one chat', async () => {
    const modelsResponse = await fetch(`${LOCAL_PROVIDER_BASE_URL}/models`);
    const modelsPayload = await readJsonOrThrow(modelsResponse, 'Local /models');

    const models = Array.isArray(modelsPayload.data) ? modelsPayload.data : [];
    assert.ok(models.length > 0, 'Expected at least one local model');

    const modelId = process.env.LOCAL_PROVIDER_MODEL?.trim() || models[0]?.id;
    assert.ok(modelId, 'Unable to determine local model id');

    const chatResponse = await fetch(`${LOCAL_PROVIDER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with exactly: smoke-ok' }],
      }),
    });

    const chatPayload = await readJsonOrThrow(chatResponse, 'Local /chat/completions');
    assert.ok(Array.isArray(chatPayload.choices), 'Expected choices array in local completion');
  });

  it('openrouter provider lists models and completes one chat', async (t) => {
    if (!OPENROUTER_API_KEY) {
      t.skip('OPENROUTER_API_KEY is not set');
      return;
    }

    const headers = {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': OPENROUTER_REFERER,
      'X-OpenRouter-Title': OPENROUTER_TITLE,
    };

    const modelsResponse = await fetch('https://openrouter.ai/api/v1/models', { headers });
    const modelsPayload = await readJsonOrThrow(modelsResponse, 'OpenRouter /models');
    assert.ok(Array.isArray(modelsPayload.data), 'Expected models array from OpenRouter');

    const chatResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        stream: false,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with exactly: smoke-ok' }],
      }),
    });

    const chatPayload = await readJsonOrThrow(chatResponse, 'OpenRouter /chat/completions');
    assert.ok(Array.isArray(chatPayload.choices), 'Expected choices array in OpenRouter completion');
  });
});
