import {makerStorageWith, TEST_MAKER} from '../test-support/maker';
import {MakerScreen} from '../src/screens/MakerScreen';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import {encodeSavedMaker} from '../src/maker';
import {GATE_WORDS, type InstallGate} from '../src/releaseGates';
import {MAKER_SETTING, batchMakerDiffers} from '../src/strings';
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
import {SPIKE_KEYS, TransportError, fromHex, toHex} from '../src/cardkit';
import {FakeCard} from '@cashu-card/cardkit/testing';
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
  jest.spyOn(ApiClient.prototype, 'mintInfo').mockResolvedValue({});
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
  // the build's own gate follows the load file it carries (releaseGates.ts, and releaseGates.test.ts for its value); this test is of
  // the flow once that file is validated: authenticated installation with no laboratory control
  await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), runCard, serviceFor: () => f.service});
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

test("every reserved tap asks for replaceSellerTag, so a J3R452's seller tag is replaced with no prompt (D182)", async () => {
  const f = fixture();
  let tapOptions:
    | Parameters<NonNullable<ProvisioningProviderOptions['runCard']>>[2]
    | undefined;
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w,
    _s,
    options,
  ) => {
    tapOptions = options;
    return 'interrupted';
  };
  await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), runCard, serviceFor: () => f.service});
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  await act(async () => {
    await flow.program();
  });
  expect(tapOptions).toMatchObject({replaceSellerTag: true});
});

test.each([
  [
    'interrupted',
    true,
    "The seller's NFC tag on this card was removed, and it cannot be restored.",
  ],
  [
    'interrupted',
    false,
    "The seller's NFC tag on this card may have been removed: the card did not confirm it.",
  ],
  [
    'quarantined',
    true,
    "The seller's NFC tag on this card was removed, and it cannot be restored. Mention it when you share support details with your administrator.",
  ],
] as const)(
  "an attempt %s after its run deleted a J3R452's seller tag (confirmed: %s) tells the operator, and one with no delete says nothing of it (D182)",
  async (outcome, confirmed, note) => {
    const f = fixture();
    let sellerTag = true;
    const runCard: NonNullable<ProvisioningProviderOptions['runCard']> =
      async (w, service, options) => {
        options.onEvent?.({type: 'phase', phase: 'sweep'});
        if (sellerTag) {
          options.onEvent?.({type: 'sellerTagRemoved', confirmed});
        }
        if (outcome === 'quarantined') {
          await w.withAttempt(service, async j => {
            await j.bind('cplc-v1:4790d3213041093361205547');
            await j.quarantine('verification-failed');
          });
        }
        return outcome;
      };
    const tree = await mount({
      ...f,
      hardwareValidated: true, makerStorage: makerStorageWith(),
      serviceFor: () => f.service,
      runCard,
    });
    await signIn();
    await act(async () => {
      await flow.create(config);
    });
    await act(async () => {
      await flow.program();
    });
    expect(flow.notice).toContain(note);
    expect(text(tree)).toContain(note);
    if (outcome === 'interrupted') {
      expect(flow.notice).toContain(
        'Card connection lost. Last step: Removing the old install.',
      );
      sellerTag = false;
      await act(async () => {
        await flow.program();
      });
      expect(flow.notice).toContain('Card connection lost.');
      expect(flow.notice).not.toContain('seller');
    }
  },
);

test.each(['before', 'after'] as const)(
  "an operator's Stop after a run deleted a J3R452's seller tag says so beside Stopped, with the delete reported %s the Stop (D182)",
  async when => {
    const f = fixture();
    const removed =
      "The seller's NFC tag on this card was removed, and it cannot be restored.";
    let sellerTag = true;
    let release!: () => void;
    const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
      _w,
      _s,
      options,
    ) => {
      const stopped = new Promise<void>(resolve => {
        release = resolve;
      });
      options.onEvent?.({type: 'phase', phase: 'sweep'});
      if (sellerTag && when === 'before') {
        options.onEvent?.({type: 'sellerTagRemoved', confirmed: true});
      }
      // the LOAD that follows the delete takes seconds: the operator stops it here
      await stopped;
      if (sellerTag && when === 'after') {
        options.onEvent?.({type: 'sellerTagRemoved', confirmed: true});
      }
      return 'interrupted';
    };
    const tree = await mount({
      ...f,
      hardwareValidated: true, makerStorage: makerStorageWith(),
      serviceFor: () => f.service,
      runCard,
    });
    await signIn();
    await act(async () => {
      await flow.create(config);
    });
    const stopRun = async () => {
      let running!: Promise<boolean>;
      await act(async () => {
        running = flow.program();
        await Promise.resolve();
      });
      await act(async () => {
        flow.cancel();
      });
      expect(flow.notice).toBe('Stopping. Saved work stays on this phone.');
      await act(async () => {
        release();
        await running;
      });
    };
    await stopRun();
    expect(flow.notice).toContain(
      'Stopped. Saved work stays on this phone. Continue with the same card, account and service.',
    );
    expect(flow.notice).toContain(removed);
    expect(text(tree)).toContain(removed);
    // the Stop replaces the lost-card message: no interruption is shown for it
    expect(flow.notice).not.toContain('Card connection lost.');
    // the next run deleted nothing: its Stop says nothing of the seller's tag
    sellerTag = false;
    await stopRun();
    expect(flow.notice).toContain('Stopped.');
    expect(flow.notice).not.toContain('seller');
  },
);

