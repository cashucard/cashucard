import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import NfcManager, {NfcTech} from 'react-native-nfc-manager';
import App from '../App';
import {AppStore} from '../src/store';
import {ApiClient} from '../src/api';
import {fromHex, ISD_AID} from '../src/cardkit';
import {CardIdentityScreen} from '../src/screens/CardIdentityScreen';

const nfc = jest.mocked(NfcManager);
const cplc = fromHex(
  '9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000',
);
let tree: Renderer.ReactTestRenderer | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  nfc.start.mockResolvedValue(undefined);
  nfc.requestTechnology.mockResolvedValue(NfcTech.IsoDep);
  nfc.cancelTechnologyRequest.mockResolvedValue(undefined);
  nfc.isoDepHandler.transceive.mockImplementation(async command =>
    command[1] === 0xa4 ? [0x90, 0] : [...cplc, 0x90, 0],
  );
});
afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  jest.restoreAllMocks();
});
async function read() {
  await act(async () => {
    await tree!.root.findByProps({testID: 'identity-read'}).props.onPress();
  });
}

test('Settings reaches a physical identity probe offline; only an explicit tap sends SELECT ISD and GET DATA', async () => {
  const reservations = jest.spyOn(ApiClient.prototype, 'reservations');
  const auth = jest.spyOn(ApiClient.prototype, 'operatorSession');
  await act(async () => {
    tree = Renderer.create(
      <App
        recovery={{
          storage: {read: async () => null, replace: async () => {}},
          uuid: () => '00000000-0000-4000-8000-000000000001',
        }}
      />,
    );
  });
  await act(async () => {
    tree!.root.findByProps({testID: 'demo-entry'}).props.onPress();
  });
  await act(async () => {
    tree!.root.findByProps({testID: 'settings'}).props.onPress();
  });
  await act(async () => {
    tree!.root.findByProps({testID: 'identity-entry'}).props.onPress();
  });
  expect(nfc.requestTechnology).not.toHaveBeenCalled();
  await read();
  expect(
    tree!.root.findByProps({testID: 'identity-result'}).props.children,
  ).toBe('cplc-v1:4790d3213180072976207515');
  const commands = nfc.isoDepHandler.transceive.mock.calls.map(
    ([apdu]) => apdu,
  );
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual([0, 0xa4, 4, 0, ISD_AID.length, ...ISD_AID, 0]);
  expect(commands[1]).toEqual([0x80, 0xca, 0x9f, 0x7f, 0]);
  expect(auth).not.toHaveBeenCalled();
  expect(reservations).not.toHaveBeenCalled();
});

test('a failed deliberate reread clears the previous identity and does not retry', async () => {
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <CardIdentityScreen onBack={() => {}} />
      </AppStore>,
    );
  });
  await read();
  expect(tree!.root.findByProps({testID: 'identity-result'})).toBeTruthy();
  nfc.isoDepHandler.transceive.mockImplementation(async command =>
    command[1] === 0xa4 ? [0x90, 0] : [0x90, 0],
  );
  await read();
  expect(tree!.root.findAllByProps({testID: 'identity-result'})).toHaveLength(
    0,
  );
  expect(
    tree!.root.findByProps({testID: 'identity-notice'}).props.children,
  ).toContain('could not be read');
  expect(nfc.requestTechnology).toHaveBeenCalledTimes(2);
});

test('cancelling a read suppresses its late reply and retains the busy guard until the session settles', async () => {
  let release!: (reply: number[]) => void;
  nfc.isoDepHandler.transceive.mockImplementation(async command =>
    command[1] === 0xa4
      ? [0x90, 0]
      : new Promise<number[]>(resolve => {
          release = resolve;
        }),
  );
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <CardIdentityScreen onBack={() => {}} />
      </AppStore>,
    );
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = tree!.root.findByProps({testID: 'identity-read'}).props.onPress();
  });
  await act(async () => {
    tree!.root.findByProps({testID: 'identity-cancel'}).props.onPress();
  });
  expect(tree!.root.findByProps({testID: 'identity-read'}).props.disabled).toBe(
    true,
  );
  await act(async () => {
    release([...cplc, 0x90, 0]);
    await pending;
  });
  expect(tree!.root.findAllByProps({testID: 'identity-result'})).toHaveLength(
    0,
  );
  expect(
    tree!.root.findByProps({testID: 'identity-notice'}).props.children,
  ).toBe('Identity read cancelled.');
  expect(tree!.root.findByProps({testID: 'identity-read'}).props.disabled).toBe(
    false,
  );
});
