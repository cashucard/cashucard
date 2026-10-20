/**
 * The NFC session's lifetime. Android hands the app the tag through
 * onNewIntent, which it brackets with onPause and onResume (AppState goes
 * 'background', then 'active'), and iOS reports 'inactive' while its NFC sheet
 * is up: neither may end the session the tap has just opened. The native
 * module is modelled as closing the IsoDep handle on cancelTechnologyRequest,
 * as nfc-manager's Android side does, so a transceive after a cancel fails.
 *
 * And what the session's errors say. nfc-manager's iOS side throws each Core
 * NFC code as one of its classes with no message, so the class's name is what
 * must reach the screen and, through cardkit's TransportError, the readout's
 * `why`. The tests throw the library's own classes, as the phone would.
 */
import {AppState, Platform, type AppStateStatus} from 'react-native';
import NfcManager, {NfcError, NfcTech} from 'react-native-nfc-manager';

import {CASHU_PLAN, provision} from '../src/cardkit';
import {describeSessionError} from '../src/copy';
import {randomBytes} from '../src/random';
import {formatReadout, makeReadout} from '../src/readout';
import {createCardSession, nfcErrorName, withCard} from '../src/session';
import {FakeCard} from '../../../tools/cardkit/gp/test/fake-card';

const nfc = jest.mocked(NfcManager);

type Listener = (state: AppStateStatus) => void;
let listeners: Listener[] = [];
let closed = false;

/** AppState moving to `state`, told to whatever listens. */
function appState(state: AppStateStatus): void {
  for (const listener of [...listeners]) {
    listener(state);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  closed = false;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      listeners.push(handler as Listener);
      return {
        remove: () => {
          listeners = listeners.filter(l => l !== handler);
        },
      };
    });
  nfc.cancelTechnologyRequest.mockImplementation(async () => {
    closed = true;
  });
  nfc.isoDepHandler.transceive.mockImplementation(async () => {
    if (closed) {
      throw new Error('the IsoDep handle is closed');
    }
    return [0x90, 0x00];
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Runs one session whose tap brings `states`, and checks it reached the card and was cancelled once, at the end. */
async function tapWith(states: AppStateStatus[]): Promise<void> {
  nfc.requestTechnology.mockImplementation(async () => {
    states.forEach(appState);
    return NfcTech.IsoDep;
  });
  let cancelsDuringRun = -1;
  const {value} = await withCard('hold', async tx => {
    const reply = await tx([0x00, 0xa4, 0x04, 0x00, 0x00]);
    cancelsDuringRun = nfc.cancelTechnologyRequest.mock.calls.length;
    return reply;
  });
  expect(nfc.isoDepHandler.transceive).toHaveBeenCalledTimes(1);
  expect(value).toEqual([0x90, 0x00]);
  expect(cancelsDuringRun).toBe(0);
  expect(nfc.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
}

test("Android's tag dispatch (background, then active) leaves the session to the run", async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await tapWith(['background', 'active']);
});

test("iOS's NFC sheet (inactive) leaves the session to the run", async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  await tapWith(['inactive']);
});

test("names every error class the NFC library exports by the library's own name, and nothing else", () => {
  const classes = Object.entries(NfcError).filter(
    ([, v]) =>
      typeof v === 'function' && v.prototype instanceof NfcError.NfcErrorBase,
  );
  // 3.17.2 exports 22 besides the base (src/NfcError.js): the loop is not vacuous
  expect(classes).toHaveLength(22);
  for (const [exported, type] of classes) {
    expect(nfcErrorName(new type())).toBe(exported);
  }
  // under a Release bundle's names as well
  const Renamed = {n: class extends NfcError.SessionInvalidated {}}.n;
  expect(Renamed.name).not.toBe('SessionInvalidated');
  expect(nfcErrorName(new Renamed())).toBe('SessionInvalidated');
  // the base carries the native message itself, and an Error is not the library's
  expect(
    nfcErrorName(new NfcError.NfcErrorBase('transceive fail')),
  ).toBeUndefined();
  expect(nfcErrorName(new Error('SessionInvalidated'))).toBeUndefined();
});

test.each(['Timeout', 'SecurityViolation'] as const)(
  'the screen names %s when iOS ends the session before a card',
  async name => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    // as nfc-manager's iOS side throws it: the class, and no message
    nfc.requestTechnology.mockRejectedValue(new NfcError[name]());
    const error = await withCard('hold', async () => 'unreached').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NfcError[name]);
    expect(describeSessionError(error)).toBe(`No card session: ${name}.`);
    expect(nfc.isoDepHandler.transceive).not.toHaveBeenCalled();
    expect(nfc.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  },
);

