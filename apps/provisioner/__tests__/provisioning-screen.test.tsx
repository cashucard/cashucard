import React from 'react';
import {ScrollView, Share} from 'react-native';
import {publicFailureContext, recoveryDetails} from '../src/recoveryExport';
import Renderer, {act} from 'react-test-renderer';
import {ApiClient, ApiServiceError} from '../src/api';
import {AppStore, useApp, type AppStateShape} from '../src/store';
import {
  ProvisioningProvider,
  useProvisioning,
  type ProvisioningProviderOptions,
} from '../src/ProvisioningStore';
import {ProvisioningScreen} from '../src/screens/ProvisioningScreen';
import {CardFigure} from '../src/CardFigure';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
  type RemoteBatch,
  type ReservedAttempt,
} from '../src/provisioningWorkflow';
import type {JournalStorage} from '../src/journal';
import {SPIKE_KEYS, fromHex, toHex} from '../src/cardkit';
import {FakeCard} from '../../../tools/cardkit/gp/test/fake-card';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = {
  count: 2,
  mint: 'https://mint.test',
  pinPolicy: 'perCard' as const,
  pinBatch: 'never-persist',
  dailyUsd: 25,
  noPinUsd: 5,
};
function fixture() {
  let bytes: string | null = null;
  let id = 0;
  const storage: JournalStorage = {
    read: jest.fn(async () => bytes),
    replace: jest.fn(async value => {
      bytes = value;
    }),
  };
  let batch: RemoteBatch;
  let attempt: ReservedAttempt;
  const service: CardProvisioningService = {
    scope: {
      service_origin: 'https://ops.test',
      operator_id: 7,
      key_env: 'issued',
    },
    batch: jest.fn(
      async request =>
        (batch ??= {
          batch_id: 42,
          batch_request_id: request.batch_request_id,
          operator_id: 7,
          device_id: request.device_id,
          next_ordinal: 0,
          config: {...request, key_env: 'issued', configuration_revision: 1},
        }),
    ),
    reserve: jest.fn(async request => {
      attempt ??= {
        ...request,
        operator_id: 7,
        revision: 0,
        state: 'active',
        chip_id: null,
        completion_receipt: null,
      };
      batch.next_ordinal = 1;
      return {...attempt};
    }),
    attempt: jest.fn(async () => ({...attempt})),
    keys: jest.fn(),
    bind: jest.fn(),
    record: jest.fn(),
    disposition: jest.fn(),
    endBatch: jest.fn(async () => ({batch_id: 42, reason: 'operator-ended' as const, next_ordinal: batch.next_ordinal, closed_at: 100})),
  };
  return {
    storage,
    service,
    uuid: () => uuid(++id),
    bytes: () => bytes,
    remote: () => attempt,
  };
}
let app: AppStateShape;
let flow: ReturnType<typeof useProvisioning>;
function Probe() {
  app = useApp();
  flow = useProvisioning();
  return <ProvisioningScreen onSettings={() => undefined} />;
}
let trees: Renderer.ReactTestRenderer[] = [];
async function mount(options: ProvisioningProviderOptions) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore clientOptions={{baseUrl: 'https://ops.test'}}>
        <ProvisioningProvider options={options}>
          <Probe />
        </ProvisioningProvider>
      </AppStore>,
    );
  });
  trees.push(tree);
  return tree;
}
async function signIn(operator_id = 7) {
  const client = new ApiClient({baseUrl: 'https://ops.test'});
  jest.spyOn(client, 'operatorSession').mockResolvedValue({
    operator_id,
    env: 'issued',
    token: `token-${operator_id}`,
  });
  await act(async () => {
    await app.signIn('lead', 'pw', {client});
  });
}
const text = (tree: Renderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children)
    .join('\n');
beforeEach(() => {
  jest
    .spyOn(ApiClient.prototype, 'mints')
    .mockResolvedValue(['https://mint.test']);
});
afterEach(async () => {
  await act(async () => {
    trees.forEach(t => t.unmount());
  });
  trees = [];
  jest.restoreAllMocks();
});

