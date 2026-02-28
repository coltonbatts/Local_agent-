import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { resolveSafePath } from '../backend/nativeTools.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nativeTools-test-'));

describe('resolveSafePath', () => {
  it('allows paths inside project root', () => {
    const root = tmpDir;
    const result = resolveSafePath(root, 'foo/bar');
    assert.ok(result.endsWith(path.join('foo', 'bar')));
    assert.ok(path.relative(root, result).startsWith('foo'));
    assert.ok(!path.relative(root, result).startsWith('..'));
  });

  it('allows relative paths like ./file', () => {
    const root = tmpDir;
    const result = resolveSafePath(root, './baz');
    assert.ok(
      path.relative(root, result) === 'baz' || path.relative(root, result).startsWith('baz')
    );
  });

  it('rejects path traversal with ..', () => {
    const root = tmpDir;
    assert.throws(() => resolveSafePath(root, '../etc/passwd'), /Path is outside the project root/);
  });

  it('rejects path traversal with multiple ..', () => {
    const root = tmpDir;
    assert.throws(
      () => resolveSafePath(root, 'foo/../../../etc/passwd'),
      /Path is outside the project root/
    );
  });

  it('rejects paths that resolve outside root', () => {
    const root = tmpDir;
    const escaped = path.join(root, '..', 'escaped');
    assert.throws(
      () => resolveSafePath(root, path.relative(root, escaped) || '..'),
      /Path is outside the project root/
    );
  });

  it('rejects path starting with ..', () => {
    const root = tmpDir;
    assert.throws(() => resolveSafePath(root, '..'), /Path is outside the project root/);
  });

  it('normalizes path separators', () => {
    const root = tmpDir;
    const result = resolveSafePath(root, 'a/b/c');
    assert.ok(!result.includes('\\') || process.platform === 'win32');
    assert.ok(result.includes('a'));
  });
});
