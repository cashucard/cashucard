/** Injected NFC orchestration. The real screen remains gated on hardware tests.
 * Manager keys live only in this call; intent writes are awaited explicitly.
 */
import {
  CASHU_PLAN,
  FACTORY_KEYS,
  CardError,
  ChipIdentityMismatch,
  InspectionError,
  TransportError,
  WrongKeys,
  fromHex,
  readChipIdentity,
  inspectInstallation,
  provision,
  rotateKeys,
  confirmManagerKeys,
  type KeySet,
  type RunOptions,
  type RotateResult,
  type Transceiver,
  type InstallationInspection,
} from './cardkit';
import type {ProvisioningJournal} from './journal';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
} from './provisioningWorkflow';

export type TapOutcome =
  | 'record_pending'
  | 'interrupted'
  | 'quarantined'
  | 'replacement-consent-required';
export interface TapOptions extends RunOptions {
  /** Consent for exactly this inspected old installation, never blanket replace. */
  replacementInstallationId?: string;
  verifiedAt: () => number;
}
const complete = (
  observed: InstallationInspection,
): observed is Extract<InstallationInspection, {state: 'present'}> =>
  observed.state === 'present' && observed.empty && observed.tagVerified;

async function stopped(
  j: ProvisioningJournal,
  result: Pick<RotateResult, 'kind' | 'ins'>,
): Promise<TapOutcome> {
  if (result.kind === 'pulled') {
    return 'interrupted';
  }
  await j.quarantine(
    result.kind === 'wrongKeys' || result.ins === 0x82 || result.ins === 0x50
      ? 'authentication-failed'
      : 'verification-failed',
  );
  return 'quarantined';
}

/** Binding must be acknowledged by the service before install intent/mutation. */
export async function runProvisioningTap(
  tx: Transceiver,
  journal: ProvisioningJournal,
  assigned: KeySet,
  bind: (chip_id: string) => Promise<void>,
  options: TapOptions,
): Promise<TapOutcome> {
  let j = journal.snapshot();
  if (j.stage === 'quarantined') {
    return 'quarantined';
  }
  if (j.stage === 'record_pending') {
    return 'record_pending';
  }
  if (j.stage === 'recorded') {
    throw new Error('attempt already recorded');
  }
  if (j.load_sha256 !== CASHU_PLAN.loadFile.sha256) {
    throw new Error('load artifact does not match the reservation');
  }
  try {
    const chip = await readChipIdentity(tx, j.chip_id);
    if (!j.chip_id) {
      await bind(chip.id);
      await journal.bind(chip.id);
    }
    let observed = await inspectInstallation(tx);
    if (j.stage === 'reserved') {
      if (observed.state === 'present') {
        if (!complete(observed)) {
          await journal.quarantine('verification-failed');
          return 'quarantined';
        }
        if (options.replacementInstallationId !== observed.installationId) {
          return 'replacement-consent-required';
        }
      }
      await journal.installIntent({
        installation_id:
          observed.state === 'present' ? observed.installationId : null,
        replacement_consent: observed.state === 'present',
      });
      const installed = await provision(tx, CASHU_PLAN, {
        ...options,
        keys: FACTORY_KEYS,
        replace: observed.state === 'present',
      });
      if (!installed.ok) {
        return stopped(journal, installed);
      }
      observed = await inspectInstallation(tx);
    }
    j = journal.snapshot();
    if (j.stage === 'install_intent') {
      // A new full key plus complete verification is the only adoptable result.
      // Absent/partial or untouched old applets never authorize a recovery sweep.
      if (
        !complete(observed) ||
        observed.installationId === j.preinstall?.installation_id
      ) {
        await journal.quarantine('unsafe-partial-install');
        return 'quarantined';
      }
      await journal.installed(observed.installationId, {complete: true});
    }
    j = journal.snapshot();
    if (!complete(observed) || observed.installationId !== j.installation_id) {
      await journal.quarantine('identity-mismatch');
      return 'quarantined';
    }
    if (j.stage === 'installed') {
      await journal.rotationIntent();
    }
    j = journal.snapshot();
    if (j.stage === 'rotation_intent') {
      const rotated = await rotateKeys(tx, FACTORY_KEYS, assigned, options);
      if (!rotated.ok) {
        return stopped(journal, rotated);
      }
      if (!Number.isInteger(rotated.keyVersion)) {
        await journal.quarantine('verification-failed');
        return 'quarantined';
      }
      await journal.rotated(rotated.keyVersion!);
    } else if (j.stage === 'rotated') {
      // A durable rotation claim permits confirmation only, never another PUT KEY.
      const confirmed = await confirmManagerKeys(tx, assigned, options);
      if (!confirmed.ok) {
        return stopped(journal, confirmed);
      }
      if (confirmed.keyVersion !== j.gp_key_version) {
        await journal.quarantine('verification-failed');
        return 'quarantined';
      }
    } else {
      throw new Error('unexpected provisioning stage');
    }
    j = journal.snapshot();
    await journal.freezeRecord({
      attempt_id: j.attempt_id,
      batch_id: j.batch_id,
      ordinal: j.ordinal,
      chip_id: j.chip_id!,
      installation_id: j.installation_id!,
      display_id: j.installation_id!.slice(-4),
      load_sha256: j.load_sha256,
      gp_key_version: j.gp_key_version!,
      operator_id: j.operator_id,
      device_id: j.device_id,
      key_env: j.key_env,
      configuration_revision: 1,
      verified_stage: 'rotated',
      verified_at: options.verifiedAt(),
    });
    return 'record_pending';
  } catch (e) {
    if (e instanceof TransportError) {
      return 'interrupted';
    }
    if (
      e instanceof ChipIdentityMismatch ||
      e instanceof InspectionError ||
      e instanceof CardError ||
      e instanceof WrongKeys
    ) {
      await journal.quarantine(
        e instanceof ChipIdentityMismatch
          ? 'identity-mismatch'
          : e instanceof WrongKeys ||
            (e instanceof CardError && [0x50, 0x82].includes(e.ins))
          ? 'authentication-failed'
          : 'verification-failed',
      );
      return 'quarantined';
    }
    // Storage and service errors propagate; never continue from stale memory.
    throw e;
  }
}