test('distributed defaults allow authenticated installation without laboratory controls', async () => {
  const f = fixture();
  const runCard = jest.fn(async () => 'interrupted' as const);
  await mount({...f, runCard, serviceFor: () => f.service});
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  expect(f.service.batch).toHaveBeenCalledTimes(1);
  await act(async () => {
    await flow.program();
  });
  expect(runCard).toHaveBeenCalledTimes(1);
  expect(flow.drill).toBeUndefined();
});

test('unfinished batch requires confirmation to end and retains server closure', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  expect(tree.root.findByProps({testID: 'end-batch'})).toBeTruthy();
  await act(async () => {
    tree.root.findByProps({testID: 'end-batch'}).props.onPress();
  });
  expect(f.service.endBatch).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByProps({testID: 'confirm-end-batch'}).props.onPress();
  });
  expect(f.service.endBatch).toHaveBeenCalledTimes(1);
  expect(flow.snapshot?.batch).toBeNull();
  expect(text(tree)).toContain('Batch mint reference');
});

test('sync saved work explains its service action and confirms a successful check', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  expect(text(tree)).toContain('SYNC SAVED WORK');
  await act(async () => {
    await flow.recover();
  });
  expect(text(tree)).toContain('Saved work synced with the service');
});

test('acknowledged stop remains identifiable with its reason in batch history', async () => {
  const f = fixture();
  (f.service.disposition as jest.Mock).mockImplementation(
    async (_device, attempt_id, intent) => ({
      attempt_id,
      kind: intent.kind,
      reason: intent.reason,
      revision: intent.revision + 1,
      acknowledged_at: 100,
    }),
  );
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard: async (w, service) => {
      await w.withAttempt(service, async j => {
        await j.quarantine('identity-mismatch');
      });
      return 'quarantined';
    },
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
    await flow.program();
  });
  await act(async () => {
    await flow.acknowledge();
  });
  expect(text(tree)).toContain('Card identity did not match');
  expect(text(tree)).toContain('Attempt …');
});

test('the release gate blocks direct create and program calls, without collecting a PIN', async () => {
  const f = fixture();
  const runCard = jest.fn();
  const tree = await mount({...f, hardwareValidated: false, runCard, serviceFor: () => f.service});
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
  expect(flow.drill).toBeUndefined();
  expect(text(tree)).toContain('device validation');
  expect(tree.root.findAllByProps({testID: 'pin-batch'})).toHaveLength(0);
  expect(tree.root.findAllByProps({testID: 'pin-batch-input'})).toHaveLength(0);
});