test.each([
  ['refused by this phone before it went out', 'unsent', false],
  ['sent, with the card gone before it answered', 'sent', true],
] as const)(
  "an operator's Stop while a J3R452's seller-tag DELETE is %s: the Stopped notice says the tag may be gone only when the DELETE went out (D182)",
  async (_how, when, noted) => {
    const f = fixture();
    const mayBe =
      "The seller's NFC tag on this card may have been removed: the card did not confirm it.";
    let release!: () => void;
    const stopped = new Promise<void>(resolve => {
      release = resolve;
    });
    const sent: number[][] = [];
    const withCard = jest.fn(async run =>
      run(async (command: number[]) => {
        sent.push(command);
        if (when === 'sent') {
          // the DELETE went out; the operator stops before the card answers
          await stopped;
        }
        throw new TransportError('Tag connection lost');
      }),
    );
    const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
      _w,
      _s,
      options,
    ) => {
      options.onEvent?.({type: 'phase', phase: 'sweep'});
      return options.withCard(async tx => {
        if (when === 'unsent') {
          // readForeignTag's GET STATUS answered while the operator was
          // stopping the run: the DELETE that follows is refused by this phone
          await stopped;
        }
        try {
          await tx([0x84, 0xe4, 0x00, 0x00, 0x00]);
        } catch {
          // cardkit's provision emits this from the catch of that same send
          options.onEvent?.({type: 'sellerTagRemoved', confirmed: false});
        }
        return 'interrupted' as const;
      });
    };
    const tree = await mount({
      ...f,
      hardwareValidated: true, makerStorage: makerStorageWith(),
      serviceFor: () => f.service,
      runCard,
      withCard,
    });
    await signIn();
    await act(async () => {
      await flow.create(config);
    });
    let running!: Promise<boolean>;
    await act(async () => {
      running = flow.program();
      for (let i = 0; i < 20 && sent.length < (when === 'sent' ? 1 : 0); i++) {
        await Promise.resolve();
      }
    });
    await act(async () => {
      flow.cancel();
    });
    expect(flow.notice).toBe('Stopping. Saved work stays on this phone.');
    await act(async () => {
      release();
      await running;
    });
    expect(flow.notice).toContain(
      'Stopped. Saved work stays on this phone. Continue with the same card, account and service.',
    );
    expect(sent).toHaveLength(when === 'sent' ? 1 : 0);
    if (noted) {
      expect(flow.notice).toContain(mayBe);
      expect(text(tree)).toContain(mayBe);
    } else {
      expect(flow.notice).not.toContain('seller');
      expect(text(tree)).not.toContain('seller');
    }
  },
);

test('unfinished batch requires confirmation to end and retains server closure', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
  });
  expect(text(tree)).toContain('CHECK SAVED WORK');
  await act(async () => {
    await flow.recover();
  });
  expect(text(tree)).toContain('Saved work checked. No card tap was started.');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
  expect(text(tree)).toContain('Installation is unavailable in this build');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
  expect(text(tree)).toContain('Installation has not been confirmed.');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
  expect(flow.snapshot).toBeNull();
  expect(JSON.parse(f.bytes()!).active.journal.stage).toBe('reserved');
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
    const intervals = jest.spyOn(globalThis, 'setInterval');
    const tree = await mount({
      ...f,
      hardwareValidated: true, makerStorage: makerStorageWith(),
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
    const savedBeforePause = f.bytes();
    const recordCallsBeforePause = (f.service.record as jest.Mock).mock.calls.length;
    await act(async () => {flow.cancel();});
    await act(async () => {
      for (const [callback, delay] of intervals.mock.calls) {
        if (delay === 30_000 && typeof callback === 'function') {callback();}
      }
    });
    intervals.mockRestore();
    expect((f.service.record as jest.Mock).mock.calls).toHaveLength(recordCallsBeforePause);
    expect(f.bytes()).toBe(savedBeforePause);

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
    expect(text(recovered)).toContain('Installation saved. Set up this card in a holder wallet before loading or spending.');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
  expect(flow.snapshot).toBeNull();
  expect(JSON.parse(f.bytes()!).active.journal.stage).toBe('reserved');
});