let t = 0;
const options = () => ({random: randomBytes, now: () => (t += 3)});

/** Where the 37th LOAD block falls among the APDUs of a clean install. */
async function block37(): Promise<number> {
  const clean = new FakeCard();
  expect((await provision(clean.transceive, CASHU_PLAN, options())).ok).toBe(
    true,
  );
  const loads = clean.log.flatMap((a, i) => (a[1] === 0xe8 ? [i] : []));
  expect(loads).toHaveLength(82);
  return loads[36];
}

test.each([
  ['ios', 'SessionInvalidated', () => new NfcError.SessionInvalidated()],
  ['ios', 'TagConnectionLost', () => new NfcError.TagConnectionLost()],
  [
    'android',
    'transceive fail',
    () => new NfcError.NfcErrorBase('transceive fail'),
  ],
] as const)(
  'a transceive that fails on %s with %s mid-load stops the run for that reason, and the readout says which',
  async (os, reason, error) => {
    jest.replaceProperty(Platform, 'OS', os);
    nfc.requestTechnology.mockResolvedValue(NfcTech.IsoDep);
    const at = await block37();
    const card = new FakeCard();
    let calls = 0;
    nfc.isoDepHandler.transceive.mockImplementation(async apdu => {
      if (calls++ === at) {
        throw error();
      }
      return card.transceive(apdu);
    });
    const {value, stamps, meta} = await withCard('hold', tx =>
      provision(tx, CASHU_PLAN, options()),
    );
    expect([value.ok, value.kind, value.phase, value.reason]).toEqual([
      false,
      'pulled',
      'load',
      reason,
    ]);
    const text = formatReadout(
      makeReadout({
        action: 'Install Cashu card',
        results: [value],
        stamps,
        meta,
      }),
    );
    expect(text).toContain(`why: ${reason}`);
    expect(text).not.toContain('the card did not answer');
  },
);

test('a scoped session cancelled during native startup never requests a tag', async () => {
  nfc.requestTechnology.mockResolvedValue(NfcTech.IsoDep);
  let release!: () => void;
  nfc.start.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  const session = createCardSession();
  const run = jest.fn();
  const pending = session.run('read identity', run);
  await session.cancel();
  release();
  await expect(pending).rejects.toThrow('Card session cancelled');
  expect(nfc.requestTechnology).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test('cancelling an unrelated scoped session cannot close the active session', async () => {
  const active = createCardSession();
  const unrelated = createCardSession();
  nfc.requestTechnology.mockResolvedValue(NfcTech.IsoDep);
  const {value} = await active.run('read identity', async tx => {
    await unrelated.cancel();
    expect(nfc.cancelTechnologyRequest).not.toHaveBeenCalled();
    return tx([0x00]);
  });
  expect(value).toEqual([0x90, 0x00]);
});

test('scoped cancellation blocks later commands even if native cancellation is delayed', async () => {
  const session = createCardSession();
  nfc.requestTechnology.mockResolvedValue(NfcTech.IsoDep);
  nfc.cancelTechnologyRequest.mockImplementation(async () => undefined);
  await session.run('read identity', async tx => {
    await tx([0x00]);
    await session.cancel();
    await expect(tx([0x01])).rejects.toThrow('Card session cancelled');
  });
  expect(nfc.isoDepHandler.transceive).toHaveBeenCalledTimes(1);
});
