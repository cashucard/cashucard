/** Public state and next steps. A read is not payment/holder-readiness certification. */
import {
  CARD_AID,
  CardError,
  readChipIdentity,
  readResetReview,
  selectAid,
  transmit,
  type ResetReview,
  type Transceiver,
} from './cardkit';
import type {ResetLookup} from './ownedResetWorkflow';
export type CardReadout =
  | {state: 'blank'; chipId: string}
  | {state: 'unsupported'; chipId: string; version: string}
  | {state: 'present'; chipId: string; card: ResetReview};
export interface CardStatus {
  title: string;
  detail: string;
  action: 'install' | 'resume' | 'holder' | 'admin';
  label: string;
}
export async function readCardStatus(tx: Transceiver): Promise<CardReadout> {
  const chip = await readChipIdentity(tx);
  const reply = await transmit(tx, selectAid(CARD_AID));
  if (reply.sw === 0x6a82) {
    return {state: 'blank', chipId: chip.id};
  }
  if (reply.sw !== 0x9000) {
    throw new CardError(reply.sw, 0xa4);
  }
  if (reply.data.length !== 2 || reply.data[0] !== 2 || reply.data[1] !== 1) {
    return {
      state: 'unsupported',
      chipId: chip.id,
      version:
        reply.data.length === 2
          ? `${reply.data[0]}.${reply.data[1]}`
          : 'unknown',
    };
  }
  const card = await readResetReview(tx);
  if (card.chipId !== chip.id) {
    throw new Error('Card changed during status read');
  }
  return {state: 'present', chipId: chip.id, card};
}
export function cardStatus(
  readout: CardReadout,
  context: {source?: ResetLookup; savedChip?: string; savedStage?: string} = {},
): CardStatus {
  if (readout.state === 'unsupported') {
    return {
      title: 'Unsupported applet',
      detail: `The card reports version ${readout.version}. No authentication or changes were attempted. Ask its issuer about a supported recovery path.`,
      action: 'admin',
      label: 'OPEN SETTINGS',
    };
  }
  if (context.savedChip === readout.chipId && context.savedStage) {
    if (context.savedStage === 'quarantined') {
      return {
        title: 'Installation needs administrator review',
        detail:
          'This card matches a stopped attempt. Keep its saved details; do not start another installation.',
        action: 'admin',
        label: 'OPEN SETTINGS',
      };
    }
    if (['record_pending', 'recorded'].includes(context.savedStage)) {
      return {
        title: 'Finish saving the installation',
        detail:
          'The card work is complete. Open saved work to confirm the service record; no new card tap is needed.',
        action: 'resume',
        label: 'OPEN SAVED RECORD',
      };
    }
    return {
      title: 'Continue the saved installation',
      detail:
        'This card matches saved work on this phone. Review that attempt before choosing any new work.',
      action: 'resume',
      label: 'OPEN SAVED INSTALLATION',
    };
  }
  if (readout.state === 'blank') {
    return {
      title: 'Ready for installation review',
      detail:
        'No Cashu applet was found. A new batch will check the card manager before writing; this read does not establish its manager keys.',
      action: 'install',
      label: 'SET UP A NEW BATCH',
    };
  }
  const c = readout.card;
  if (c.locked || c.pinBlocked) {
    return {
      title: c.pinBlocked ? 'PIN recovery needed' : 'Card is locked',
      detail:
        'Use the linked holder wallet to unlock or recover this card. The provisioner will not guess its PIN or erase it.',
      action: 'holder',
      label: 'HOLDER WALLET INSTRUCTIONS',
    };
  }
  if (!c.tag) {
    return {
      title: 'Installation is incomplete',
      detail:
        'The NFC tag is missing. Keep this card and ask your administrator to review its installation history.',
      action: 'admin',
      label: 'OPEN SETTINGS',
    };
  }
  if (context.source?.lookup.status === 'unresolved') {
    return {
      title: 'Installation history needs review',
      detail:
        'The service has an unresolved attempt for this chip. Keep the card and ask your administrator to reconcile its history. Its wallet can still inspect it.',
      action: 'admin',
      label: 'OPEN SETTINGS',
    };
  }
  if (c.unspent > 0) {
    return {
      title: 'Card has value',
      detail: `${c.unspent} unspent entries remain. Use a compatible holder wallet to read the balance, pay or recover it. Reset is unavailable while value remains.`,
      action: 'holder',
      label: 'HOLDER WALLET INSTRUCTIONS',
    };
  }
  if (c.spent > 0) {
    return {
      title: 'Check earlier payments',
      detail: `${c.spent} spent entries remain. Finish pending merchant payments and change before reuse. Reset will independently check settlement; this read has not checked the mint.`,
      action: 'holder',
      label: 'HOLDER WALLET INSTRUCTIONS',
    };
  }
  if (c.owner) {
    return {
      title: 'Empty and linked to a wallet',
      detail:
        'The card has no proof entries and retains its holder link. Keep using that wallet; reset is needed only if you intend to replace the installation.',
      action: 'holder',
      label: 'HOLDER WALLET INSTRUCTIONS',
    };
  }
  return {
    title: 'Ready for wallet setup',
    detail:
      'The applet is installed and empty. Set up holder ownership and a PIN in a compatible wallet, then load value before spending.',
    action: 'holder',
    label: 'HOLDER WALLET INSTRUCTIONS',
  };
}
