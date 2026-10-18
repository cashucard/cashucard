/**
 * The readout: iOS headroom, the critical path, the sums, the slow APDUs, the
 * free memory, and no APDU data anywhere in it.
 */
import type {ApduRecord, PhaseTiming, RunResult} from '../src/cardkit';
import {
  ANDROID_DEFAULT_TIMEOUT_MS,
  IOS_SESSION_MS,
  formatReadout,
  locksOut,
  makeReadout,
} from '../src/readout';

function timing(phase: string, ms: number, apdus = 1, maxMs = ms): PhaseTiming {
  return {phase, ms, apdus, maxMs};
}

function apdu(phase: string, ins: number, ms: number, lc = 0): ApduRecord {
  return {phase, ins, lc, sw: 0x9000, rlen: 0, ms};
}

const INSTALL_TIMINGS = [
  timing('probe', 40, 1),
  timing('selectIsd', 30, 2),
  timing('auth', 120, 2),
  timing('sweep', 400, 4),
  timing('installForLoad', 50, 1),
  timing('load', 21000, 82, 730),
  timing('installOpener', 300, 1),
  timing('installCard', 1100, 1),
  timing('installTag', 250, 1),
  timing('verify', 900, 4),
  timing('done', 0, 0, 0),
];

function install(extra: Partial<RunResult<string>> = {}): RunResult<string> {
  return {
    ok: true,
    phase: 'done',
    timings: INSTALL_TIMINGS,
    apdus: [
      apdu('load', 0xe8, 730, 69),
      apdu('load', 0xe8, 250, 255),
      apdu('installCard', 0xe6, 1100, 41),
    ],
    freeBefore: {nonVolatile: 164176, applications: 2},
    freeAfter: {nonVolatile: 119080, applications: 5},
    ...extra,
  };
}

const META = {platform: 'ios', os: '18.6'};

test('iOS headroom is the 60 s session less arm to done, and the tap wait is arm to connect', () => {
  const r = makeReadout({
    action: 'Install Cashu card',
    results: [install()],
    stamps: {arm: 1000, connect: 4000, done: 39000},
    meta: META,
  });
  expect(r.tapWaitMs).toBe(3000);
  expect(r.totalMs).toBe(38000);
  expect(r.iosHeadroomMs).toBe(IOS_SESSION_MS - 38000);
  expect(r.iosHeadroomMs).toBe(22000);
});

test('the critical path is login to the last INSTALL, with the sweep and the checks apart', () => {
  const r = makeReadout({
    action: 'Install Cashu card',
    results: [install()],
    stamps: {arm: 0},
    meta: META,
  });
  expect(r.criticalPathMs).toBe(120 + 50 + 21000 + 300 + 1100 + 250);
  expect(r.sweepMs).toBe(400);
  expect(r.verifyMs).toBe(900);
  expect(r.totalMs).toBeUndefined();
  expect(r.iosHeadroomMs).toBeUndefined();
});

test('sums the two runs of a rotation, numbering their phases', () => {
  const run = (): RunResult<string> => ({
    ok: true,
    phase: 'done',
    timings: [
      timing('selectIsd', 20),
      timing('auth', 100, 2),
      timing('putKey', 80),
      timing('reopen', 110, 3),
      timing('done', 0, 0, 0),
    ],
    apdus: [apdu('auth', 0x50, 60), apdu('putKey', 0xd8, 80, 75)],
  });
  const r = makeReadout({
    action: 'Rotate keys and back',
    results: [run(), run()],
    stamps: {arm: 0, connect: 10, done: 1000},
    meta: META,
  });
  expect(r.criticalPathMs).toBe(2 * (100 + 80 + 110));
  expect(r.phases.map(p => p.phase)).toEqual([
    '1.selectIsd',
    '1.auth',
    '1.putKey',
    '1.reopen',
    '1.done',
    '2.selectIsd',
    '2.auth',
    '2.putKey',
    '2.reopen',
    '2.done',
  ]);
  expect(r.apduCount).toBe(4);
});

test("lists every APDU over Android's default 618 ms", () => {
  const r = makeReadout({
    action: 'Install Cashu card',
    results: [install()],
    stamps: {arm: 0},
    meta: META,
  });
  expect(ANDROID_DEFAULT_TIMEOUT_MS).toBe(618);
  expect(r.slowApdus).toEqual([
    {phase: 'load', ins: 'E8', ms: 730},
    {phase: 'installCard', ins: 'E6', ms: 1100},
  ]);
});

test('reports FF21 before and after, and the bytes the install used', () => {
  const r = makeReadout({
    action: 'Install Cashu card',
    results: [install()],
    stamps: {arm: 0},
    meta: META,
  });
  expect([r.freeBefore, r.freeAfter, r.freeDelta]).toEqual([
    164176, 119080, 45096,
  ]);
  expect(formatReadout(r)).toContain(
    'free memory 164176 before, 119080 after, 45096 used',
  );
});

test('says where a run stopped and why', () => {
  const r = makeReadout({
    action: 'Install Cashu card',
    results: [
      install({
        ok: false,
        phase: 'load',
        kind: 'pulled',
        reason: 'Tag was lost',
        blocks: {at: 37, of: 82},
      }),
    ],
    stamps: {arm: 0, connect: 100, done: 9000},
    meta: {
      platform: 'android',
      os: '35',
      androidTimeoutMs: 15000,
      maxTransceive: 261,
    },
  });
  const text = formatReadout(r);
  expect(text).toContain('stopped at load (pulled)');
  expect(text).toContain('why: Tag was lost');
  expect(text).toContain('Android timeout 15000 ms, max transceive 261 bytes');
});

test('carries no APDU data: only INS, lengths, SW and times', () => {
  const r = makeReadout({
    action: 'Rotate keys and back',
    results: [install()],
    stamps: {arm: 0, done: 5},
    meta: META,
  });
  const json = JSON.stringify(r);
  for (const forbidden of ['data', 'bytes', 'apdu"', 'hex', 'key']) {
    expect(json.toLowerCase()).not.toContain(`"${forbidden}`);
  }
  expect(
    r.slowApdus.every(a => Object.keys(a).sort().join() === 'ins,ms,phase'),
  ).toBe(true);
  // nothing longer than a status word in hex
  expect(formatReadout(r)).not.toMatch(/\b(?=[0-9A-F]*[A-F])[0-9A-F]{6,}\b/);
});

test('stops the app after wrong keys or a refused login, and not after a pull', () => {
  const base = install();
  expect(locksOut({...base, ok: false, kind: 'wrongKeys'})).toBe(true);
  expect(
    locksOut({...base, ok: false, kind: 'refused', ins: 0x82, sw: 0x6300}),
  ).toBe(true);
  expect(
    locksOut({...base, ok: false, kind: 'refused', ins: 0x50, sw: 0x6983}),
  ).toBe(true);
  expect(
    locksOut({...base, ok: false, kind: 'refused', ins: 0xe6, sw: 0x6f00}),
  ).toBe(false);
  expect(locksOut({...base, ok: false, kind: 'pulled', ins: undefined})).toBe(
    false,
  );
  expect(locksOut({...base, ok: false, kind: 'guarded'})).toBe(false);
});