test('real installation setup exposes no holder controls and submits inert legacy settings', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: true, makerStorage: makerStorageWith(),
    serviceFor: () => f.service,
  });
  await signIn();
  for (const testID of [
    'pin-perCard', 'pin-batch', 'pin-batch-input', 'daily-limit', 'no-pin-limit',
  ]) {
    expect(tree.root.findAllByProps({testID})).toHaveLength(0);
  }
  expect(text(tree)).not.toContain('The holder wallet sets the PIN, mint and limits.');
  expect(text(tree)).not.toContain('Cashu Card, the cashew chip');
  const countInput = () => tree.root.findByProps({testID: 'batch-count'});
  expect(countInput().props.selectTextOnFocus).toBe(true);
  const initialCount = Number(countInput().props.value);
  await act(async () => {
    tree.root.findByProps({testID: 'batch-count-increment'}).props.onPress();
  });
  expect(countInput().props.value).toBe(String(initialCount + 1));
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
  expect(tree.root.findByProps({testID: 'batch-inline-review'}).props.children).toContain('2 cards');
  expect(tree.root.findByProps({testID: 'batch-inline-review'}).props.children).toContain(config.mint);
  await act(async () => {
    await tree.root.findByProps({testID: 'create-batch-only'}).props.onPress();
  });
  expect(f.service.reserve).not.toHaveBeenCalled();
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
    ...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service, runCard,
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
  expect(flow.snapshot).toBeNull();
  expect(JSON.parse(f.bytes()!).active.journal.stage).toBe('reserved');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    ...f, hardwareValidated: true, makerStorage: makerStorageWith(), recoveryDrillsEnabled: true,
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
  ['load', 'Writing card software'],
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
    ...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service, runCard,
  });
  await signIn();
  await act(async () => { await flow.create(config); });
  await act(async () => { await flow.program(); });
  expect(text(tree)).toContain(`Card connection lost. Last step: ${label}.`);
  expect(text(tree)).not.toContain('Saved stage: reserved.');
  expect(text(tree)).toContain('Continue with the same card to check what finished.');
  expect(text(tree)).not.toContain('untrusted-detail');
  await act(async () => { await flow.recover(); });
  expect(text(tree)).toContain(`Card connection lost. Last step: ${label}.`);
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
  const tree = await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service});
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
  const tree = await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service, runCard});
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
    ...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service,
    runCard: async () => {throw new ApiServiceError('chip-unresolved', 409, 'bind-card');},
  });
  await signIn();
  await act(async () => {await flow.create(config); await flow.program();});
  expect(text(tree)).toContain('This card has unfinished installation history.');
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
    hardwareValidated: true, makerStorage: makerStorageWith(),
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
    'Card changes are paused until the service has a fresh independent backup. Your work is saved. Ask your administrator to check backups, then retry.',
  );
});

test('a canceled operation waiting for the shared queue never arms a later card session', async () => {
  const f = fixture();
  const resetWithCard = jest.fn(async () => {throw new Error('canceled read must not arm');});
  const options = {...f, hardwareValidated: true, makerStorage: makerStorageWith(), serviceFor: () => f.service, resetWithCard};
  await mount(options);
  await signIn();
  const first = flow;
  await mount(options);
  await signIn();
  const second = flow;
  const create = f.service.batch;
  let release!: () => void;
  f.service.batch = jest.fn(request => new Promise<RemoteBatch>(resolve => {
    release = () => {resolve(create(request));};
  }));
  let creating!: Promise<boolean>, reading!: Promise<boolean>;
  await act(async () => {creating = first.create(config);});
  await act(async () => {reading = second.inspectStatus();});
  await act(async () => second.cancel());
  await act(async () => {release(); await creating; expect(await reading).toBe(false);});
  expect(resetWithCard).not.toHaveBeenCalled();
});

test('one explicit start creates the reviewed batch and reaches the first card run without another tap', async () => {
  const f = fixture();
  const runCard = jest.fn(async () => 'interrupted' as const);
  const tree = await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), runCard, serviceFor: () => f.service});
  await signIn();
  expect(runCard).not.toHaveBeenCalled();
  await act(async () => {await flow.startAndRead({...config, count: 1});});
  expect(f.service.batch).toHaveBeenCalledTimes(1);
  expect(f.service.reserve).toHaveBeenCalledTimes(1);
  expect(runCard).toHaveBeenCalledTimes(1);
  expect(flow.snapshot?.batch?.request.count).toBe(1);
  expect(tree.root.findByProps({testID: 'real-progress'})).toBeDefined();
  expect(f.bytes()).not.toContain('never-persist');
});

test('Stop while batch creation is waiting retains its original request and prevents a later first-card read', async () => {
  const f = fixture();
  const create = f.service.batch;
  let finish!: () => void;
  f.service.batch = jest.fn(request => new Promise(resolve => {finish = async () => resolve(await create(request));}));
  const runCard = jest.fn(async () => 'interrupted' as const);
  const tree = await mount({...f, hardwareValidated: true, makerStorage: makerStorageWith(), runCard, serviceFor: () => f.service});
  await signIn();
  let running!: Promise<boolean>;
  await act(async () => {running = flow.startAndRead({...config, count: 1});});
  expect(tree.root.findByProps({testID: 'batch-count'}).props.editable).toBe(false);
  const request = JSON.parse(f.bytes()!).batch.request;
  await act(async () => flow.cancel());
  await act(async () => {finish(); expect(await running).toBe(false);});
  expect(JSON.parse(f.bytes()!).batch.request).toEqual(request);
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
});

