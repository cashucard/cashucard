import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {
  Share,
  Platform,
  ScrollView,
  InputAccessoryView,
  Keyboard,
  Pressable,
  Text,
} from 'react-native';
import {AppStore, useApp, type AppStateShape} from '../src/store';
import {ApiClient} from '../src/api';
import {ProvisioningProvider, useProvisioning} from '../src/ProvisioningStore';
import {ResetCardScreen} from '../src/screens/ResetCardScreen';
import {readCardStatus} from '../src/cardStatus';
import {
  readResetReview,
  TransportError,
  type ResetReview,
} from '../src/cardkit';
import type {
  OwnedResetService,
  OwnedResetState,
} from '../src/ownedResetWorkflow';
import {CardFigure} from '../src/CardFigure';
import type {JournalStorage} from '../src/journal';

jest.mock('../src/cardStatus', () => ({
  ...jest.requireActual('../src/cardStatus'),
  readCardStatus: jest.fn(),
}));
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
let leave = jest.fn();
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
  const [showReset, setShowReset] = React.useState(true);
  return showReset ? (
    <ResetCardScreen
      onBack={() => {
        leave();
        setShowReset(false);
      }}
      onInstall={() => {}}
    />
  ) : (
    <Pressable testID="reopen-reset" onPress={() => setShowReset(true)}>
      <Text>Reset a card</Text>
    </Pressable>
  );
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
  leave = jest.fn();
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
  return {service, resetStorage, run, leave};
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

test('leaving a prepared reset retains its exact durable review and makes no card/authentication calls', async () => {
  const f = await mount({spent: 0});
  await press('reset-inspect');
  await press('reset-consent-erase');
  await press('reset-consent-value');
  await press('reset-prepare');
  const before = await f.resetStorage.read();
  await press('reset-leave');
  expect(f.leave).toHaveBeenCalledTimes(1);
  expect(await f.resetStorage.read()).toBe(before);
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});

test('cancel also stops a service-only read and ignores its late eligibility response', async () => {
  const f = await mount();
  jest
    .mocked(readCardStatus)
    .mockResolvedValue({state: 'present', chipId: card.chipId, card});
  let finish!: (value: any) => void;
  f.service.lookup = jest.fn(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = flow.inspectStatus();
  });
  expect(flow.busy).toBe(true);
  expect(flow.cardReadout).not.toBeNull();
  await act(async () => flow.cancel());
  await act(async () => {
    finish({
      can_reset: true,
      lookup: {
        status: 'found',
        source: {attemptId: uuid(3), keySourceRef: `escrow:${uuid(3)}`},
      },
    });
    expect(await pending).toBe(false);
  });
  expect(flow.cardReadout).toBeNull();
  expect(f.service.keys).not.toHaveBeenCalled();
});

test('cancelled preparation cannot save a late reset or block checking the next card', async () => {
  const f = await mount({spent: 0});
  await press('reset-inspect');
  await press('reset-consent-erase');
  await press('reset-consent-value');
  let finish!: (
    value: Awaited<ReturnType<OwnedResetService['lookup']>>,
  ) => void;
  jest.mocked(f.service.lookup).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = tree.root.findByProps({testID: 'reset-prepare'}).props.onPress();
  });
  expect(flow.busy).toBe(true);
  await press('reset-cancel');
  await act(async () => {
    finish({
      can_reset: true,
      lookup: {
        status: 'found',
        source: {
          attemptId: uuid(3),
          keySourceRef: `escrow:${uuid(3)}`,
        },
      },
    });
    expect(await pending).toBe(false);
  });
  expect(await f.resetStorage.read()).toBeNull();
  expect(flow.resetState).toBeNull();
  expect(flow.resetReview).toBeNull();
  expect(flow.notice).toBe('Cancelled. You can check another card.');
  await press('reset-leave');
  await press('reopen-reset');
  const nextChip = 'cplc-v1:4790d3213041093361205547';
  jest
    .mocked(readResetReview)
    .mockResolvedValueOnce({...card, spent: 0, chipId: nextChip});
  await press('reset-inspect');
  expect(f.run).toHaveBeenCalledTimes(2);
  expect(flow.resetReview?.card.chipId).toBe(nextChip);
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});

test('cancelling a new NFC check does not leave the previous card review actionable', async () => {
  await mount({spent: 0});
  await press('reset-inspect');
  await press('reset-consent-erase');
  await press('reset-consent-value');
  jest
    .mocked(readResetReview)
    .mockRejectedValueOnce(new TransportError('Reset cancelled'));
  await press('reset-inspect');
  expect(flow.resetReview).toBeNull();
  expect(tree.root.findAllByProps({testID: 'reset-prepare'})).toHaveLength(0);
  expect(flow.resetState).toBeNull();
});

