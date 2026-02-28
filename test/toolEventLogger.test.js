import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createToolEventLogger } from '../backend/toolEventLogger.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolEventLogger-test-'));

describe('tool event logger redaction', () => {
  it('redacts sensitive keys in result', () => {
    const logger = createToolEventLogger(tmpDir);
    const logPath = path.join(tmpDir, 'logs', 'tool-calls.jsonl');

    const event = logger.startEvent({
      tool_name: 'test_tool',
      args: {},
      source: 'native',
    });
    const finalized = logger.finalizeSuccess(event, {
      api_key: 'secret123',
      data: 'public-value',
      password: 'hidden',
    });
    logger.persist(finalized);

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1);
    const last = JSON.parse(lines[lines.length - 1]);

    assert.strictEqual(last.result.api_key, '[REDACTED]');
    assert.strictEqual(last.result.password, '[REDACTED]');
    assert.strictEqual(last.result.data, 'public-value');
  });

  it('redacts nested sensitive keys', () => {
    const logger = createToolEventLogger(tmpDir);
    const logPath = path.join(tmpDir, 'logs', 'tool-calls.jsonl');

    const event = logger.startEvent({
      tool_name: 'test_tool',
      args: {},
      source: 'native',
    });
    const finalized = logger.finalizeSuccess(event, {
      config: {
        api_key: 'nested-secret',
        token: 'also-secret',
        name: 'ok',
      },
    });
    logger.persist(finalized);

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);

    assert.strictEqual(last.result.config.api_key, '[REDACTED]');
    assert.strictEqual(last.result.config.token, '[REDACTED]');
    assert.strictEqual(last.result.config.name, 'ok');
  });

  it('redacts in args_preview (startEvent)', () => {
    const logger = createToolEventLogger(tmpDir);
    const event = logger.startEvent({
      tool_name: 'test_tool',
      args: { filePath: 'ok', api_key: 'secret' },
      source: 'native',
    });

    assert.strictEqual(event.args_preview.api_key, '[REDACTED]');
    assert.strictEqual(event.args_preview.filePath, 'ok');
  });
});