test('unreadable saved work blocks new requests; reload recovers without clearing evidence', async () => {
  const f = fixture();
  const read = jest
    .spyOn(f.storage, 'read')
    .mockRejectedValueOnce(new Error('disk'));
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
  expect(text(tree)).toContain('Saved work is paused');
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(f.storage.replace).not.toHaveBeenCalled();
  await act(async () => {
    await flow.reload();
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(flow.status).toBe('ready');
});

test('restart retains the pending reservation; a different operator cannot replay or see its details', async () => {
  const f = fixture();
  let tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  expect(f.bytes()).not.toContain(config.pinBatch);
  const w = await ProvisioningWorkflow.open(f.storage, f.uuid);
  await w.reserveNext(f.service);
  await act(async () => {
    tree.unmount();
  });
  trees = [];
  // A fresh storage adapter models a new process and forces a disk read.
  tree = await mount({
    ...f,
    storage: {...f.storage},
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn(8);
  expect(text(tree)).toContain('another account or service');
  expect(text(tree)).toContain('Operator #7');
  expect(text(tree)).toContain('https://ops.test');
  const reads = (f.service.attempt as jest.Mock).mock.calls.length;
  await act(async () => {
    expect(await flow.recover()).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.attempt).toHaveBeenCalledTimes(reads);
  expect(tree.root.findAllByProps({testID: 'real-attempt'})).toHaveLength(0);
  expect(tree.root.findAllByProps({testID: 'recovery-export'})).toHaveLength(0);
  await act(async () => {
    app.signOut();
  });
  await signIn();
  expect(flow.snapshot?.active?.attempt_id).toBe(
    w.snapshot().active?.attempt_id,
  );
  expect(text(tree)).toContain('No installation has been confirmed');
});

test('cancellation during key prefetch prevents a later native session from arming', async () => {
  const f = fixture();
  let release!: () => void;
  const prefetch = new Promise<void>(resolve => {
    release = resolve;
  });
  const withCard = jest.fn();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = jest.fn(
    async (_w, _s, options) => {
      await prefetch;
      return options.withCard(async () => 'interrupted' as const);
    },
  );
  const cancelCard = jest.fn(async () => {});
  await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard,
    withCard,
    cancelCard,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  let running!: Promise<boolean>;
  await act(async () => {
    running = flow.program();
    await Promise.resolve();
  });
  expect(flow.cardActive).toBe(true);
  await act(async () => {
    flow.cancel();
    release();
    await running;
  });
  expect(cancelCard).toHaveBeenCalledTimes(1);
  expect(withCard).not.toHaveBeenCalled();
  expect(flow.snapshot?.active?.journal?.stage).toBe('reserved');
});

test('cancel tap stays outside scrolling history while a card session is armed', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard: async () => {
      await pending;
      return 'interrupted';
    },
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  let running!: Promise<boolean>;
  await act(async () => {
    running = flow.program();
    await Promise.resolve();
  });
  expect(tree.root.findByProps({testID: 'sticky-card-action'})).toBeTruthy();
  expect(
    tree.root.findByType(ScrollView).findAllByProps({testID: 'real-cancel'}),
  ).toHaveLength(0);
  await act(async () => {
    release();
    await running;
  });
});

test('sign-out while keys are pending cannot arm NFC under the old session', async () => {
  const f = fixture();
  let release!: () => void;
  const prefetch = new Promise<void>(resolve => {
    release = resolve;
  });
  const withCard = jest.fn();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w,
    _s,
    options,
  ) => {
    await prefetch;
    return options.withCard(async () => 'interrupted');
  };
  await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard,
    withCard,
    cancelCard: async () => {},
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  let running!: Promise<boolean>;
  await act(async () => {
    running = flow.program();
    await Promise.resolve();
  });
  await act(async () => {
    app.signOut();
  });
  await act(async () => {
    release();
    await running;
  });
  expect(withCard).not.toHaveBeenCalled();
  expect(flow.snapshot?.active?.journal?.stage).toBe('reserved');
});

test('the real screen installs and rotates, then a restart retries its frozen record without another card session', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: require('node:crypto').webcrypto,
  });
  try {
    const f = fixture();
    const card = new FakeCard();
    const chip = 'cplc-v1:4790d3213180072976207515';
    const key =
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const cplc = fromHex(
      '9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000',
    );
    let bound = false;
    (f.service.keys as jest.Mock).mockImplementation(async () => ({
      attempt_id: f.remote().attempt_id,
      batch_id: 42,
      ordinal: 0,
      chip_id: null,
      enc: toHex(SPIKE_KEYS.enc).toLowerCase(),
      mac: toHex(SPIKE_KEYS.mac).toLowerCase(),
      dek: toHex(SPIKE_KEYS.dek).toLowerCase(),
    }));
    (f.service.bind as jest.Mock).mockImplementation(
      async (_device, attempt_id, input) => {
        expect(input).toEqual({revision: 0, chip_id: chip});
        bound = true;
        Object.assign(f.remote(), {chip_id: chip, revision: 1});
        return {attempt_id, chip_id: chip, revision: 1, bound_at: 123};
      },
    );
    const withCard = jest.fn(async run =>
      run(async (command: number[]) => {
        if (command[1] === 0xca && command[2] === 0x9f) {
          return [...cplc, 0x90, 0];
        }
        if ([0x50, 0x82, 0xe4, 0xe6, 0xe8, 0xd8].includes(command[1])) {
          expect(bound).toBe(true);
        }
        const reply = await card.transceive(command);
        if (command[1] === 0x10 && reply.at(-2) === 0x90) {
          return [...fromHex(key), 0x90, 0];
        }
        return reply;
      }),
    );
    (f.service.record as jest.Mock).mockRejectedValueOnce(
      new Error('network unavailable'),
    );
    const tree = await mount({
      ...f,
      hardwareValidated: true,
      serviceFor: () => f.service,
      withCard,
    });
    await signIn();
    await act(async () => {
      await flow.create(config);
    });
    await act(async () => {
      await tree.root.findByProps({testID: 'real-program'}).props.onPress();
    });
    expect(withCard).toHaveBeenCalledTimes(1);
    expect(card.failedAuths).toBe(0);
    expect(card.log.filter(c => c[1] === 0xd8)).toHaveLength(1);
    expect(flow.snapshot?.active?.journal?.stage).toBe('record_pending');
    expect(tree.root.findByType(CardFigure).props.fill).toBe(1);
    const active = flow.snapshot!.active!;
    const frozen = active.journal!.frozen_record;
    expect(frozen).toBe((f.service.record as jest.Mock).mock.calls[0][3]);
    expect(JSON.parse(frozen!)).toMatchObject({
      installation_id: key,
      gp_key_version: 1,
      verified_stage: 'rotated',
    });
    expect(f.bytes()).not.toContain(config.pinBatch);
    expect(f.bytes()).not.toContain(toHex(SPIKE_KEYS.enc).toLowerCase());
    const receipt = {
      attempt_id: active.attempt_id,
      installation_id: key,
      revision: 2,
      recorded_at: 456,
      verified_stage: 'rotated' as const,
      ready_for_holder: false as const,
    };
    (f.service.record as jest.Mock).mockImplementation(async () => {
      Object.assign(f.remote(), {
        state: 'recorded',
        revision: 2,
        completion_receipt: receipt,
      });
      return receipt;
    });
    await act(async () => {
      tree.unmount();
    });
    trees = [];
    // New storage adapter models process loss with installation explicitly disabled;
    // only software record recovery may run after signing back in.
    const runCard = jest.fn();
    const recovered = await mount({
      ...f,
      storage: {...f.storage},
      hardwareValidated: false,
      runCard,
      serviceFor: () => f.service,
    });
    await signIn();
    expect(f.service.record).toHaveBeenCalledTimes(2);
    expect((f.service.record as jest.Mock).mock.calls[1]).toEqual(
      (f.service.record as jest.Mock).mock.calls[0],
    );
    expect(runCard).not.toHaveBeenCalled();
    expect(f.service.keys).toHaveBeenCalledTimes(1);
    expect(withCard).toHaveBeenCalledTimes(1);
    expect(flow.snapshot?.active).toBeNull();
    expect(flow.snapshot?.history).toHaveLength(1);
    expect(recovered.root.findByType(CardFigure).props).toMatchObject({
      fill: 1,
      state: 'done',
    });
    expect(text(recovered)).toContain('Holder wallet setup required before use.');
    expect(text(recovered)).not.toContain('PIN:');
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'crypto', original);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  }
});

