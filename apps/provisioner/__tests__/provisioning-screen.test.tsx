import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {ApiClient} from '../src/api';
import {AppStore, useApp, type AppStateShape} from '../src/store';
import {
  ProvisioningProvider,
  useProvisioning,
  type ProvisioningProviderOptions,
} from '../src/ProvisioningStore';
import {ProvisioningScreen} from '../src/screens/ProvisioningScreen';
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

test('the release gate blocks direct create and program calls, without collecting a PIN', async () => {
  const f = fixture();
  const runCard = jest.fn();
  const tree = await mount({...f, runCard, serviceFor: () => f.service});
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
  await act(async () => {
    tree.root.findByProps({testID: 'pin-batch'}).props.onPress();
  });
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
  const reads = (f.service.attempt as jest.Mock).mock.calls.length;
  await act(async () => {
    expect(await flow.recover()).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.attempt).toHaveBeenCalledTimes(reads);
  expect(tree.root.findAllByProps({testID: 'real-attempt'})).toHaveLength(0);
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
    // New storage adapter models process loss. The production gate remains false;
    // only software record recovery may run after signing back in.
    const runCard = jest.fn();
    const recovered = await mount({
      ...f,
      storage: {...f.storage},
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

test('real batch setup rejects zero count and submits PIN-free settings once valid', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    serviceFor: () => f.service,
  });
  await signIn();
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
  expect(f.service.batch).toHaveBeenCalledTimes(1);
  expect((f.service.batch as jest.Mock).mock.calls[0][0]).toMatchObject({
    count: 2,
    mint_url: config.mint,
  });
  expect(f.bytes()).not.toContain('pinBatch');
  expect(tree.root.findByProps({testID: 'real-progress'})).toBeTruthy();
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

test('replacement requires a closed-session review and one-shot installation-specific consent', async () => {
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
      return 'replacement-consent-required';
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
  await act(async () => {
    await tree.root
      .findByProps({testID: 'replacement-confirm'})
      .props.onPress();
  });
  expect(consents).toEqual([undefined, installationId]);
  // A subsequent ordinary tap never reuses the previous confirmation.
  await act(async () => {
    await flow.program();
  });
  expect(consents).toEqual([undefined, installationId, undefined]);
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