// The card maker setting (D239).
const FOXY = {name: 'Foxy', tagAddress: 'https://getfoxy.io/card'};
const FORK_FILE = {
  example: false,
  name: 'Island Cards',
  tagAddress: 'https://cards.islandbitcoin.com/c',
};
// The form opens from Settings, after the phone's setting is read: a test that
// wants that order mounts with the form closed and opens it later.
let makerFormOpen = true;
function MakerProbe() {
  app = useApp();
  flow = useProvisioning();
  return (
    <>
      {makerFormOpen ? <MakerScreen onBack={() => undefined} /> : null}
      <SettingsScreen
        onBack={() => undefined}
        onBench={() => undefined}
        onMaker={() => undefined}
        maker={flow.savedMaker}
      />
    </>
  );
}
const makerTree = (options: ProvisioningProviderOptions) => (
  <AppStore clientOptions={{baseUrl: 'https://ops.test'}}>
    <ProvisioningProvider options={options}>
      <MakerProbe />
    </ProvisioningProvider>
  </AppStore>
);
async function mountMaker(options: ProvisioningProviderOptions, open = true) {
  let tree!: Renderer.ReactTestRenderer;
  makerFormOpen = open;
  await act(async () => {
    tree = Renderer.create(makerTree(options));
  });
  trees.push(tree);
  return tree;
}
async function openMakerForm(
  tree: Renderer.ReactTestRenderer,
  options: ProvisioningProviderOptions,
) {
  makerFormOpen = true;
  await act(async () => {
    tree.update(makerTree(options));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}
const remount = async () => {
  await act(async () => {
    trees.forEach(t => t.unmount());
  });
  trees = [];
};
const byId = (tree: Renderer.ReactTestRenderer, testID: string) =>
  tree.root.findAll(n => n.props.testID === testID)[0];

test('a profile an earlier build saved has no maker: the app asks for it and installs nothing', async () => {
  const f = fixture();
  const runCard = jest.fn(async () => 'interrupted' as const);
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makerStorageWith(null),
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'no-maker'});
  expect(flow.makerSaved).toBe(false);
  expect(text(tree)).toContain(GATE_WORDS.none);
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
    expect(await flow.startAndRead(config)).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
});

const OTHER = {name: 'Island Cards', tagAddress: 'https://cards.islandbitcoin.com/c'};
const stored = (f: ReturnType<typeof fixture>) => JSON.parse(f.bytes()!);
type TapOptionsSeen = Parameters<
  NonNullable<ProvisioningProviderOptions['runCard']>
>[2];

test('a batch left open by an earlier build installs no card until the maker is set, then takes that address and keeps it', async () => {
  const f = fixture();
  const seen: TapOptionsSeen[] = [];
  const runCard = jest.fn(async (_w, _service, options: TapOptionsSeen) => {
    seen.push(options);
    return 'interrupted' as const;
  });
  await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makerStorageWith(FOXY),
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  // this build writes the maker into the batch record on the phone
  expect(stored(f).batch.maker).toEqual({
    name: FOXY.name,
    tag_address: FOXY.tagAddress,
  });
  await remount();
  // the earlier build: its batch record holds no maker
  const earlier = stored(f);
  delete earlier.batch.maker;
  await f.storage.replace(JSON.stringify(earlier));
  // this build, from the shared repository: the batch is there, the maker is not
  const makers = makerStorageWith(null);
  const tree = await mount({
    ...f,
    // the app starts again and reads the record from the phone
    storage: {read: f.storage.read, replace: f.storage.replace},
    hardwareValidated: true,
    makerStorage: makers,
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  expect(flow.snapshot?.batch).toBeTruthy();
  expect(flow.snapshot?.batch).not.toHaveProperty('maker');
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'no-maker'});
  expect(text(tree)).toContain(GATE_WORDS.none);
  expect(byId(tree, 'real-program').props.disabled).toBe(true);
  await act(async () => {
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
  // a first maker may be set with the batch open; the batch takes its address at the first install
  await act(async () => {
    expect(await flow.saveMaker(OTHER.name, OTHER.tagAddress)).toBeNull();
  });
  expect(flow.batchMakerProblem).toBeNull();
  await act(async () => {
    await flow.program();
  });
  expect(runCard).toHaveBeenCalledTimes(1);
  expect(seen[0].maker).toEqual(OTHER);
  expect(stored(f).batch.maker).toEqual({
    name: OTHER.name,
    tag_address: OTHER.tagAddress,
  });
  // and from then on the batch keeps it
  await act(async () => {
    expect(await flow.saveMaker(FOXY.name, FOXY.tagAddress)).toBe(
      MAKER_SETTING.batchLocked,
    );
  });
  expect(makers.saved.get('https://ops.test')).toBe(encodeSavedMaker(OTHER));
});

test('two operators on one ops service: a batch is not installed with the address another operator saved', async () => {
  const f = fixture();
  const makers = makerStorageWith(FOXY);
  const seen: TapOptionsSeen[] = [];
  const runCard = jest.fn(async (_w, _service, options: TapOptionsSeen) => {
    seen.push(options);
    return 'interrupted' as const;
  });
  const options = {
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    runCard,
    serviceFor: () => f.service,
  };
  // operator 7 opens a batch with Foxy's address and signs out
  await mount(options);
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  await remount();
  // another operator on the same service, who has no batch (a workspace of
  // their own), saves another address: the maker is kept per ops service
  makers.saved.set('https://ops.test', encodeSavedMaker(OTHER));
  // operator 7 signs in again
  const tree = await mount(options);
  await signIn();
  expect(flow.installGate).toMatchObject({allowed: true, maker: OTHER});
  const words = batchMakerDiffers(FOXY);
  expect(words).toContain(FOXY.tagAddress);
  expect(words).toMatch(/Close this batch, or set the card maker back/);
  expect(words).not.toMatch(/—/);
  expect(flow.batchMakerProblem).toBe(words);
  expect(text(tree)).toContain(words);
  expect(text(tree)).not.toContain(MAKER_SETTING.openBatchNote);
  expect(byId(tree, 'real-program').props.disabled).toBe(true);
  // the install step itself refuses, whatever the screen allows
  await act(async () => {
    await flow.program();
  });
  expect(runCard).not.toHaveBeenCalled();
  expect(f.service.reserve).not.toHaveBeenCalled();
  expect(flow.notice).toBe(words);
  expect(stored(f).batch.maker.tag_address).toBe(FOXY.tagAddress);
  // setting the maker back is allowed with the batch open, and the batch goes on with its own address
  await act(async () => {
    expect(await flow.saveMaker(FOXY.name, FOXY.tagAddress)).toBeNull();
  });
  expect(flow.batchMakerProblem).toBeNull();
  expect(text(tree)).toContain(MAKER_SETTING.openBatchNote);
  await act(async () => {
    await flow.program();
  });
  expect(runCard).toHaveBeenCalledTimes(1);
  expect(seen[0].maker).toEqual(FOXY);
});

test('the setting becomes unreadable while a batch is open: no other address is accepted for that batch', async () => {
  const f = fixture();
  const makers = makerStorageWith(FOXY);
  const runCard = jest.fn(async () => 'interrupted' as const);
  await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  await remount();
  const write = jest.fn(makers.write);
  await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: {read: async () => 'not json', write},
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  expect(flow.snapshot?.batch).toBeTruthy();
  expect(flow.installGate).toMatchObject({
    allowed: false,
    reason: 'maker-unread',
  });
  await act(async () => {
    expect(await flow.program()).toBe(false);
    // the gate is closed, and the batch still keeps its address
    expect(await flow.saveMaker(OTHER.name, OTHER.tagAddress)).toBe(
      MAKER_SETTING.batchLocked,
    );
  });
  expect(write).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
  // the batch's own address may be set again
  await act(async () => {
    expect(await flow.saveMaker(FOXY.name, FOXY.tagAddress)).toBeNull();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(flow.installGate).toMatchObject({allowed: true, maker: FOXY});
  await act(async () => {
    await flow.program();
  });
  expect(runCard).toHaveBeenCalledTimes(1);
});

test("one ops service's maker is never another's: after a switch nothing installs until that service has its own", async () => {
  const f = fixture();
  // a maker saved for https://ops.test only
  const makers = makerStorageWith(null);
  makers.saved.set('https://ops.test', encodeSavedMaker(FOXY));
  const runCard = jest.fn(async () => 'interrupted' as const);
  const gates: {origin: string; gate: InstallGate}[] = [];
  function GateProbe() {
    app = useApp();
    flow = useProvisioning();
    gates.push({origin: app.serviceUrl, gate: flow.installGate});
    return null;
  }
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore
        clientOptions={{baseUrl: 'https://ops.test'}}
        serviceStorage={{
          read: async () => null,
          write: async () => undefined,
        }}>
        <ProvisioningProvider
          options={{
            ...f,
            hardwareValidated: true,
            makerStorage: makers,
            runCard,
            serviceFor: () => f.service,
          }}>
          <GateProbe />
        </ProvisioningProvider>
      </AppStore>,
    );
  });
  trees.push(tree);
  expect(app.serviceUrl).toBe('https://ops.test');
  expect(flow.installGate).toMatchObject({allowed: true, maker: FOXY});
  await act(async () => {
    await app.selectService('https://issuer.example.com');
  });
  expect(app.serviceUrl).toBe('https://issuer.example.com');
  const after = gates.filter(g => g.origin === 'https://issuer.example.com');
  expect(after.length).toBeGreaterThanOrEqual(2);
  // never open, from the first render with the other service on
  expect(after.filter(g => g.gate.allowed)).toEqual([]);
  expect(after[0].gate).toMatchObject({reason: 'maker-reading'});
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'no-maker'});
  expect(flow.savedMaker).toBeNull();
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
    expect(await flow.startAndRead(config)).toBe(false);
    expect(await flow.program()).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(runCard).not.toHaveBeenCalled();
});

