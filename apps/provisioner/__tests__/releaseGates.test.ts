import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  BENCH_RUNS_ENABLED,
  CARD_INSTALLATION_VALIDATED,
  VALIDATED_LOAD_FILE_SHA256S,
  benchActionAllowed,
  loadFileValidated,
  makerGiven,
} from '../src/releaseGates';
import {MAKER} from '../src/maker';
import {CASHU_LOAD_FILE} from '../src/assets/cashu';

test('installation follows the load file this build carries, never a bare switch', () => {
  expect(CARD_INSTALLATION_VALIDATED).toBe(
    VALIDATED_LOAD_FILE_SHA256S.includes(CASHU_LOAD_FILE.sha256) &&
      !MAKER.example,
  );
  for (const sha of VALIDATED_LOAD_FILE_SHA256S) {
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(loadFileValidated(sha)).toBe(true);
    expect(loadFileValidated(sha.toUpperCase())).toBe(true);
  }
  expect(loadFileValidated('0'.repeat(64))).toBe(false);
  expect(loadFileValidated('')).toBe(false);
});

test('the released 3.1 load file is validated, with the owner approval of 2026-11-24', () => {
  // 42,741 bytes, 3.1 with D236's review fixes, released as firmware-v3.1.0. Installed and paid from at a test mint on
  // three chips on 2026-11-23 with GlobalPlatformPro and tools/cardctl, not this app; two of the runs are counted on the
  // contributor's logs (D238). The owner approved it for build 16 (ENG-870). The files before it (9ed12359...,
  // 99a66ba7..., d69742d0...) are on refcheck's PROVEN but were never approved here, and stay off the list.
  expect(CASHU_LOAD_FILE.size).toBe(42741);
  expect(CASHU_LOAD_FILE.sha256).toBe(
    'b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da',
  );
  expect(loadFileValidated(CASHU_LOAD_FILE.sha256)).toBe(true);
  expect(VALIDATED_LOAD_FILE_SHA256S).toEqual([
    'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee',
    '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3',
    'b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da',
  ]);
  // installation still wants a maker's own file: this repository's example keeps it off
  expect(CARD_INSTALLATION_VALIDATED).toBe(!MAKER.example);
  expect(CARD_INSTALLATION_VALIDATED).toBe(false);
  // the 2.2 load file the chip took on 2026-11-06 stays validated
  expect(
    loadFileValidated(
      '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3',
    ),
  ).toBe(true);
});

test('the bench installs the Cashu card only where this build may install its load file', () => {
  // every bench action wants the bench switch; installing the card's load file also wants it validated (a chip took it)
  expect(benchActionAllowed('cashu', true, false)).toBe(false);
  expect(benchActionAllowed('cashu', true, true)).toBe(true);
  expect(benchActionAllowed('hello', true, false)).toBe(true);
  expect(benchActionAllowed('rotate', true, false)).toBe(true);
  for (const action of ['hello', 'cashu', 'rotate'] as const) {
    expect(benchActionAllowed(action, false, true)).toBe(false);
  }
  // this build: the bench is off, and the example maker file keeps installation off
  expect(benchActionAllowed('cashu')).toBe(
    BENCH_RUNS_ENABLED && CARD_INSTALLATION_VALIDATED,
  );
  expect(benchActionAllowed('cashu')).toBe(false);
});

test('the bench screen asks the gate before every run and for every button', () => {
  const screen = readFileSync(
    resolve(__dirname, '../src/screens/LoadTestScreen.tsx'),
    'utf8',
  );
  expect(screen).toContain(
    'if (!benchActionAllowed(action) || running || stopped)',
  );
  for (const action of ['hello', 'cashu', 'rotate']) {
    expect(screen).toContain(
      `disabled={!idle || !benchActionAllowed('${action}')}`,
    );
  }
  expect(screen).not.toMatch(/if \(!BENCH_RUNS_ENABLED \|\| running/);
});

test("installation wants a maker's own file: the shared repository's example installs nothing", () => {
  expect(MAKER.example).toBe(true);
  expect(MAKER.tagAddress).toBe('https://example.com/card');
  expect(makerGiven()).toBe(false);
  expect(makerGiven({example: false})).toBe(true);
  expect(CARD_INSTALLATION_VALIDATED).toBe(false);
});