test('sign-out cancels an armed session and blocks its next command', async () => {
  const f = fixture();
  let release!: () => void;
  const pause = new Promise<void>(resolve => {
    release = resolve;
  });
  const tx = jest.fn(async () => [0x90, 0x00]);
  const cancelCard = jest.fn(async () => {});
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w,
    _s,
    options,
  ) =>
    options.withCard(async guardedTx => {
      await guardedTx([0x00]);
      await pause;
      await expect(guardedTx([0x01])).rejects.toThrow('Card session cancelled');
      return 'interrupted';
    });
  await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard,
    withCard: run => run(tx),
    cancelCard,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  let running!: Promise<boolean>;
  await act(async () => {
    running = flow.program();
    await Promise.resolve();
  });
  expect(tx).toHaveBeenCalledTimes(1);
  await act(async () => {
    app.signOut();
  });
  expect(cancelCard).toHaveBeenCalledTimes(1);
  await act(async () => {
    release();
    await running;
  });
  expect(tx).toHaveBeenCalledTimes(1);
  expect(flow.snapshot?.active?.journal?.stage).toBe('reserved');
});

test('real installation setup exposes no holder controls and submits inert legacy settings', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
  for (const testID of [
    'pin-perCard', 'pin-batch', 'pin-batch-input', 'daily-limit', 'no-pin-limit',
  ]) {
    expect(tree.root.findAllByProps({testID})).toHaveLength(0);
  }
  expect(text(tree)).toContain('The holder wallet sets the PIN, mint and limits.');
  expect(text(tree)).not.toContain('FL1 — Flash, black, the bolt');
  const countInput = () => tree.root.findByProps({testID: 'batch-count'});
  expect(countInput().props.selectTextOnFocus).toBe(true);
  await act(async () => {
    tree.root.findByProps({testID: 'batch-count-increment'}).props.onPress();
  });
  expect(countInput().props.value).toBe('13');
  await act(async () => {
    tree.root.findByProps({testID: 'batch-count-decrement'}).props.onPress();
    countInput().props.onChangeText('');
  });
  expect(countInput().props.value).toBe('');
  expect(tree.root.findByProps({testID: 'start-batch'}).props.disabled).toBe(true);
  expect(text(tree)).toContain('Enter 1 to 500 cards.');
  expect(tree.root.findByProps({testID: 'batch-count-decrement'}).props.disabled).toBe(true);
  await act(async () => {
    tree.root.findByProps({testID: 'batch-count-increment'}).props.onPress();
  });
  expect(countInput().props.value).toBe('1');
  await act(async () => {
    countInput().props.onChangeText('501');
  });
  expect(tree.root.findByProps({testID: 'start-batch'}).props.disabled).toBe(true);
  await act(async () => {
    tree.root.findByProps({testID: 'mint-https://mint.test'}).props.onPress();
    tree.root.findByProps({testID: 'batch-count'}).props.onChangeText('0');
  });
  expect(tree.root.findByProps({testID: 'start-batch'}).props.disabled).toBe(
    true,
  );
  await act(async () => {
    await tree.root.findByProps({testID: 'start-batch'}).props.onPress();
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByProps({testID: 'batch-count'}).props.onChangeText('2');
  });
  await act(async () => {
    await tree.root.findByProps({testID: 'start-batch'}).props.onPress();
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Review batch');
  await act(async () => {tree.root.findByProps({testID: 'confirm-start-batch'}).props.onPress();});
  expect(f.service.batch).toHaveBeenCalledTimes(1);
  expect((f.service.batch as jest.Mock).mock.calls[0][0]).toMatchObject({
    count: 2,
    mint_url: config.mint,
    pin_policy: 'perCard',
    daily_usd: 0,
    no_pin_usd: 0,
  });
  expect(f.bytes()).not.toContain('pinBatch');
  expect(tree.root.findByProps({testID: 'real-progress'})).toBeTruthy();
  expect(tree.root.findByType(CardFigure).props.fill).toBe(0);
});

test('real card artwork follows observed LOAD blocks and retains partial state after interruption', async () => {
  const f = fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w, _s, options,
  ) => {
    options.onEvent?.({type: 'phase', phase: 'load'});
    options.onEvent?.({type: 'block', index: 41, of: 82});
    entered();
    await held;
    return 'interrupted';
  };
  const tree = await mount({
    ...f, hardwareValidated: true, serviceFor: () => f.service, runCard,
  });
  await signIn();
  await act(async () => { await flow.create(config); });
  let running!: Promise<boolean>;
  await act(async () => { running = flow.program(); await started; });
  expect(tree.root.findByType(CardFigure).props.fill).toBe(0.5);
  expect(text(tree)).toContain('Writing 50%');
  await act(async () => { release(); await running; });
  expect(tree.root.findByType(CardFigure).props.fill).toBe(0.5);
  expect(tree.root.findByType(CardFigure).props.state).toBe('stop');
});

