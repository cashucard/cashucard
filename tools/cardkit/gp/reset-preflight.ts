/** A read-only reset gate. The caller must separately verify key escrow and persist intent. */
import type {InstallationInspection} from './inspect';

export interface ResetPreflightInput {
  chipId: string;
  installation: InstallationInspection;
  provenance?: {
    chipId: string;
    installationId: string;
    /** Stable reference to a reviewed escrow record, never the key bytes. */
    keySourceRef: string;
  };
  consent?: {
    chipId: string;
    installationId: string;
    eraseOwnerAndProofs: boolean;
    valueHandled: boolean;
  };
  unresolvedAttempt?: boolean;
}

export type ResetPreflightResult = {ok: true} | {ok: false; reason: string};

/** No factory-key fallback and no mutation. Every mismatch must be reconciled first. */
export function assessResetPreflight(
  input: ResetPreflightInput,
): ResetPreflightResult {
  const fail = (reason: string): ResetPreflightResult => ({ok: false, reason});
  const card = input.installation;
  if (card.state !== 'present') return fail('no 2.1 applet is present');
  if (!card.tagVerified)
    return fail('the NFC tag is missing or installation is incomplete');
  if (card.publicState.unspent !== 0 || card.publicState.spent !== 0)
    return fail(
      'the card has proof slots that require holder and mint reconciliation',
    );
  if (input.unresolvedAttempt)
    return fail('an earlier attempt requires reconciliation');
  const source = input.provenance;
  if (
    !source?.keySourceRef.trim() ||
    source.chipId !== input.chipId ||
    source.installationId !== card.installationId
  )
    return fail(
      'exact chip, installation and manager-key provenance are not confirmed',
    );
  const consent = input.consent;
  if (
    !consent ||
    consent.chipId !== input.chipId ||
    consent.installationId !== card.installationId ||
    !consent.eraseOwnerAndProofs ||
    !consent.valueHandled
  )
    return fail('card-specific deletion and value-handling consent is missing');
  return {ok: true};
}
