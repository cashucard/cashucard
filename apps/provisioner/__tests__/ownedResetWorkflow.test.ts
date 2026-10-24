import {
  OwnedResetWorkflow,
  type OwnedResetService,
} from '../src/ownedResetWorkflow';
import type {ResetReview} from '../src/cardkit';
import type {JournalStorage} from '../src/journal';
import {FakeCard} from '@cashu-card/cardkit/testing';
import {
  FACTORY_KEYS,
  SPIKE_KEYS,
  CASHU_PLAN,
  provision,
  rotateKeys,
  toHex,
  fromHex,
  readResetReview,
} from '../src/cardkit';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const scope = {
  service_origin: 'https://api.example.test',
  operator_id: 1,
  key_env: 'issued' as const,
};
const review: ResetReview = {
  chipId: 'cplc-v1:4790d3213041093363205547',
  installationId:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  unspent: 0,
  spent: 0,
  owner: true,
  pin: true,
  pinBlocked: false,
  tries: 3,
  locked: false,
  record: true,
  tag: true,
  sealed: true,
  mint: 'https://mint.example.test',
  recordDigest: 'ab'.repeat(32),
};
function fixture() {
  let raw: string | null = null;
  const storage: JournalStorage = {
    read: async () => raw,
    replace: async v => {
      raw = v;
    },
  };
  const receipt = {
    reset_id: uuid(2),
    source_attempt_id: uuid(3),
    chip_id: review.chipId,
    installation_id: review.installationId,
    operator_id: 1,
    device_id: uuid(1),
    authorized_at: 10,
  };
  const service: OwnedResetService = {
    scope,
    lookup: jest.fn(async () => ({
      can_reset: true,
      lookup: {
        status: 'found',
        source: {attemptId: uuid(3), keySourceRef: `escrow:${uuid(3)}`},
      },
    })),
    authorize: jest.fn(async () => receipt),
    keys: jest.fn(async () => ({
      reset_id: uuid(2),
      chip_id: review.chipId,
      installation_id: review.installationId,
      enc: '10'.repeat(16),
      mac: '20'.repeat(16),
      dek: '30'.repeat(16),
    })),
    complete: jest.fn(async () => ({
      reset_id: uuid(2),
      chip_id: review.chipId,
      removed_installation_id: review.installationId,
      operator_id: 1,
      device_id: uuid(1),
      completed_at: 20,
      manager_keys: 'factory' as const,
      cashu_package: 'absent' as const,
    })),
  };
  return {storage, service, raw: () => raw};
}
test('wrong actor, retained value and unsupported provenance stop before intent, key fetch or a card connection', async () => {
  for (const mode of ['actor', 'funds', 'source']) {
    const f = fixture();
    if (mode === 'source') {
      f.service.lookup = jest.fn(async () => ({
        can_reset: false,
        lookup: {status: 'missing'},
      }));
    }
    const w = await OwnedResetWorkflow.open(f.storage);
    await expect(
      w.begin(
        f.service,
        uuid(1),
        uuid(2),
        mode === 'funds' ? {...review, unspent: 1} : review,
        {erase: true, valueHandled: mode !== 'actor'},
      ),
    ).rejects.toThrow();
    expect(f.raw()).toBeNull();
    expect(f.service.authorize).not.toHaveBeenCalled();
    expect(f.service.keys).not.toHaveBeenCalled();
  }
});
test('reset persists each boundary, then replays frozen completion after a lost reply without card work or keys', async () => {
  const f = fixture();
  const w = await OwnedResetWorkflow.open(f.storage);
  await w.begin(f.service, uuid(1), uuid(2), review, {
    erase: true,
    valueHandled: true,
  });
  const runner = jest.fn(async (_tx: any, o: any) => {
    expect(JSON.parse(f.raw()!).journal.stage).toBe('reviewed');
    for (const stage of [
      'delete_intent',
      'deletion_observed',
      'rotation_intent',
      'factory_verified',
    ]) {
      await o.persist(
        stage,
        stage === 'factory_verified' ? {keyVersion: 1} : undefined,
      );
    }
    return {ok: true, stage: 'factory_verified' as const, keyVersion: 1};
  });
  const withCard = jest.fn(async (run: any) => run(jest.fn()));
  const options = {
    withCard,
    random: (n: number) => new Array(n).fill(1),
    now: () => 10,
    canContinue: () => true,
    runReset: runner,
  };
  (f.service.complete as jest.Mock).mockRejectedValueOnce(
    new Error('lost reply'),
  );
  await expect(w.continue(f.service, options)).rejects.toThrow();
  expect(w.snapshot()!.journal.stage).toBe('factory_verified');
  const record = (f.service.complete as jest.Mock).mock.calls[0][2];
  const reopened = await OwnedResetWorkflow.open(f.storage);
  await reopened.continue(f.service, {...options, now: () => 999});
  expect(withCard).toHaveBeenCalledTimes(1);
  expect(f.service.keys).toHaveBeenCalledTimes(1);
  expect((f.service.complete as jest.Mock).mock.calls[1][2]).toEqual(record);
  expect(reopened.snapshot()!.journal.stage).toBe('complete');
  expect(f.raw()).not.toContain('10101010');
});
test('another session/service and untrusted returned keys cannot operate a retained reset', async () => {
  const f = fixture();
  const w = await OwnedResetWorkflow.open(f.storage);
  await w.begin(f.service, uuid(1), uuid(2), review, {
    erase: true,
    valueHandled: true,
  });
  const withCard = jest.fn();
  await expect(
    w.continue(
      {...f.service, scope: {...scope, operator_id: 2}},
      {withCard, random: () => [], now: () => 0, canContinue: () => true},
    ),
  ).rejects.toThrow();
  expect(f.service.authorize).not.toHaveBeenCalled();
  (f.service.keys as jest.Mock).mockResolvedValueOnce({reset_id: uuid(9)});
  await expect(
    w.continue(f.service, {
      withCard,
      random: () => [],
      now: () => 0,
      canContinue: () => true,
    }),
  ).rejects.toThrow();
  expect(withCard).not.toHaveBeenCalled();
  expect(w.snapshot()!.journal.stage).toBe('reviewed');
});