test('validation pauses keep the operation busy; sign-out releases the waiter and retains the attempt', async () => {
  const f = fixture();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w,
    _s,
    options,
  ) => {
    await options.checkpoint!('install-intent-saved');
    throw new Error('must not continue after sign-out');
  };
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    recoveryDrillsEnabled: true,
    serviceFor: () => f.service,
    runCard,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  await act(async () => {
    flow.drill!.arm('install-intent-saved');
  });
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = flow.program();
  });
  expect(flow.drill?.paused).toBe('install-intent-saved');
  expect(
    tree.root.findByProps({testID: 'recovery-drill-paused'}).props.children,
  ).toBe('install-intent-saved');
  expect(flow.busy).toBe(true);
  expect(f.service.record).not.toHaveBeenCalled();
  await act(async () => {
    app.signOut();
    await pending;
  });
  expect(flow.busy).toBe(false);
  expect(flow.drill?.paused).toBeNull();
  expect(flow.snapshot?.active?.journal?.stage).toBe('reserved');
});

test('enabling drill controls cannot bypass the independent installation gate', async () => {
  const f = fixture();
  const runCard = jest.fn();
  await mount({
    ...f,
    hardwareValidated: false,
    recoveryDrillsEnabled: true,
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    flow.drill!.arm('install-intent-saved');
    expect(await flow.create(config)).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(flow.drill?.target).toBeNull();
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
});

test('an installed card closes the read session and directs the operator to reset without a replacement action', async () => {
  const f = fixture();
  const chipId = 'cplc-v1:4790d3213041093363205547';
  const installationId =
    '0366bf811cadfcfc00e5f251017d1dc690a93a6a4a9d39ed114b96d33fb59d9941';
  const consents: Array<string | undefined> = [];
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    w,
    service,
    options,
  ) => {
    consents.push(options.replacementInstallationId);
    await w.withAttempt(service, async j => {
      if (!j.snapshot().chip_id) {
        await j.bind(chipId);
      }
    });
    return options.withCard(async () => {
      options.onReplacementRequired?.({chipId, installationId});
      expect(flow.replacement).toBeNull();
      return 'reset-required';
    });
  };
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    runCard,
    withCard: run => run(async () => [0x90, 0]),
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  await act(async () => {
    await flow.program();
  });
  expect(consents).toEqual([undefined]);
  expect(flow.replacement).toMatchObject({chipId, installationId});
  expect(text(tree)).toContain(installationId);
  expect(tree.root.findAllByProps({testID: 'real-program'})).toHaveLength(0);
  expect(tree.root.findAllByProps({testID:'replacement-confirm'})).toHaveLength(0);
  expect(text(tree)).toContain('This card needs reset first');
  expect(consents).toEqual([undefined]);
  await act(async () => {
    app.signOut();
  });
  expect(flow.replacement).toBeNull();
});


test('native pause messages report saved state only inside an active card session', async () => {
  const f = fixture();
  const cardMessage = jest.fn();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w, _s, options,
  ) => {
    await options.withCard(async () => {
      await options.checkpoint!('install-intent-saved');
      return 'interrupted';
    });
    await options.checkpoint!('record-frozen-session-closed');
    return 'interrupted';
  };
  const options: ProvisioningProviderOptions & {cardMessage: typeof cardMessage} = {
    ...f, hardwareValidated: true, recoveryDrillsEnabled: true,
    serviceFor: () => f.service, runCard, cardMessage,
    withCard: run => run(async () => [0x90, 0]),
  };
  await mount(options);
  await signIn();
  await act(async () => { await flow.create(config); });
  await act(async () => { flow.drill!.arm('install-intent-saved'); });
  let pending!: Promise<boolean>;
  await act(async () => { pending = flow.program(); });
  expect(flow.drill?.paused).toBe('install-intent-saved');
  expect(cardMessage).toHaveBeenCalledWith('Paused: install-intent-saved\nSaved: reserved');
  await act(async () => {
    flow.drill!.resume();
    await pending;
  });
  expect(cardMessage).toHaveBeenCalledTimes(1);
  await act(async () => { flow.drill!.arm('record-frozen-session-closed'); });
  await act(async () => { pending = flow.program(); });
  expect(flow.drill?.paused).toBe('record-frozen-session-closed');
  expect(cardMessage).toHaveBeenCalledTimes(1);
  await act(async () => { flow.drill!.resume(); await pending; });
});


