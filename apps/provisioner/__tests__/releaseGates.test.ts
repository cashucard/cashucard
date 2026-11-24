import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  BENCH_RUNS_ENABLED,
  LOAD_FILE_VALIDATED,
  VALIDATED_LOAD_FILE_SHA256S,
  benchActionAllowed,
  installGate,
  loadFileValidated,
} from '../src/releaseGates';
import {CASHU_LOAD_FILE} from '../src/assets/cashu';

test('installation follows the load file this build carries, never a bare switch', () => {
  expect(LOAD_FILE_VALIDATED).toBe(
    VALIDATED_LOAD_FILE_SHA256S.includes(CASHU_LOAD_FILE.sha256),
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
  // installation still wants a maker of its own (D239): with none saved on the phone it stays off
  // (installGate.test.ts has every case)
  expect(LOAD_FILE_VALIDATED).toBe(true);
  expect(
    installGate({
      loadFileValidated: LOAD_FILE_VALIDATED,
      saved: null,
    }).allowed,
  ).toBe(false);
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
  // this build: the bench is off
  expect(benchActionAllowed('cashu')).toBe(
    BENCH_RUNS_ENABLED && LOAD_FILE_VALIDATED,
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

test('the bench installs the Cashu card only with a maker that passed the gate', () => {
  const screen = readFileSync(
    resolve(__dirname, '../src/screens/LoadTestScreen.tsx'),
    'utf8',
  );
  // the plan comes from cashuPlanFor (a gated maker) and from nowhere else
  expect(screen).toContain("if (action === 'cashu' && !maker) {");
  expect(screen).toContain('cashuPlanFor(maker!)');
  expect(screen).not.toMatch(/CASHU_PLAN|cashuPlan\(/);
});

test('no source file builds a card plan except from a gated maker', () => {
  // cashuPlan (cardkit's, any address) is called in src/cardkit.ts alone: by cashuPlanFor, and for the order of
  // installs in a plan that never leaves its function
  const {readdirSync} = require('node:fs');
  const files = (dir: string): string[] =>
    readdirSync(dir, {withFileTypes: true}).flatMap(
      (e: {name: string; isDirectory(): boolean}) =>
        e.isDirectory()
          ? e.name === 'assets'
            ? []
            : files(`${dir}/${e.name}`)
          : /\.tsx?$/.test(e.name)
          ? [`${dir}/${e.name}`]
          : [],
    );
  const src = resolve(__dirname, '../src');
  const all = [...files(src), resolve(__dirname, '../App.tsx')];
  expect(all.length).toBeGreaterThan(30);
  for (const file of all) {
    const text = readFileSync(file, 'utf8');
    const calls = text.match(/\bcashuPlan\(/g) ?? [];
    expect([file, calls.length]).toEqual([
      file,
      file.endsWith('/src/cardkit.ts') ? 2 : 0,
    ]);
    expect([file, /\bCASHU_PLAN\b|MAKER\.tagAddress/.test(text)]).toEqual([
      file,
      false,
    ]);
    // provision() is called with a plan in two places: the install tap and the bench
    const provisions = (text.match(/\bprovision\(/g) ?? []).length;
    expect([file, provisions]).toEqual([
      file,
      /\/src\/(provisioningTap\.ts|screens\/LoadTestScreen\.tsx)$/.test(file)
        ? 1
        : 0,
    ]);
  }
});