test('the mobile coordinator runs the real reset engine and leaves the fake card installable with factory keys', async () => {
  const f = fixture(),
    card = new FakeCard();
  const options = {random: (n: number) => new Array(n).fill(7), now: () => 0};
  expect(
    (
      await provision(card.transceive, CASHU_PLAN, {
        ...options,
        keys: FACTORY_KEYS,
      })
    ).ok,
  ).toBe(true);
  expect(
    (await rotateKeys(card.transceive, FACTORY_KEYS, SPIKE_KEYS, options)).ok,
  ).toBe(true);
  card.setCardState({owner: 1, pin: 1, record: 1});
  card.reset();
  const record = new Array(109 + review.mint.length).fill(0);
  record[0] = 4;
  record[1] = 1;
  record[105] = review.mint.length;
  Array.from(review.mint, c => c.charCodeAt(0)).forEach((b, i) => {
    record[106 + i] = b;
  });
  const tx = async (a: number[]) =>
    a[0] === 0xb0 && a[1] === 0x16
      ? [...record, 0x90, 0]
      : a[0] === 0xb0 && a[1] === 0x10
      ? [...fromHex(review.installationId), 0x90, 0]
      : card.transceive(a);
  const observed = await readResetReview(tx);
  (f.service.keys as jest.Mock).mockResolvedValue({
    reset_id: uuid(2),
    chip_id: review.chipId,
    installation_id: review.installationId,
    enc: toHex(SPIKE_KEYS.enc).toLowerCase(),
    mac: toHex(SPIKE_KEYS.mac).toLowerCase(),
    dek: toHex(SPIKE_KEYS.dek).toLowerCase(),
  });
  const w = await OwnedResetWorkflow.open(f.storage);
  await w.begin(f.service, uuid(1), uuid(2), observed, {
    erase: true,
    valueHandled: true,
  });
  await expect(
    w.continue(f.service, {
      random: options.random,
      now: () => 10,
      canContinue: () => true,
      withCard: async run => {
        card.reset();
        return run(tx);
      },
    }),
  ).resolves.toBe('complete');
  expect(card.instances.size).toBe(0);
  expect(card.failedAuths).toBe(0);
  card.reset();
  expect(
    (
      await provision(card.transceive, CASHU_PLAN, {
        ...options,
        keys: FACTORY_KEYS,
      })
    ).ok,
  ).toBe(true);
  expect(
    (await rotateKeys(card.transceive, FACTORY_KEYS, SPIKE_KEYS, options)).ok,
  ).toBe(true);
  expect(card.failedAuths).toBe(0);
});