test.each([
  ['load', 'Writing the applet'],
  [undefined, 'Not reported'],
  ['untrusted-detail', 'Not reported'],
])('interruption retains a public last phase (%s) through service reconciliation', async (phase, label) => {
  const f = fixture();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w, _s, options,
  ) => {
    if (phase) { options.onEvent?.({type: 'phase', phase}); }
    return 'interrupted';
  };
  const tree = await mount({
    ...f, hardwareValidated: true, serviceFor: () => f.service, runCard,
  });
  await signIn();
  await act(async () => { await flow.create(config); });
  await act(async () => { await flow.program(); });
  expect(text(tree)).toContain(`Card connection interrupted. Last phase: ${label}.`);
  expect(text(tree)).toContain('Saved stage: reserved.');
  expect(text(tree)).toContain('Ask your operator before retrying.');
  expect(text(tree)).not.toContain('untrusted-detail');
  await act(async () => { await flow.recover(); });
  expect(text(tree)).toContain(`Card connection interrupted. Last phase: ${label}.`);
  expect(flow.snapshot?.active?.journal?.stage).toBe('reserved');
  expect(f.service.record).not.toHaveBeenCalled();
  await act(async () => { app.signOut(); });
  expect(flow.notice).toBeNull();
});


test('real mint discovery never substitutes demo endpoints and can retry a failed list', async () => {
  jest.spyOn(ApiClient.prototype, 'mints')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(['https://mint.test']);
  const f = fixture();
  const tree = await mount({...f, hardwareValidated: true, serviceFor: () => f.service});
  expect(tree.root.findAllByProps({testID: 'mint-https://forge.flashapp.me'})).toHaveLength(0);
  await signIn();
  expect(tree.root.findAllByProps({testID: 'mint-https://forge.flashapp.me'})).toHaveLength(0);
  expect(text(tree)).toContain('The mint list could not be loaded.');
  expect(tree.root.findByProps({testID: 'start-batch'}).props.disabled).toBe(true);
  await act(async () => {tree.root.findByProps({testID: 'retry-mints'}).props.onPress();});
  expect(tree.root.findByProps({testID: 'mint-https://mint.test'})).toBeTruthy();
  expect(text(tree)).not.toContain('The mint list could not be loaded.');
  expect(f.service.batch).not.toHaveBeenCalled();
});


