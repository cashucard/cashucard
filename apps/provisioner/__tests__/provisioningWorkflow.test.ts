import {
  ProvisioningWorkflow,
  type ReservationService,
  type RemoteBatch,
  type ReservedAttempt,
  type BatchSettings,
} from '../src/provisioningWorkflow';
import {ApiServiceError} from '../src/api';
import type {
  CompletionRecord,
  CompletionReceipt,
  JournalStorage,
} from '../src/journal';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const config: BatchSettings = {
  count: 2,
  mint_url: 'https://mint.test',
  pin_policy: 'perCard',
  daily_usd: 25,
  no_pin_usd: 5,
  load_sha256: 'ab'.repeat(32),
};
const chip = 'cplc-v1:4790d3213180072976207515';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture() {
  let bytes: string | null = null;
  let ids = 0;
  const flags = {
    batchLost: false,
    attemptLost: false,
    missing: false,
    commitLost: false,
    archiveLost: false,
  };
  const storage: JournalStorage = {
    read: jest.fn(async () => bytes),
    replace: jest.fn(async value => {
      bytes = value;
      if (
        flags.commitLost ||
        (flags.archiveLost && JSON.parse(value).history.length)
      ) {
        flags.commitLost = flags.archiveLost = false;
        throw new Error('commit acknowledgement lost');
      }
    }),
  };
  let batch: RemoteBatch | null = null;
  let attempt: ReservedAttempt | null = null;
  const service: ReservationService = {
    scope: {
      service_origin: 'https://ops.test',
      operator_id: 7,
      key_env: 'issued',
    },
    batch: jest.fn(async request => {
      batch ??= {
        batch_id: 42,
        batch_request_id: request.batch_request_id,
        operator_id: 7,
        device_id: request.device_id,
        next_ordinal: 0,
        config: {...config, key_env: 'issued', configuration_revision: 1},
      };
      if (flags.batchLost) {
        flags.batchLost = false;
        throw new Error('reply lost');
      }
      return copy(batch);
    }),
    reserve: jest.fn(async request => {
      if (!attempt || attempt.attempt_id !== request.attempt_id) {
        attempt = {
          ...request,
          operator_id: 7,
          revision: 0,
          state: 'active',
          chip_id: null,
          completion_receipt: null,
        };
        batch!.next_ordinal++;
      }
      if (flags.attemptLost) {
        flags.attemptLost = false;
        throw new Error('reply lost');
      }
      return copy(attempt);
    }),
    attempt: jest.fn(async () => {
      if (flags.missing) {
        throw new ApiServiceError('not-found', 404);
      }
      return copy(attempt!);
    }),
  };
  return {
    storage,
    service,
    flags,
    newId: () => uuid(++ids),
    remote: () => attempt!,
    ids: () => ids,
  };
}

test('lost batch and reservation acknowledgements restart with exactly the original IDs and ordinal', async () => {
  const f = fixture();
  let w = await ProvisioningWorkflow.open(f.storage, f.newId);
  f.flags.batchLost = true;
  await expect(w.start(f.service, config)).rejects.toThrow('reply lost');
  const request = w.snapshot().batch!.request;
  w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await w.reconcile(f.service);
  expect(w.snapshot().batch!.request).toEqual(request);
  f.flags.attemptLost = true;
  await expect(w.reserveNext(f.service)).rejects.toThrow('reply lost');
  const pending = w.snapshot().active!;
  expect(pending.revision).toBeNull();
  w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await w.reconcile(f.service);
  expect(w.snapshot().active).toMatchObject({
    attempt_id: pending.attempt_id,
    ordinal: 0,
    revision: 0,
  });
  expect(w.snapshot().batch!.next_ordinal).toBe(0); // Advance only after receipt, not reservation.
  expect(f.ids()).toBe(3); // Device, batch request, attempt: reopening never generates another.
  expect(f.service.reserve).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({attempt_id: pending.attempt_id, ordinal: 0}),
  );
  expect(f.service.reserve).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({attempt_id: pending.attempt_id, ordinal: 0}),
  );
});

test('a commit failure prevents the dependent POST and ambiguous committed state is recovered on reopening', async () => {
  const f = fixture();
  const w = await ProvisioningWorkflow.open(f.storage, f.newId);
  f.flags.commitLost = true;
  await expect(w.start(f.service, config)).rejects.toThrow(
    'commit acknowledgement lost',
  );
  expect(f.service.batch).not.toHaveBeenCalled();
  expect(() => w.snapshot()).toThrow();
  const reopened = await ProvisioningWorkflow.open(f.storage, f.newId);
  const request = reopened.snapshot().batch!.request;
  await reopened.reconcile(f.service);
  expect(f.service.batch).toHaveBeenCalledWith(request);
  expect(f.ids()).toBe(2);
});

test('foreign scope, a missing acknowledged attempt, and failed reads never recreate identities', async () => {
  const f = fixture();
  const w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await w.start(f.service, config);
  await w.reserveNext(f.service);
  const before = w.snapshot();
  for (const scope of [
    {operator_id: 8},
    {service_origin: 'https://other.test'},
    {key_env: 'factory' as const},
  ]) {
    await expect(
      w.reconcile({...f.service, scope: {...f.service.scope, ...scope}}),
    ).rejects.toThrow('reconciliation');
  }
  expect(f.service.batch).toHaveBeenCalledTimes(1);
  f.flags.missing = true;
  await expect(w.reconcile(f.service)).rejects.toMatchObject({status: 404});
  expect(f.service.reserve).toHaveBeenCalledTimes(1);
  expect(w.snapshot().active).toEqual(before.active);
  f.storage.read = async () => {
    throw new Error('disk unavailable');
  };
  await expect(ProvisioningWorkflow.open(f.storage, f.newId)).rejects.toThrow(
    'disk unavailable',
  );
  expect(f.ids()).toBe(3);
});

