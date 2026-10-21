/** Public support details only; never serialize the workflow or raw receipts. */
import type {AttemptJournal} from './journal';
import type {WorkflowSnapshot} from './provisioningWorkflow';
function journalDetails(j: AttemptJournal) {
  return {
    attempt_id: j.attempt_id,
    ordinal: j.ordinal,
    stage: j.stage,
    chip_id: j.chip_id ?? null,
    installation_id: j.installation_id ?? null,
    load_sha256: j.load_sha256,
    gp_key_version: j.gp_key_version ?? null,
    quarantine_reason: j.quarantine_reason ?? null,
    record_pending: j.stage === 'record_pending',
    completion_acknowledged: !!j.completion_receipt,
    disposition_acknowledged: !!j.disposition_receipt,
  };
}
export function recoveryDetails(snapshot: WorkflowSnapshot) {
  const batch = snapshot.batch;
  if (!batch) {
    throw new Error('No saved batch to export');
  }
  const origin = batch.scope.service_origin;
  return {
    schema: 1,
    kind: 'cashu-card-recovery-details',
    // Historical configuration may predate the build-origin validator. Do not
    // export a URL containing userinfo, path, query or other unexpected text.
    service_origin: /^https?:\/\/[a-zA-Z0-9.[\]:-]+$/.test(origin)
      ? origin
      : null,
    operator_id: batch.scope.operator_id,
    key_env: batch.scope.key_env,
    device_id: snapshot.device_id,
    batch: {
      batch_id: batch.batch_id,
      request_id: batch.request.batch_request_id,
      count: batch.request.count,
      next_ordinal: batch.next_ordinal,
      load_sha256: batch.request.load_sha256,
    },
    active: snapshot.active
      ? {
          attempt_id: snapshot.active.attempt_id,
          ordinal: snapshot.active.ordinal,
          revision: snapshot.active.revision,
          journal: snapshot.active.journal
            ? journalDetails(snapshot.active.journal)
            : null,
        }
      : null,
    // Bound share-sheet size for large batches; original evidence stays on device.
    history_count: snapshot.history.length,
    recent_history: snapshot.history.slice(-20).map(journalDetails),
    ready_for_payments: false,
  };
}
