/** Injected NFC orchestration. The real screen remains gated on hardware tests.
 * Manager keys live only in this call; intent writes are awaited explicitly.
 */
import {
  cashuPlanFor,
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
  type BlankRetry,
  type RunOptions,
  type RotateResult,
  type Transceiver,
  type InstallationInspection,
} from './cardkit';
import {CASHU_LOAD_FILE} from './assets/cashu';
import type {InstallMaker} from './releaseGates';
import type {RecoveryBoundary} from './recoveryDrills';
import {canRetryBlank, type ProvisioningJournal} from './journal';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
} from './provisioningWorkflow';

export type TapOutcome =
  'record_pending' | 'interrupted' | 'quarantined' | 'reset-required';
export interface TapOptions extends RunOptions {
  /**
   * The maker whose tag address this install gives the card: one that passed
   * the installation gate (releaseGates.ts). Without it nothing is installed.
   */
  maker: InstallMaker;
  /** Explicit retry of the current, previously blank, bound card. */
  retryBlank?: BlankRetry;
  /** Legacy callers cannot authorize factory-key replacement; ignored. */
  replacementInstallationId?: string;
  /**
   * The install deletes a J3R452's seller NDEF tag at the tag's AID, on the
   * registry's evidence that it is the seller's (cardkit's replaceSellerTag,
   * D182). Off, such a card is quarantined with nothing deleted.
   */
  replaceSellerTag?: boolean;
  /** Public inspection only; caller must wait for session closure before review. */
  onReplacementRequired?: (inspection: {
    chipId: string;
    installationId: string;
  }) => void;
  verifiedAt: () => number;
  /** Optional validation hook; receives only a public boundary name. */
  checkpoint?: (boundary: RecoveryBoundary) => Promise<void>;
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
  confirmActive?: () => Promise<void>,
): Promise<TapOutcome> {
  let j = journal.snapshot();
  const retry = options.retryBlank;
  if (
    retry &&
    (!canRetryBlank(j) || retry.chipId !== j.chip_id || !confirmActive)
  ) {
    return 'quarantined';
  }
  if (j.stage === 'quarantined' && !retry) {
    return 'quarantined';
  }
  if (j.stage === 'record_pending') {
    return 'record_pending';
  }
  if (j.stage === 'recorded') {
    throw new Error('attempt already recorded');
  }
  if (j.load_sha256 !== CASHU_LOAD_FILE.sha256) {
    throw new Error('load artifact does not match the reservation');
  }
  // Built before the card is touched: a maker the gate did not pass stops here.
  const plan = cashuPlanFor(options.maker);
  try {
    const chip = await readChipIdentity(tx, j.chip_id);
    let observed = await inspectInstallation(tx);
    // Inspect before binding a fresh reservation. An installed card belongs in
    // the escrow-backed reset flow, never a factory-key replacement attempt.
    if (j.stage === 'reserved' && observed.state === 'present') {
      options.onReplacementRequired?.({
        chipId: chip.id,
        installationId: observed.installationId,
      });
      return 'reset-required';
    }
    if (!j.chip_id) {
      await bind(chip.id);
      await journal.bind(chip.id);
    }
    if (j.stage === 'reserved' || retry) {
      if (!retry) {
        await journal.installIntent({
          installation_id: null,
          replacement_consent: false,
        });
        await options.checkpoint?.('install-intent-saved');
      }
      const installed = await provision(tx, plan, {
        ...options,
        keys: FACTORY_KEYS,
        replace: false,
        blankRetry: retry
          ? {
              ...retry,
              persistIntent: async () => {
                await confirmActive!();
                await journal.beginBlankRetry(
                  retry.chipId,
                  retry.factoryKeyVersion,
                  options.verifiedAt(),
                );
                await options.checkpoint?.('install-intent-saved');
              },
            }
          : undefined,
      });
      if (!installed.ok) {
        if (retry && journal.snapshot().stage === 'quarantined') {
          return installed.kind === 'pulled' ? 'interrupted' : 'quarantined';
        }
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
      await options.checkpoint?.('installation-verified-before-save');
      await journal.installed(observed.installationId, {complete: true});
      await options.checkpoint?.('installation-saved');
    }
    j = journal.snapshot();
    if (!complete(observed) || observed.installationId !== j.installation_id) {
      await journal.quarantine('identity-mismatch');
      return 'quarantined';
    }
    if (j.stage === 'installed') {
      await journal.rotationIntent();
      await options.checkpoint?.('rotation-intent-saved');
    }
    j = journal.snapshot();
    if (j.stage === 'rotation_intent') {
      if (j.blank_retry && !confirmActive)
        throw new Error(
          'active retry confirmation required before key rotation',
        );
      const rotated = await rotateKeys(tx, FACTORY_KEYS, assigned, {
        ...options,
        beforePutKey: j.blank_retry ? confirmActive : undefined,
      });
      if (!rotated.ok) {
        return stopped(journal, rotated);
      }
      if (!Number.isInteger(rotated.keyVersion)) {
        await journal.quarantine('verification-failed');
        return 'quarantined';
      }
      await options.checkpoint?.('rotation-verified-before-save');
      await journal.rotated(rotated.keyVersion!);
      await options.checkpoint?.('rotation-saved');
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
      if (retry && journal.snapshot().stage === 'quarantined')
        return 'quarantined';
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
  if (
    options.retryBlank &&
    (!canRetryBlank(active.journal) ||
      active.journal.chip_id !== options.retryBlank.chipId)
  ) {
    return 'quarantined';
  }
  if (active.journal.stage === 'quarantined' && !options.retryBlank) {
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
  const run = async (
    journal: ProvisioningJournal,
    confirmActive?: () => Promise<void>,
  ) => {
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
        confirmActive,
      ),
    );
  };
  const result = options.retryBlank
    ? await workflow.withBlankRetry(service, active.attempt_id, run)
    : await workflow.withAttempt(service, journal =>
        run(
          journal,
          journal.snapshot().blank_retry
            ? () => workflow.confirmActiveRetry(service, active.attempt_id)
            : undefined,
        ),
      );
  if (result === 'record_pending') {
    await options.checkpoint?.('record-frozen-session-closed');
    await workflow.postRecord(service);
    return 'recorded';
  }
  return result;
}