test('terminal receipt and batch advancement commit together, including a lost archive acknowledgement', async () => {
  const f = fixture();
  let w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await w.start(f.service, config);
  await w.reserveNext(f.service);
  f.remote().chip_id = chip;
  f.remote().revision = 1;
  await w.reconcile(f.service);
  const a = w.snapshot().active!;
  const record: CompletionRecord = {
    attempt_id: a.attempt_id,
    batch_id: 42,
    ordinal: 0,
    load_sha256: config.load_sha256,
    operator_id: 7,
    device_id: w.snapshot().device_id,
    chip_id: chip,
    installation_id: key,
    display_id: key.slice(-4),
    gp_key_version: 1,
    key_env: 'issued',
    configuration_revision: 1,
    verified_stage: 'rotated',
    verified_at: 123,
  };
  await w.withAttempt(f.service, async j => {
    await j.installIntent({installation_id: null, replacement_consent: false});
    await j.installed(key, {complete: true});
    await j.rotationIntent();
    await j.rotated();
    await j.freezeRecord(record);
  });
  const frozen = w.snapshot().active!.journal!.frozen_record;
  const receipt: CompletionReceipt = {
    attempt_id: a.attempt_id,
    installation_id: key,
    revision: 2,
    recorded_at: 456,
    verified_stage: 'rotated',
    ready_for_holder: false,
  };
  f.remote().state = 'recorded';
  f.remote().revision = 2;
  f.remote().completion_receipt = receipt;
  await w.reconcile(f.service); // Receipt was already saved before a later retry.
  f.remote().completion_receipt = Object.fromEntries(
    Object.entries(receipt).reverse(),
  ) as unknown as CompletionReceipt;
  f.flags.archiveLost = true;
  await expect(w.advance(f.service)).rejects.toThrow(
    'commit acknowledgement lost',
  );
  w = await ProvisioningWorkflow.open(f.storage, f.newId);
  expect(w.snapshot().active).toBeNull();
  expect(w.snapshot().history).toHaveLength(1);
  expect(w.snapshot().history[0].frozen_record).toBe(frozen);
  expect(JSON.parse(w.snapshot().history[0].completion_receipt!)).toEqual(
    receipt,
  );
  expect(w.snapshot().batch!.next_ordinal).toBe(1);
  await w.reserveNext(f.service);
  expect(w.snapshot().active!.ordinal).toBe(1);
  expect(w.snapshot().history).toHaveLength(1);
  const secondKey = '03' + key.slice(2);
  f.remote().chip_id = chip;
  f.remote().revision = 1;
  await w.reconcile(f.service);
  const secondRecord = {
    ...record,
    attempt_id: w.snapshot().active!.attempt_id,
    ordinal: 1,
    installation_id: secondKey,
  };
  await w.withAttempt(f.service, async j => {
    await j.installIntent({installation_id: key, replacement_consent: true});
    await j.installed(secondKey, {complete: true});
    await j.rotationIntent();
    await j.rotated();
    await j.freezeRecord(secondRecord);
  });
  f.remote().state = 'recorded';
  f.remote().revision = 2;
  f.remote().completion_receipt = {
    ...receipt,
    attempt_id: secondRecord.attempt_id,
    installation_id: secondKey,
  };
  await w.advance(f.service);
  const device = w.snapshot().device_id;
  await w.closeBatch(f.service);
  w = await ProvisioningWorkflow.open(f.storage, f.newId);
  expect(w.snapshot()).toEqual({
    schema: 2,
    device_id: device,
    batch: null,
    active: null,
    history: [],
  });
  expect(await f.storage.read()).not.toMatch(
    /token|password|pin_batch|"enc"|"mac"|"dek"/,
  );
});

test('untrusted settings and unsupported/secret-bearing snapshots stop without network writes', async () => {
  const f = fixture();
  const w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await expect(
    w.start(f.service, {...config, pin_batch: '123456'} as BatchSettings),
  ).rejects.toThrow();
  expect(f.service.batch).not.toHaveBeenCalled();
  await f.storage.replace(JSON.stringify({...w.snapshot(), token: 'secret'}));
  await expect(ProvisioningWorkflow.open(f.storage, f.newId)).rejects.toThrow();
  await f.storage.replace(JSON.stringify({schema: 1}));
  await expect(ProvisioningWorkflow.open(f.storage, f.newId)).rejects.toThrow();
  expect(f.ids()).toBe(1);
});

test('closing a batch cannot hide incomplete work', async () => {
  const f = fixture();
  const w = await ProvisioningWorkflow.open(f.storage, f.newId);
  await w.start(f.service, config);
  await expect(w.closeBatch(f.service)).rejects.toThrow('reconciliation');
  expect(w.snapshot().batch).not.toBeNull();
  await w.reserveNext(f.service);
  await expect(w.closeBatch(f.service)).rejects.toThrow('reconciliation');
  expect(w.snapshot().active).not.toBeNull();
});
