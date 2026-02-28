import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createMcpConfigStore } from '../backend/mcpConfigStore.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpConfig-test-'));

describe('MCP config validation', () => {
  const store = createMcpConfigStore(tmpDir);

  it('rejects invalid id (empty)', () => {
    assert.throws(
      () => store.addServer({ id: '', transport: 'stdio', command: 'npx' }),
      /id is required/
    );
  });

  it('rejects invalid id (must match pattern)', () => {
    assert.throws(
      () => store.addServer({ id: 'has-dot.', transport: 'stdio', command: 'npx' }),
      /id.*must match/
    );
  });

  it('rejects invalid transport', () => {
    assert.throws(
      () => store.addServer({ id: 'test1', transport: 'websocket', command: 'npx' }),
      /transport must be one of/
    );
  });

  it('rejects stdio without command', () => {
    assert.throws(
      () => store.addServer({ id: 'test1', transport: 'stdio' }),
      /command is required/
    );
  });

  it('rejects http without url', () => {
    assert.throws(() => store.addServer({ id: 'test1', transport: 'http' }), /url is required/);
  });

  it('rejects invalid url', () => {
    assert.throws(
      () => store.addServer({ id: 'test1', transport: 'http', url: 'not-a-url' }),
      /Invalid URL/
    );
  });

  it('rejects env that is not an object', () => {
    store.addServer({ id: 'test1', transport: 'stdio', command: 'npx' });
    assert.throws(() => store.updateServer('test1', { env: 'invalid' }), /env must be an object/);
    store.removeServer('test1');
  });

  it('accepts valid stdio server', () => {
    const server = store.addServer({
      id: 'valid-stdio',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-package'],
    });
    assert.strictEqual(server.id, 'valid-stdio');
    assert.strictEqual(server.transport, 'stdio');
    assert.strictEqual(server.command, 'npx');
    assert.deepStrictEqual(server.args, ['-y', 'some-package']);
    store.removeServer('valid-stdio');
  });

  it('accepts valid http server', () => {
    const server = store.addServer({
      id: 'valid-http',
      transport: 'http',
      url: 'http://localhost:3000',
    });
    assert.strictEqual(server.id, 'valid-http');
    assert.strictEqual(server.transport, 'http');
    assert.strictEqual(server.url, 'http://localhost:3000');
    store.removeServer('valid-http');
  });
});