export interface AttemptRunOptions extends TapOptions {
  withCard: (
    run: (tx: Transceiver) => Promise<TapOutcome>,
  ) => Promise<TapOutcome>;
}
/** Fetch the exact assigned set before arming NFC; record retry needs no card. */
export async function runReservedAttempt(
  workflow: ProvisioningWorkflow,
  service: CardProvisioningService,
  options: AttemptRunOptions,
): Promise<TapOutcome | 'recorded'> {
  await workflow.reconcile(service);
  const initial = workflow.snapshot();
  const active = initial.active;
  if (!active?.journal) {
    throw new Error('an acknowledged attempt is required');
  }
  if (active.journal.stage === 'quarantined') {
    return 'quarantined';
  }
  if (['record_pending', 'recorded'].includes(active.journal.stage)) {
    await workflow.postRecord(service);
    return 'recorded';
  }
  const keys = await service.keys(initial.device_id, active.attempt_id);
  if (
    keys.attempt_id !== active.attempt_id ||
    keys.batch_id !== initial.batch!.batch_id ||
    keys.ordinal !== active.ordinal ||
    keys.chip_id !== (active.journal.chip_id ?? null) ||
    ![keys.enc, keys.mac, keys.dek].every(
      k => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k),
    )
  ) {
    throw new Error('assigned keys do not match the reserved attempt');
  }
  const assigned = {
    enc: fromHex(keys.enc),
    mac: fromHex(keys.mac),
    dek: fromHex(keys.dek),
  };
  const result = await workflow.withAttempt(service, async journal => {
    if (journal.snapshot().attempt_id !== active.attempt_id) {
      throw new Error('active attempt changed');
    }
    return options.withCard(tx =>
      runProvisioningTap(
        tx,
        journal,
        assigned,
        async chip_id => {
          const receipt = await service.bind(
            initial.device_id,
            active.attempt_id,
            {revision: active.revision!, chip_id},
          );
          if (
            receipt.attempt_id !== active.attempt_id ||
            receipt.chip_id !== chip_id ||
            !Number.isSafeInteger(receipt.revision) ||
            receipt.revision !== active.revision! + 1
          ) {
            throw new Error('the binding receipt does not match the attempt');
          }
        },
        options,
      ),
    );
  });
  if (result === 'record_pending') {
    await workflow.postRecord(service);
    return 'recorded';
  }
  return result;
}