test('the maker is not saved while a card is being worked on', async () => {
  const f = fixture();
  const makers = makerStorageWith(null);
  makers.saved.set('https://ops.test', encodeSavedMaker(FOXY));
  const write = jest.spyOn(makers, 'write');
  const card = deferred<'interrupted'>();
  const runCard = jest.fn(() => card.promise);
  await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  let run!: Promise<boolean>;
  await act(async () => {
    run = flow.program();
    for (let i = 0; i < 20 && !runCard.mock.calls.length; i++) {
      await new Promise(done => setTimeout(done, 0));
    }
  });
  expect(runCard).toHaveBeenCalledTimes(1);
  expect(flow.busy).toBe(true);
  // the same tag address under another name: only the card work stands in the way
  await act(async () => {
    expect(await flow.saveMaker('Foxy Cards', FOXY.tagAddress)).toBe(
      'Wait for the current card work to finish, then save.',
    );
  });
  expect(write).not.toHaveBeenCalled();
  await act(async () => {
    card.resolve('interrupted');
    await run;
  });
  await act(async () => {
    expect(await flow.saveMaker('Foxy Cards', FOXY.tagAddress)).toBeNull();
  });
  expect(write).toHaveBeenCalledTimes(1);
});

test('while the setting is being read the gate is closed and says nothing of a failed read; a save is not undone by a late read', async () => {
  const f = fixture();
  const read = deferred<string | null>();
  const makers = makerStorageWith(null);
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: {read: () => read.promise, write: makers.write},
    serviceFor: () => f.service,
  });
  await signIn();
  expect(flow.installGate).toEqual({
    allowed: false,
    reason: 'maker-reading',
    problem: '',
  });
  expect(text(tree)).not.toContain(GATE_WORDS.unread);
  expect(text(tree)).not.toContain(GATE_WORDS.none);
  expect(tree.root.findAll(n => n.props.testID === 'install-gate')).toEqual([]);
  expect(tree.root.findAll(n => n.props.testID === 'open-maker')).toEqual([]);
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  // a save lands before the read answers
  await act(async () => {
    expect(await flow.saveMaker(FOXY.name, FOXY.tagAddress)).toBeNull();
  });
  expect(flow.installGate).toMatchObject({allowed: true, maker: FOXY});
  // the read answers late with what the phone held before: the saved maker stays
  await act(async () => {
    read.resolve(null);
    await read.promise;
  });
  expect(flow.installGate).toMatchObject({allowed: true, maker: FOXY});
  expect(flow.savedMaker).toEqual(FOXY);
  await remount();
  // with no save in between, the read's answer is taken
  const g = fixture();
  const second = deferred<string | null>();
  const tree2 = await mount({
    ...g,
    hardwareValidated: true,
    makerStorage: {read: () => second.promise, write: makers.write},
    serviceFor: () => g.service,
  });
  await signIn();
  expect(flow.installGate).toMatchObject({reason: 'maker-reading'});
  await act(async () => {
    second.resolve(null);
    await second.promise;
  });
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'no-maker'});
  expect(text(tree2)).toContain(GATE_WORDS.none);
});

