import {
  loadResetJournal,
  writeResetJournal,
  type ResetJournal,
} from '../src/resetJournal';
import type {JournalStorage} from '../src/journal';

const journal = {
  schema: 1 as const,
  stage: 'reviewed' as const,
  service_origin: 'https://ops.cashucard.org',
  operator_id: 1,
  device_id: '00000000-0000-4000-8000-000000000001',
  key_env: 'issued' as const,
  reset_id: '00000000-0000-4000-8000-000000000002',
  chip_id: 'cplc-v1:4790d3213041093363205547',
  installation_id:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  source_origin: 'https://local.example.test',
  source_attempt_id: '00000000-0000-4000-8000-000000000003',
  consent: {
    erase_owner_and_proofs: true as const,
    value_handled: true as const,
  },
};
function storage(): JournalStorage {
  let value: string | null = null;
  return {
    read: async () => value,
    replace: async next => {
      value = next;
    },
  };
}

test('the deletion intent persists before the operation and a lost reply cannot skip inspection', async () => {
  const disk = storage();
  await writeResetJournal(disk, journal);
  await expect(
    writeResetJournal(disk, {...journal, stage: 'delete_intent'}),
  ).rejects.toThrow();
  const authorized = {...journal, service_intent_receipt: 'intent-1'};
  await writeResetJournal(disk, {...authorized, stage: 'delete_intent'});
  expect((await loadResetJournal(disk))?.stage).toBe('delete_intent');
  await expect(
    writeResetJournal(disk, {...authorized, stage: 'rotation_intent'}),
  ).rejects.toThrow();
  expect((await loadResetJournal(disk))?.stage).toBe('delete_intent');
  await writeResetJournal(disk, {...authorized, stage: 'deletion_observed'});
  await writeResetJournal(disk, {...authorized, stage: 'rotation_intent'});
  await writeResetJournal(disk, {...authorized, stage: 'factory_verified'});
  await writeResetJournal(disk, {
    ...authorized,
    stage: 'complete',
    reconciliation_receipt: 'receipt-1',
  });
  expect((await loadResetJournal(disk))?.stage).toBe('complete');
});

test('a saved reset cannot switch card, source or consent, and malformed storage stops', async () => {
  const disk = storage();
  await writeResetJournal(disk, journal);
  for (const changed of [
    {...journal, chip_id: journal.chip_id.replace('5547', '5548')},
    {...journal, source_attempt_id: '00000000-0000-4000-8000-000000000004'},
    {...journal, consent: {...journal.consent, value_handled: false}},
  ]) {
    await expect(
      writeResetJournal(disk, changed as unknown as ResetJournal),
    ).rejects.toThrow();
  }
  expect((await loadResetJournal(disk))?.chip_id).toBe(journal.chip_id);
  await disk.replace('{bad');
  await expect(loadResetJournal(disk)).rejects.toThrow();
});

test('a stopped reset remains terminal and keeps its reason', async () => {
  const disk = storage();
  await writeResetJournal(disk, journal);
  await writeResetJournal(disk, {
    ...journal,
    stage: 'stopped',
    stopped_reason: 'inspection-uncertain',
  });
  await expect(
    writeResetJournal(disk, {...journal, stage: 'delete_intent'}),
  ).rejects.toThrow();
  expect((await loadResetJournal(disk))?.stopped_reason).toBe(
    'inspection-uncertain',
  );
});