test('Stop during a durable preparation write keeps the committed reset recoverable', async () => {
  const f = await mount({spent: 0});
  await press('reset-inspect');
  await press('reset-consent-erase');
  await press('reset-consent-value');
  const original = f.resetStorage.replace;
  let finish!: () => void;
  jest.spyOn(f.resetStorage, 'replace').mockImplementationOnce(async value => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    await original(value);
  });
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = flow.prepareReset({erase: true, valueHandled: true});
  });
  expect(finish).toBeDefined();
  await press('reset-cancel');
  await act(async () => {
    finish();
    expect(await pending).toBe(false);
  });
  expect(flow.resetState?.journal.stage).toBe('reviewed');
  expect(flow.notice).toBe(
    'Stopped. Saved work stays on this phone. Continue with the same card, account and service.',
  );
  const saved = await f.resetStorage.read();
  expect(saved).not.toBeNull();
  await act(async () => {
    await flow.reload();
  });
  expect(await f.resetStorage.read()).toBe(saved);
  expect(flow.resetState?.journal.stage).toBe('reviewed');
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});

function completedReset(): OwnedResetState {
  const reset_id = uuid(200),
    device_id = flow.snapshot!.device_id;
  const binding = {reset_id, chip_id: card.chipId, operator_id: 1, device_id};
  return {
    schema: 1,
    review: {...card, spent: 0},
    cleanup: null,
    journal: {
      schema: 1,
      stage: 'complete',
      service_origin: 'https://ops.test',
      key_env: 'issued',
      ...binding,
      installation_id: card.installationId,
      source_origin: 'https://ops.test',
      source_attempt_id: uuid(3),
      consent: {erase_owner_and_proofs: true, value_handled: true},
      service_intent_receipt: JSON.stringify({
        ...binding,
        source_attempt_id: uuid(3),
        installation_id: card.installationId,
        authorized_at: 10,
      }),
      factory_evidence: {gp_key_version: 1, verified_at: 12},
      reconciliation_receipt: JSON.stringify({
        ...binding,
        removed_installation_id: card.installationId,
        completed_at: 14,
        manager_keys: 'factory',
        cashu_package: 'absent',
      }),
    },
  };
}

test('reopening with a completed reset starts a fresh card check and retains the previous receipt', async () => {
  const f = await mount({spent: 0});
  const saved = JSON.stringify(completedReset());
  await act(async () => {
    await f.resetStorage.replace(saved);
    await flow.reload();
  });
  expect(tree.root.findByProps({testID: 'reset-inspect'}).props.title).toBe(
    'CHECK CARD FOR RESET',
  );
  expect(tree.root.findByType(CardFigure).props.state).toBe('idle');
  expect(tree.root.findByProps({testID: 'reset-share'}).props.title).toBe(
    'SHARE LAST RESET DETAILS',
  );
  await press('reset-leave');
  await press('reopen-reset');
  expect(tree.root.findByProps({testID: 'reset-inspect'}).props.title).toBe(
    'CHECK CARD FOR RESET',
  );
  expect(await f.resetStorage.read()).toBe(saved);
  await press('reset-inspect');
  expect(tree.root.findByProps({testID: 'reset-prepare'})).toBeDefined();
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});

test('a new completion shows its result once; cancelling the next check never resurrects it', async () => {
  const f = await mount({spent: 0});
  const completed = completedReset();
  const prepared: OwnedResetState = JSON.parse(JSON.stringify(completed));
  prepared.journal.stage = 'reviewed';
  delete prepared.journal.service_intent_receipt;
  delete prepared.journal.factory_evidence;
  delete prepared.journal.reconciliation_receipt;
  await act(async () => {
    await f.resetStorage.replace(JSON.stringify(prepared));
    await flow.reload();
  });
  expect(tree.root.findByProps({testID: 'reset-continue'})).toBeDefined();
  const saved = JSON.stringify(completed);
  await act(async () => {
    await f.resetStorage.replace(saved);
    await flow.reload();
  });
  expect(tree.root.findByProps({testID: 'reset-inspect'}).props.title).toBe(
    'CHECK ANOTHER CARD',
  );
  expect(tree.root.findByType(CardFigure).props.state).toBe('done');
  jest
    .mocked(readResetReview)
    .mockRejectedValueOnce(new TransportError('Reset cancelled'));
  await press('reset-inspect');
  expect(tree.root.findByProps({testID: 'reset-inspect'}).props.title).toBe(
    'CHECK CARD FOR RESET',
  );
  expect(tree.root.findByType(CardFigure).props.state).toBe('idle');
  expect(await f.resetStorage.read()).toBe(saved);
  await press('reset-inspect');
  expect(flow.resetReview?.card.chipId).toBe(card.chipId);
  expect(f.run).toHaveBeenCalledTimes(2);
  expect(f.service.authorize).not.toHaveBeenCalled();
  expect(f.service.keys).not.toHaveBeenCalled();
});