test('an explicit recovery export contains public full identities without secrets or state changes', async () => {
  const f = fixture();
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (w, service) => {
    await w.withAttempt(service, async j => {
      await j.bind('cplc-v1:4790d3213041093361205547');
      await j.quarantine('unsafe-partial-install');
    });
    return 'quarantined';
  };
  const share = jest.spyOn(Share, 'share').mockResolvedValue({action: Share.sharedAction});
  const tree = await mount({...f, hardwareValidated: true, serviceFor: () => f.service, runCard});
  await signIn();
  await act(async () => {await flow.create(config); await flow.program();});
  expect(share).not.toHaveBeenCalled();
  const before = f.bytes();
  await act(async () => {tree.root.findByProps({testID: 'recovery-export'}).props.onPress();});
  const report = JSON.parse((share.mock.calls[0][0] as {message: string}).message);
  expect(report.schema).toBe(1);
  expect(report.active).toMatchObject({
    attempt_id: flow.snapshot!.active!.attempt_id,
    journal: {stage: 'quarantined', chip_id: 'cplc-v1:4790d3213041093361205547', quarantine_reason: 'unsafe-partial-install'},
  });
  expect(JSON.stringify(report)).not.toContain(config.pinBatch);
  expect(JSON.stringify(report)).not.toContain('token-7');
  expect(report.batch).not.toHaveProperty('request');
  const future = JSON.parse(JSON.stringify(flow.snapshot));
  future.future_secret = 'not-exported-canary';
  future.active.journal.frozen_record = 'not-exported-canary';
  future.active.journal.completion_receipt = 'not-exported-canary';
  future.batch.request.mint_url = 'https://not-exported-canary@mint.test';
  future.batch.scope.service_origin = 'https://not-exported-canary@ops.test';
  future.history = Array(25).fill(future.active.journal);
  const bounded = recoveryDetails(future);
  expect(bounded.recent_history).toHaveLength(20);
  expect(bounded.history_count).toBe(25);
  expect(bounded.service_origin).toBeNull();
  expect(JSON.stringify(bounded)).not.toContain('not-exported-canary');
  expect(f.bytes()).toBe(before);
  expect(f.service.record).not.toHaveBeenCalled();
});

