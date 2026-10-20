import {
  ProvisioningJournal,
  recoveryAction,
  type JournalScope,
  type AttemptIdentity,
  type CompletionRecord,
  type JournalStorage,
} from '../src/journal';
const scope: JournalScope = {
  service_origin: 'http://localhost:8821',
  operator_id: 1,
  device_id: '11111111-1111-4111-8111-111111111111',
  key_env: 'factory',
};
const attempt: AttemptIdentity = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  batch_id: 7,
  ordinal: 0,
  load_sha256: 'a'.repeat(64),
};
const chip = 'cplc-v1:4790d3213180072976207515';
const key = '02' + '1'.repeat(64);
const oldKey = '03' + '2'.repeat(64);
function disk() {
  let saved: string | null = null;
  const storage: JournalStorage = {
    read: jest.fn(async () => saved),
    replace: jest.fn(async value => {
      saved = value;
    }),
  };
  return storage;
}
async function installed(storage = disk()) {
  const journal = await ProvisioningJournal.open(storage, scope, attempt);
  await journal.bind(chip);
  await journal.installIntent({
    installation_id: null,
    replacement_consent: false,
  });
  await journal.installed(key, {complete: true});
  return {journal, storage};
}
function record(): CompletionRecord {
  return {
    ...attempt,
    operator_id: scope.operator_id,
    device_id: scope.device_id,
    chip_id: chip,
    installation_id: key,
    display_id: key.slice(-4),
    gp_key_version: 1,
    key_env: 'factory',
    configuration_revision: 1,
    verified_stage: 'rotated',
    verified_at: 123,
  };
}

test('restart preserves intent, forbids adopting an untouched replacement, and never reinstalls after rotation intent', async () => {
  const storage = disk();
  let j = await ProvisioningJournal.open(storage, scope, attempt);
  await j.bind(chip);
  await expect(
    j.installIntent({installation_id: oldKey, replacement_consent: false}),
  ).rejects.toThrow();
  await j.installIntent({installation_id: oldKey, replacement_consent: true});
  j = await ProvisioningJournal.open(storage, scope);
  await expect(j.installed(oldKey, {complete: true})).rejects.toThrow();
  expect(
    recoveryAction(j.snapshot(), {chip_id: chip, installation_id: oldKey}),
  ).toBe('inspect-install');
  await j.installed(key, {complete: true});
  await j.rotationIntent();
  j = await ProvisioningJournal.open(storage, scope);
  expect(
    recoveryAction(j.snapshot(), {chip_id: chip, installation_id: key}),
  ).toBe('recover-rotation');
  expect(
    recoveryAction(j.snapshot(), {chip_id: chip, installation_id: oldKey}),
  ).toBe('stop');
  expect(
    recoveryAction(j.snapshot(), {
      chip_id: chip.replace('4790', '4791'),
      installation_id: key,
    }),
  ).toBe('stop');
  await expect(
    j.installIntent({installation_id: null, replacement_consent: false}),
  ).rejects.toThrow();
});

test('failed or ambiguous commit sends no dependent action and latches this writer', async () => {
  const {journal, storage} = await installed();
  const committed = storage.replace;
  storage.replace = jest.fn(async value => {
    await committed(value); // Disk may have committed even when the promise rejects.
    throw new Error('storage unavailable');
  });
  const cardAction = jest.fn();
  await expect(journal.rotationIntent().then(cardAction)).rejects.toThrow(
    'storage unavailable',
  );
  expect(cardAction).not.toHaveBeenCalled();
  expect(() => journal.snapshot()).toThrow();
  await expect(journal.rotated(1)).rejects.toThrow();
  const reopened = await ProvisioningJournal.open(storage, scope);
  expect(reopened.snapshot().stage).toBe('rotation_intent');
});

test('frozen record survives restart byte-identically and only a matching non-ready receipt advances it', async () => {
  const {journal, storage} = await installed();
  await journal.rotationIntent();
  await journal.rotated(1);
  const body = record();
  const pending = journal.freezeRecord(body);
  body.verified_at = 999;
  await pending;
  const reopened = await ProvisioningJournal.open(storage, scope);
  expect(recoveryAction(reopened.snapshot())).toBe('replay-record');
  const frozen = reopened.snapshot().frozen_record;
  expect(JSON.parse(frozen!).verified_at).toBe(123);
  const receipt = {
    attempt_id: attempt.attempt_id,
    installation_id: key,
    revision: 3,
    recorded_at: 456,
    verified_stage: 'rotated' as const,
    ready_for_holder: false as const,
  };
  await expect(
    reopened.acknowledge({...receipt, installation_id: oldKey}),
  ).rejects.toThrow();
  await reopened.acknowledge(receipt);
  const done = await ProvisioningJournal.open(storage, scope);
  expect(done.snapshot().frozen_record).toBe(frozen);
  expect(recoveryAction(done.snapshot())).toBe('show-receipt');
});

test('storage read failure, foreign scope, invalid schema and secret-bearing records cannot start fresh work', async () => {
  const storage = disk();
  const {journal} = await installed(storage);
  for (const foreign of [
    {operator_id: 2},
    {service_origin: 'https://other.test'},
    {device_id: attempt.attempt_id},
    {key_env: 'issued' as const},
  ]) {
    await expect(
      ProvisioningJournal.open(storage, {...scope, ...foreign}, attempt),
    ).rejects.toThrow();
  }
  await expect(
    ProvisioningJournal.open(storage, scope, {...attempt, ordinal: 1}),
  ).rejects.toThrow();
  await journal.rotationIntent();
  await journal.rotated(1);
  await expect(
    journal.freezeRecord({...record(), pin: '1234'} as CompletionRecord),
  ).rejects.toThrow();
  await storage.replace(
    JSON.stringify({...journal.snapshot(), token: 'secret'}),
  );
  await expect(
    ProvisioningJournal.open(storage, scope, attempt),
  ).rejects.toThrow();
  await storage.replace('{broken');
  await expect(
    ProvisioningJournal.open(storage, scope, attempt),
  ).rejects.toThrow();
  storage.read = jest.fn(async () => {
    throw new Error('disk');
  });
  await expect(
    ProvisioningJournal.open(storage, scope, attempt),
  ).rejects.toThrow('disk');
});

test('serialized transitions preserve quarantine across restart without recording secret diagnostics', async () => {
  const {journal, storage} = await installed();
  await Promise.all([journal.rotationIntent(), journal.rotated(1)]);
  await journal.quarantine('authentication-failed');
  const reopened = await ProvisioningJournal.open(storage, scope);
  expect(
    recoveryAction(reopened.snapshot(), {chip_id: chip, installation_id: key}),
  ).toBe('stop');
  await expect(reopened.rotated(1)).rejects.toThrow();
  await expect(reopened.quarantine('token=secret')).rejects.toThrow();
  expect((await storage.read())!).not.toMatch(/token|password|pin|enc|mac|dek/);
});