test('the saved maker opens the gate, the batch screen shows it, and the tap installs with exactly that address', async () => {
  const f = fixture();
  const makers = makerStorageWith(null);
  let tapOptions:
    | Parameters<NonNullable<ProvisioningProviderOptions['runCard']>>[2]
    | undefined;
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    _w,
    _service,
    options,
  ) => {
    tapOptions = options;
    return 'interrupted';
  };
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    runCard,
    serviceFor: () => f.service,
  });
  await signIn();
  // refused values change nothing
  for (const [name, address] of [
    ['Foxy', 'https://example.com/card'],
    ['Foxy', 'http://getfoxy.io/card'],
    ['Example card maker', FOXY.tagAddress],
    ['', FOXY.tagAddress],
  ]) {
    await act(async () => {
      expect(await flow.saveMaker(name, address)).toEqual(expect.any(String));
    });
  }
  expect(makers.saved.size).toBe(0);
  expect(flow.installGate.allowed).toBe(false);
  await act(async () => {
    expect(await flow.saveMaker(' Foxy ', ` ${FOXY.tagAddress} `)).toBeNull();
  });
  // one maker per ops service, under a cashu.provisioner.* key
  expect([...makers.saved]).toEqual([
    ['https://ops.test', encodeSavedMaker(FOXY)],
  ]);
  expect(flow.installGate).toMatchObject({allowed: true, maker: FOXY});
  // the batch form shows the maker and the address before any card is installed
  expect(byId(tree, 'maker-summary-name').props.children).toBe('Foxy');
  expect(byId(tree, 'maker-summary-address').props.children).toBe(
    FOXY.tagAddress,
  );
  expect(text(tree)).toContain(MAKER_SETTING.batchNote);
  expect(f.service.batch).not.toHaveBeenCalled();
  await act(async () => {
    expect(await flow.create(config)).toBe(true);
  });
  // the open batch shows it again beside the install button, and says how to change it
  expect(byId(tree, 'maker-summary-address').props.children).toBe(
    FOXY.tagAddress,
  );
  expect(text(tree)).toContain(MAKER_SETTING.openBatchNote);
  expect(text(tree)).not.toContain(MAKER_SETTING.batchNote);
  expect(MAKER_SETTING.openBatchNote).toMatch(/close this batch first/);
  expect(MAKER_SETTING.openBatchNote).not.toMatch(/open Settings/);
  // with a batch open the maker is not changed in passing
  await act(async () => {
    expect(
      await flow.saveMaker('Foxy', 'https://getfoxy.io/other'),
    ).toMatch(/Close the open batch/);
  });
  expect(makers.saved.get('https://ops.test')).toBe(encodeSavedMaker(FOXY));
  await act(async () => {
    await flow.program();
  });
  expect(tapOptions?.maker).toEqual(FOXY);
  expect(tapOptions?.maker).toBe(
    flow.installGate.allowed ? flow.installGate.maker : null,
  );
});

