import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {
  Share,
  Platform,
  ScrollView,
  InputAccessoryView,
  Keyboard,
} from 'react-native';
import {AppStore, useApp, type AppStateShape} from '../src/store';
import {ApiClient} from '../src/api';
import {ProvisioningProvider, useProvisioning} from '../src/ProvisioningStore';
import {ResetCardScreen} from '../src/screens/ResetCardScreen';
import {readResetReview, type ResetReview} from '../src/cardkit';
import type {OwnedResetService} from '../src/ownedResetWorkflow';
import type {JournalStorage} from '../src/journal';

jest.mock('../src/cardkit', () => ({
  ...jest.requireActual('../src/cardkit'),
  readResetReview: jest.fn(),
}));
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const card: ResetReview = {
  chipId: 'cplc-v1:4790d3213041093363205547',
  installationId:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  unspent: 0,
  spent: 13,
  owner: true,
  pin: true,
  pinBlocked: false,
  tries: 3,
  locked: false,
  record: true,
  tag: true,
  sealed: true,
  mint: 'https://mint.test',
  recordDigest: 'ab'.repeat(32),
};
let app: AppStateShape,
  flow: ReturnType<typeof useProvisioning>,
  tree: Renderer.ReactTestRenderer;
const disk = (): JournalStorage => {
  let v: string | null = null;
  return {
    read: async () => v,
    replace: async x => {
      v = x;
    },
  };
};
function Probe() {
  app = useApp();
  flow = useProvisioning();
  return <ResetCardScreen onBack={() => {}} onInstall={() => {}} />;
}
async function signIn(operator = 1) {
  const client = new ApiClient({baseUrl: 'https://ops.test'});
  jest.spyOn(client, 'operatorSession').mockResolvedValue({
    operator_id: operator,
    env: 'issued',
    token: `session-${operator}`,
  });
  await act(async () => {
    await app.signIn('operator', 'test-password', {client});
  });
}
async function mount(overrides: Partial<ResetReview> = {}) {
  let id = 0;
  const storage = disk(),
    resetStorage = disk();
  const service: OwnedResetService = {
    scope: {
      service_origin: 'https://ops.test',
      operator_id: 1,
      key_env: 'issued',
    },
    lookup: jest.fn(async () => ({
      can_reset: true,
      lookup: {
        status: 'found',
        source: {attemptId: uuid(3), keySourceRef: `escrow:${uuid(3)}`},
      },
    })),
    authorize: jest.fn(),
    keys: jest.fn(),
    complete: jest.fn(),
  };
  const run = jest.fn();
  jest.mocked(readResetReview).mockResolvedValue({...card, ...overrides});
  await act(async () => {
    tree = Renderer.create(
      <AppStore clientOptions={{baseUrl: 'https://ops.test'}}>
        <ProvisioningProvider
          options={{
            storage,
            resetStorage,
            uuid: () => uuid(++id),
            resetServiceFor: () => service,
            resetWithCard: async callback => {
              run();
              return callback(jest.fn());
            },
          }}>
          <Probe />
        </ProvisioningProvider>
      </AppStore>,
    );
  });
  await signIn();
  return {service, resetStorage, run};
}
async function press(id: string) {
  await act(async () => {
    await tree.root.findByProps({testID: id}).props.onPress();
  });
}
afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  jest.restoreAllMocks();
});

test('reset needs a deliberate read and both card-specific consents; the PIN never goes into saved work', async () => {
  const f = await mount();
  expect(f.run).not.toHaveBeenCalled();
  await press('reset-inspect');
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.service.keys).not.toHaveBeenCalled();
  expect(tree.root.findByProps({testID: 'reset-prepare'}).props.disabled).toBe(
    true,
  );
  await press('reset-consent-erase');
  expect(tree.root.findByProps({testID: 'reset-prepare'}).props.disabled).toBe(
    true,
  );
  await press('reset-consent-value');
  expect(tree.root.findByProps({testID: 'reset-prepare'}).props.disabled).toBe(
    false,
  );
  await press('reset-prepare');
  const input = tree.root.findByProps({testID: 'reset-pin'});
  expect(input.props.secureTextEntry).toBe(true);
  await act(async () => {
    input.props.onChangeText('1234');
  });
  expect(await f.resetStorage.read()).not.toContain('1234');
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({action: Share.sharedAction});
  await press('reset-share');
  const payload = share.mock.calls[0][0] as {message: string};
  expect(payload.message).toContain('cashu-reset-recovery-v1');
  expect(payload.message).not.toContain('1234');
  expect(payload.message).not.toContain('enc');
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});
test('saved reset blocks new batches and remains when the operator signs out or changes account', async () => {
  const f = await mount({spent: 0});
  await press('reset-inspect');
  await press('reset-consent-erase');
  await press('reset-consent-value');
  await press('reset-prepare');
  const before = await f.resetStorage.read();
  await act(async () => {
    expect(
      await flow.create({
        count: 1,
        mint: 'https://mint.test',
        pinPolicy: 'perCard',
        pinBatch: '',
        dailyUsd: 25,
        noPinUsd: 5,
      }),
    ).toBe(false);
  });
  await act(async () => {
    app.signOut();
  });
  await signIn(2);
  expect(flow.scopeMatches).toBe(false);
  expect(await f.resetStorage.read()).toBe(before);
  expect(tree.root.findAllByProps({testID: 'reset-continue'})).toHaveLength(0);
  expect(f.service.keys).not.toHaveBeenCalled();
});
test('a card with value offers holder recovery instructions and no reset preparation', async () => {
  const f = await mount({unspent: 1});
  await press('reset-inspect');
  expect(tree.root.findAllByProps({testID: 'reset-prepare'})).toHaveLength(0);
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});

test.each(['ios', 'android'] as const)(
  'PIN entry uses native %s keyboard scrolling and Done never starts card work',
  async platform => {
    jest.replaceProperty(Platform, 'OS', platform);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const f = await mount();
    await press('reset-inspect');
    await press('reset-consent-erase');
    await press('reset-consent-value');
    await press('reset-prepare');
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(
      platform === 'ios',
    );
    expect(scroll.props.keyboardDismissMode).toBe(
      platform === 'ios' ? 'interactive' : 'on-drag',
    );
    const pin = tree.root.findByProps({testID: 'reset-pin'});
    expect(pin.props.secureTextEntry).toBe(true);
    if (platform === 'ios') {
      const accessory = tree.root.findByType(InputAccessoryView);
      expect(pin.props.inputAccessoryViewID).toBe(accessory.props.nativeID);
      const before = await f.resetStorage.read();
      await press('reset-pin-done');
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(await f.resetStorage.read()).toBe(before);
      expect(f.run).toHaveBeenCalledTimes(1);
      expect(f.service.authorize).not.toHaveBeenCalled();
      expect(f.service.keys).not.toHaveBeenCalled();
    } else {
      expect(tree.root.findAllByType(InputAccessoryView)).toHaveLength(0);
    }
  },
);
