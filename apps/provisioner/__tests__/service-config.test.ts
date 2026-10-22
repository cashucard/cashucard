import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import config from '../src/serviceOrigin.json';
import {DEFAULT_SERVICE_URL} from '../src/store';
const {
  validateOrigin,
  configureFile,
  checkRelease,
} = require('../scripts/configure-service.cjs');

test('store uses the same public service origin checked by the release tool', () => {
  expect(DEFAULT_SERVICE_URL).toBe(config.serviceOrigin);
  expect(validateOrigin(config.serviceOrigin, true)).toBe(config.serviceOrigin);
});

test('release configuration requires a canonical HTTPS DNS origin without credentials or a path', () => {
  expect(validateOrigin('https://ops.example.com/', false)).toBe(
    'https://ops.example.com',
  );
  for (const bad of [
    'http://ops.example.com',
    'https://user:password@ops.example.com',
    'https://ops.example.com/api',
    'https://ops.example.com/?',
    'https://ops.example.com/#',
    'https://127.0.0.1',
    'https://[::1]',
    'https://mlod.local',
    'https://localhost',
    ' https://ops.example.com',
    'https://ops.example.com\n',
  ]) {
    expect(() => validateOrigin(bad, false)).toThrow();
  }
  expect(validateOrigin('http://127.0.0.1:8821', true)).toBe(
    'http://127.0.0.1:8821',
  );
  expect(validateOrigin('https://mlod.local:8843', true)).toBe(
    'https://mlod.local:8843',
  );
  expect(() => validateOrigin('http://192.168.1.9:8821', true)).toThrow();
});

test('invalid configuration leaves the existing public build file untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cashu-service-config-'));
  const file = join(dir, 'serviceOrigin.json');
  try {
    writeFileSync(file, 'retained');
    expect(() =>
      configureFile(file, 'https://name:secret@ops.example.com', false),
    ).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('retained');
    configureFile(file, 'https://ops.example.com/', false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      serviceOrigin: 'https://ops.example.com',
    });
  } finally {
    rmSync(dir, {recursive: true});
  }
});

test('release check rejects local endpoints and enabled or unrecognized recovery-drill flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cashu-release-check-'));
  const file = join(dir, 'serviceOrigin.json');
  const gates = join(dir, 'releaseGates.ts');
  try {
    writeFileSync(
      gates,
      'export const RECOVERY_DRILLS_ENABLED = false; export const BENCH_RUNS_ENABLED = false;',
    );
    configureFile(file, 'http://127.0.0.1:8821', true);
    expect(() => checkRelease(file, gates)).toThrow();
    configureFile(file, 'https://ops.example.com', false);
    expect(() => checkRelease(file, gates)).not.toThrow();
    for (const source of [
      'export const RECOVERY_DRILLS_ENABLED = true;',
      'export const RECOVERY_DRILLS_ENABLED = choose();',
    ]) {
      writeFileSync(
        gates,
        source + ' export const BENCH_RUNS_ENABLED = false;',
      );
      expect(() => checkRelease(file, gates)).toThrow();
    }
    writeFileSync(
      gates,
      'export const RECOVERY_DRILLS_ENABLED = false; export const BENCH_RUNS_ENABLED = true;',
    );
    expect(() => checkRelease(file, gates)).toThrow(
      'BENCH_RUNS_ENABLED = false',
    );
  } finally {
    rmSync(dir, {recursive: true});
  }
});