test("a fork's maker file pre-fills the form and installs nothing until it is saved; an unreadable setting installs nothing even then", async () => {
  const f = fixture();
  const makers = makerStorageWith(null);
  const idleCard = jest.fn(async () => 'interrupted' as const);
  const form = await mountMaker({
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    makerFile: FORK_FILE,
    runCard: idleCard,
    serviceFor: () => f.service,
  });
  await signIn();
  // the file opens no gate
  expect(flow.installGate).toEqual({
    allowed: false,
    reason: 'no-maker',
    problem: GATE_WORDS.none,
  });
  expect(flow.makerSaved).toBe(false);
  expect(flow.savedMaker).toBeNull();
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
    expect(await flow.startAndRead(config)).toBe(false);
  });
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(idleCard).not.toHaveBeenCalled();
  // it fills the form in, says so, and Settings still shows no maker
  expect(flow.makerPrefill).toEqual({
    name: FORK_FILE.name,
    tagAddress: FORK_FILE.tagAddress,
  });
  expect(byId(form, 'maker-name').props.value).toBe(FORK_FILE.name);
  expect(byId(form, 'maker-address').props.value).toBe(FORK_FILE.tagAddress);
  expect(text(form)).toContain(MAKER_SETTING.fromFile);
  expect(MAKER_SETTING.fromFile).toMatch(/No card is installed until you save it/);
  expect(byId(form, 'settings-maker-name').props.children).toBe(
    MAKER_SETTING.notSet,
  );
  expect(makers.saved.size).toBe(0);
  // saving it is one press, and only then is the gate open
  await act(async () => {
    await byId(form, 'maker-save').props.onPress();
  });
  expect(byId(form, 'maker-notice').props.children).toBe(MAKER_SETTING.saved);
  expect(makers.saved.get('https://ops.test')).toBe(
    encodeSavedMaker({name: FORK_FILE.name, tagAddress: FORK_FILE.tagAddress}),
  );
  expect(flow.installGate).toMatchObject({
    allowed: true,
    maker: {name: FORK_FILE.name, tagAddress: FORK_FILE.tagAddress},
  });
  expect(text(form)).not.toContain(MAKER_SETTING.fromFile);
  await remount();
  for (const read of [
    async () => '{"schema":1,"name":"Foxy"}',
    async () => {
      throw new Error('disk unavailable');
    },
  ]) {
    const g = fixture();
    const runCard = jest.fn(async () => 'interrupted' as const);
    const tree = await mount({
      ...g,
      hardwareValidated: true,
      makerStorage: {read, write: async () => undefined},
      makerFile: FORK_FILE,
      runCard,
      serviceFor: () => g.service,
    });
    await signIn();
    expect(flow.installGate).toMatchObject({
      allowed: false,
      reason: 'maker-unread',
    });
    expect(text(tree)).toContain(GATE_WORDS.unread);
    await act(async () => {
      expect(await flow.create(config)).toBe(false);
    });
    expect(g.service.batch).not.toHaveBeenCalled();
  }
});

test('the build half of the gate still closes installation with a maker saved', async () => {
  const f = fixture();
  const tree = await mount({
    ...f,
    hardwareValidated: false,
    makerStorage: makerStorageWith(),
    serviceFor: () => f.service,
  });
  await signIn();
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'load-file'});
  expect(text(tree)).toContain(GATE_WORDS.loadFile);
  expect(tree.root.findAll(n => n.props.testID === 'open-maker')).toEqual([]);
  await act(async () => {
    expect(await flow.create(config)).toBe(false);
  });
});

test('the maker screen explains the tag address, saves a first maker, and changes a saved one only after a second step', async () => {
  const f = fixture();
  const makers = makerStorageWith(null);
  const tree = await mountMaker({
    ...f,
    hardwareValidated: true,
    makerStorage: makers,
    serviceFor: () => f.service,
  });
  await signIn();
  const words = text(tree);
  for (const line of [
    MAKER_SETTING.what,
    MAKER_SETTING.tagWhat,
    MAKER_SETTING.published,
    MAKER_SETTING.scope,
  ]) {
    expect(words).toContain(line);
    expect(line).not.toMatch(/—/);
  }
  expect(MAKER_SETTING.published).toMatch(/card maker publishes this address/);
  expect(byId(tree, 'settings-maker-name').props.children).toBe(
    MAKER_SETTING.notSet,
  );
  // nothing is pre-filled from the shared repository's example
  expect(byId(tree, 'maker-name').props.value).toBe('');
  expect(byId(tree, 'maker-address').props.value).toBe('');
  const type = async (name: string, address: string) => {
    await act(async () => {
      byId(tree, 'maker-name').props.onChangeText(name);
      byId(tree, 'maker-address').props.onChangeText(address);
    });
  };
  const press = async (testID: string) => {
    await act(async () => {
      await byId(tree, testID).props.onPress();
    });
  };
  await type('Foxy', 'https://example.com/card');
  await press('maker-save');
  expect(byId(tree, 'maker-notice').props.children).toMatch(/example address/);
  expect(makers.saved.size).toBe(0);
  await type('Foxy', FOXY.tagAddress);
  await press('maker-save');
  expect(byId(tree, 'maker-notice').props.children).toBe(MAKER_SETTING.saved);
  expect(makers.saved.get('https://ops.test')).toBe(encodeSavedMaker(FOXY));
  expect(byId(tree, 'settings-maker-name').props.children).toBe('Foxy');
  expect(byId(tree, 'settings-maker-address').props.children).toContain(
    FOXY.tagAddress,
  );
  // a change is reviewed first, and can be dropped
  await type('Foxy', 'https://getfoxy.io/new');
  await press('maker-save');
  expect(makers.saved.get('https://ops.test')).toBe(encodeSavedMaker(FOXY));
  expect(text(tree)).toContain(MAKER_SETTING.changeNote);
  expect(byId(tree, 'maker-review-address').props.children).toBe(
    'https://getfoxy.io/new',
  );
  await press('maker-keep');
  expect(makers.saved.get('https://ops.test')).toBe(encodeSavedMaker(FOXY));
  await press('maker-save');
  await press('maker-confirm');
  expect(makers.saved.get('https://ops.test')).toBe(
    encodeSavedMaker({name: 'Foxy', tagAddress: 'https://getfoxy.io/new'}),
  );
  expect(TEST_MAKER.tagAddress).not.toBe(FOXY.tagAddress);
});

