import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {secret, standaloneConfig} from '../src/standalone-config';

test('standalone configuration accepts a custom mint and rejects incomplete or ambiguous setup', () => {
  const env = {
    OPS_OPERATOR_ADMINS: '["issuer-admin"]',
    OPS_MINTS: '["https://mint.example/cashu"]',
  };
  assert.deepEqual(standaloneConfig(env).mints, ['https://mint.example/cashu']);
  for (const change of [
    {OPS_PORT: '0'},
    {OPS_PORT: 'NaN'},
    {OPS_HOST: 'bad host'},
    {OPS_OPERATOR_ADMINS: '[]'},
    {OPS_MINTS: '["http://mint.example"]'},
    {OPS_MINTS: '["https://user:password@mint.example"]'},
    {OPS_MASTER_KEY: 'test', OPS_MASTER_KEY_FILE: '/unused'},
  ])
    assert.throws(() => standaloneConfig({...env, ...change}));
});

test('secret files are bounded regular files and errors exclude their contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-secret-test-'));
  try {
    const file = join(dir, 'secret');
    writeFileSync(file, 'synthetic-test-value\n');
    assert.equal(secret('TEST', {TEST_FILE: file}), 'synthetic-test-value');
    symlinkSync(file, join(dir, 'link'));
    assert.throws(() => secret('TEST', {TEST_FILE: join(dir, 'link')}));
    assert.throws(() => secret('TEST', {TEST_FILE: dir}));
    writeFileSync(file, 'x'.repeat(16385));
    assert.throws(() => secret('TEST', {TEST_FILE: file}));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
