/**
 * The NFC session's lifetime. Android hands the app the tag through
 * onNewIntent, which it brackets with onPause and onResume (AppState goes
 * 'background', then 'active'), and iOS reports 'inactive' while its NFC sheet
 * is up: neither may end the session the tap has just opened. The native
 * module is modelled as closing the IsoDep handle on cancelTechnologyRequest,
 * as nfc-manager's Android side does, so a transceive after a cancel fails.
 */
import {AppState, Platform, type AppStateStatus} from 'react-native';
import NfcManager, {NfcTech} from 'react-native-nfc-manager';

import {withCard} from '../src/session';

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