test('Settings and the maker form show the saved maker when the gate is closed for another reason', async () => {
  const f = fixture();
  const options = {
    ...f,
    hardwareValidated: false,
    makerStorage: makerStorageWith(FOXY),
    serviceFor: () => f.service,
  };
  const tree = await mountMaker(options, false);
  await signIn();
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'load-file'});
  expect(flow.savedMaker).toEqual(FOXY);
  expect(byId(tree, 'settings-maker-name').props.children).toBe('Foxy');
  expect(byId(tree, 'settings-maker-address').props.children).toContain(
    FOXY.tagAddress,
  );
  await openMakerForm(tree, options);
  expect(byId(tree, 'maker-name').props.value).toBe('Foxy');
  expect(byId(tree, 'maker-address').props.value).toBe(FOXY.tagAddress);
  // saved already and unchanged: nothing to save
  expect(byId(tree, 'maker-save').props.disabled).toBe(true);
  await remount();
  // a saved maker that breaks a rule is shown too, so it can be put right
  const g = fixture();
  const broken = {name: 'Foxy', tagAddress: 'https://example.com/card'};
  const brokenOptions = {
    ...g,
    hardwareValidated: true,
    makerStorage: makerStorageWith(broken),
    serviceFor: () => g.service,
  };
  const tree2 = await mountMaker(brokenOptions, false);
  await signIn();
  expect(flow.installGate).toMatchObject({allowed: false, reason: 'bad-maker'});
  expect(byId(tree2, 'settings-maker-address').props.children).toContain(
    broken.tagAddress,
  );
  await openMakerForm(tree2, brokenOptions);
  expect(byId(tree2, 'maker-address').props.value).toBe(broken.tagAddress);
});

test('the card picture starts empty for the second card of a batch and fills again with its load', async () => {
  const f = fixture();
  const attempts = new Map<string, ReservedAttempt>();
  (f.service.reserve as jest.Mock).mockImplementation(async request => {
    const made: ReservedAttempt = {
      ...request,
      operator_id: 7,
      revision: 0,
      state: 'active',
      chip_id: null,
      completion_receipt: null,
    };
    attempts.set(request.attempt_id, made);
    ((await f.service.batch({} as never)) as RemoteBatch).next_ordinal =
      request.ordinal + 1;
    return {...made};
  });
  (f.service.attempt as jest.Mock).mockImplementation(async (_d, id) => ({
    ...attempts.get(id)!,
  }));
  (f.service.record as jest.Mock).mockImplementation(
    async (_d, attempt_id, revision) => ({
      attempt_id,
      installation_id: `02${String(cards).repeat(64)}`,
      revision,
      recorded_at: 1,
      verified_stage: 'rotated',
      ready_for_holder: false,
    }),
  );
  let hold!: () => void;
  const held = new Promise<void>(resolve => {
    hold = resolve;
  });
  let atBlock!: () => void;
  const reached = new Promise<void>(resolve => {
    atBlock = resolve;
  });
  let cards = 0;
  const runCard: NonNullable<ProvisioningProviderOptions['runCard']> = async (
    w,
    service,
    options,
  ) => {
    const ordinal = cards++;
    options.onEvent?.({type: 'block', index: 10, of: 20});
    if (ordinal === 1) {
      atBlock();
      await held;
    }
    await w.withAttempt(service, async j => {
      await j.bind(`cplc-v1:4790d32131800729762075${ordinal}1`);
      Object.assign(attempts.get(j.snapshot().attempt_id)!, {chip_id: j.snapshot().chip_id, revision: 1});
      await j.installIntent({installation_id: null, replacement_consent: false});
      await j.installed(`02${String(ordinal + 1).repeat(64)}`, {complete: true});
      await j.rotationIntent();
      await j.rotated(1);
      const at = j.snapshot();
      await j.freezeRecord({
        attempt_id: at.attempt_id,
        batch_id: at.batch_id,
        ordinal: at.ordinal,
        load_sha256: at.load_sha256,
        operator_id: at.operator_id,
        device_id: at.device_id,
        key_env: at.key_env,
        chip_id: at.chip_id!,
        installation_id: at.installation_id!,
        display_id: at.installation_id!.slice(-4),
        gp_key_version: 1,
        configuration_revision: 1,
        verified_stage: 'rotated',
        verified_at: 1,
      });
    });
    await w.postRecord(service);
    return 'recorded' as never;
  };
  const tree = await mount({
    ...f,
    hardwareValidated: true,
    makerStorage: makerStorageWith(),
    serviceFor: () => f.service,
    runCard,
  });
  await signIn();
  await act(async () => {
    await flow.create(config);
    await flow.program();
  });
  expect(flow.snapshot!.history).toHaveLength(1);
  expect(flow.snapshot!.active).toBeNull();
  expect(tree.root.findByType(CardFigure).props.fill).toBe(1);
  let second!: Promise<boolean>;
  await act(async () => {
    second = flow.program();
    await reached;
  });
  // halfway through the second card the picture is half written, not full
  expect(tree.root.findByType(CardFigure).props.fill).toBe(0.5);
  await act(async () => {
    hold();
    await second;
  });
  expect(tree.root.findByType(CardFigure).props.fill).toBe(1);
});