test('a reconciliation conflict exports bounded context and names the chip block', async () => {
  const f = fixture();
  const share = jest.spyOn(Share, 'share').mockResolvedValue({action: Share.sharedAction});
  const tree = await mount({
    ...f, hardwareValidated: true, serviceFor: () => f.service,
    runCard: async () => {throw new ApiServiceError('chip-unresolved', 409, 'bind-card');},
  });
  await signIn();
  await act(async () => {await flow.create(config); await flow.program();});
  expect(text(tree)).toContain('This chip has an unresolved attempt.');
  await act(async () => {tree.root.findByProps({testID: 'recovery-export'}).props.onPress();});
  const report = JSON.parse((share.mock.calls.at(-1)![0] as {message: string}).message);
  expect(report.failure).toEqual({operation: 'bind-card', status: 409, reason: 'chip-unresolved'});
  expect(JSON.stringify(report)).not.toContain('token-7');
  expect((await ProvisioningWorkflow.open(f.storage, f.uuid)).snapshot().last_failure)
    .toEqual(report.failure);
  expect(publicFailureContext(new ApiServiceError('private-token=do-not-export', 409, 'bind-card')))
    .toEqual({operation: 'bind-card', status: 409, reason: null});
  expect(publicFailureContext(new ApiServiceError('batch-active', 409, 'end-batch')))
    .toEqual({operation: 'end-batch', status: 409, reason: 'batch-active'});
});

test('stale independent backup pauses before NFC and retains the reserved attempt', async () => {
  const f = fixture();
  (f.service.keys as jest.Mock).mockRejectedValue(
    new ApiServiceError('independent-backup-stale', 503),
  );
  const withCard = jest.fn();
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
    withCard,
  });
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  await act(async () => {
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.keys).toHaveBeenCalledTimes(1);
  expect(withCard).not.toHaveBeenCalled();
  expect(f.service.bind).not.toHaveBeenCalled();
  expect(f.service.disposition).not.toHaveBeenCalled();
  expect(f.bytes()).toContain('active');
  expect(text(tree)).toContain(
    'Provisioning is paused because the service needs a fresh independent backup. Your saved work is retained. Ask your operator to restore backup health, then retry.',
  );
});
