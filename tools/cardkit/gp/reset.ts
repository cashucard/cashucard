/** Owned-card applet removal and manager-key recovery. Never installs or silently retries. */
import {
  CARD_AID,
  CASHU_PACKAGE_AID,
  ISD_AID,
  OPENER_AID,
  TAG_AID,
} from './aids';
import {readChipIdentity} from './identity';
import {inspectInstallation} from './inspect';
import {assessResetPreflight} from './reset-preflight';
import {readCashuRegistry, type CashuRegistry} from './registry';
import {rotateKeys, type RunOptions, type StopKind} from './provision';
import {
  CardError,
  FACTORY_KEYS,
  TransportError,
  WrongKeys,
  deleteAid,
  externalAuthenticate,
  initializeUpdate,
  selectAid,
  sessionIfMatches,
  transmit,
  type KeySet,
  type Session,
  type Transceiver,
} from './scp02';

export type ResetStage =
  | 'reviewed'
  | 'delete_intent'
  | 'deletion_observed'
  | 'rotation_intent'
  | 'factory_verified';
export interface ResetAuthority {
  chipId: string;
  installationId: string;
  sourceRef: string;
  /** Validated service receipt, obtained before this operation. Never key bytes. */
  intentReceipt: string;
  eraseOwnerAndProofs: true;
  valueHandled: true;
}
export interface ResetOptions extends RunOptions {
  authority: ResetAuthority;
  keys: KeySet;
  stage: ResetStage;
  /** Must durably commit before resolving. One caller serializes this journal. */
  persist(stage: ResetStage, evidence?: {keyVersion: number}): Promise<void>;
}
export interface ResetResult {
  ok: boolean;
  stage: ResetStage;
  kind?: StopKind | 'storage';
  reason?: string;
  keyVersion?: number;
}
class ResetGuard extends Error {}
class ResetStorageError extends Error {}
const STAGES: ResetStage[] = [
  'reviewed',
  'delete_intent',
  'deletion_observed',
  'rotation_intent',
  'factory_verified',
];
const OBJECTS = ['tag', 'card', 'opener', 'package'] as const;
const AIDS = {
  tag: TAG_AID,
  card: CARD_AID,
  opener: OPENER_AID,
  package: CASHU_PACKAGE_AID,
};
const empty = (registry: CashuRegistry) => OBJECTS.every(k => !registry[k]);

export async function resetOwnedCard(
  tx: Transceiver,
  options: ResetOptions,
): Promise<ResetResult> {
  let stage = options.stage;
  const a = options.authority;
  const save = async (next: ResetStage, evidence?: {keyVersion: number}) => {
    try {
      await options.persist(next, evidence);
    } catch {
      throw new ResetStorageError();
    }
    stage = next;
  };
  try {
    if (
      !STAGES.includes(stage) ||
      !a ||
      !/^cplc-v1:[0-9a-f]{24}$/.test(a.chipId) ||
      !/^0[23][0-9a-f]{64}$/.test(a.installationId) ||
      !a.sourceRef?.trim() ||
      !a.intentReceipt?.trim() ||
      a.eraseOwnerAndProofs !== true ||
      a.valueHandled !== true
    )
      throw new ResetGuard();
    await readChipIdentity(tx, a.chipId);
    const observed = await inspectInstallation(tx);
    if (stage === 'reviewed') {
      const review = assessResetPreflight({
        chipId: a.chipId,
        installation: observed,
        provenance: {
          chipId: a.chipId,
          installationId: a.installationId,
          keySourceRef: a.sourceRef,
        },
        consent: {
          chipId: a.chipId,
          installationId: a.installationId,
          eraseOwnerAndProofs: true,
          valueHandled: true,
        },
      });
      if (!review.ok) throw new ResetGuard();
      await save('delete_intent');
    } else if (observed.state === 'present') {
      if (
        stage !== 'delete_intent' ||
        observed.installationId !== a.installationId ||
        observed.publicState.unspent !== 0 ||
        observed.publicState.spent !== 0
      )
        throw new ResetGuard();
    }
    const selected = await transmit(tx, selectAid(ISD_AID));
    if (selected.sw !== 0x9000) throw new CardError(selected.sw, 0xa4);
    const hs = await initializeUpdate(tx, options.random, 0);
    if (hs.reply.kvn === 0) throw new ResetGuard(); // PUT KEY P1=0 adds a set rather than replacing it.
    const afterDeletion =
      stage === 'rotation_intent' || stage === 'factory_verified';
    const source =
      stage === 'factory_verified' ? null : sessionIfMatches(options.keys, hs);
    const target =
      afterDeletion && !source ? sessionIfMatches(FACTORY_KEYS, hs) : null;
    if (!source && !target) throw new WrongKeys();
    const session: Session = await externalAuthenticate(
      tx,
      source ?? target!,
      hs,
      {macOverModifiedApdu: options.macOverModifiedApdu},
    );
    const registry = () =>
      readCashuRegistry(command => session.send(tx, command));
    let current = await registry();
    if (current.card !== (observed.state === 'present')) throw new ResetGuard();
    if (stage === 'delete_intent') {
      for (const object of OBJECTS) {
        if (!current[object]) continue;
        const reply = await session.send(tx, deleteAid(AIDS[object]));
        if (reply.sw !== 0x9000) throw new CardError(reply.sw, 0xe4);
        const expected = {...current, [object]: false};
        const next = await registry();
        if (OBJECTS.some(k => next[k] !== expected[k])) throw new ResetGuard();
        current = next;
      }
      if (!empty(current)) throw new ResetGuard();
      await save('deletion_observed');
    } else if (!empty(current)) throw new ResetGuard();
    if (stage === 'deletion_observed') await save('rotation_intent');
    let keyVersion = session.keyVersion;
    if (stage === 'rotation_intent') {
      const rotation = await rotateKeys(
        tx,
        options.keys,
        FACTORY_KEYS,
        options,
      );
      if (!rotation.ok)
        return {
          ok: false,
          stage,
          kind: rotation.kind,
          reason: 'manager-key recovery stopped; retain the reset intent',
        };
      keyVersion = rotation.keyVersion!;
    }
    // A factory set is shared by blank cards: match CPLC again before acknowledging it.
    await readChipIdentity(tx, a.chipId);
    if ((await inspectInstallation(tx)).state !== 'absent')
      throw new ResetGuard();
    if (
      typeof keyVersion !== 'number' ||
      !Number.isInteger(keyVersion) ||
      keyVersion < 0 ||
      keyVersion > 255
    )
      throw new ResetGuard();
    if (stage !== 'factory_verified')
      await save('factory_verified', {keyVersion});
    return {ok: true, stage, keyVersion};
  } catch (error) {
    const kind =
      error instanceof ResetStorageError
        ? 'storage'
        : error instanceof WrongKeys
          ? 'wrongKeys'
          : error instanceof TransportError
            ? 'pulled'
            : error instanceof CardError
              ? 'refused'
              : 'guarded';
    return {
      ok: false,
      stage,
      kind,
      reason: 'reset stopped; retain its saved intent for reconciliation',
    };
  }
}
