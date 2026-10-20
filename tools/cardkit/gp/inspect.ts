/** Read-only installation evidence; no authentication, mutation or retry. */
import {CARD_AID, TAG_AID} from './aids';
import {equal, toHex} from './bytes';
import {notEmpty} from './provision';
import {CardError, selectAid, transmit, type Transceiver} from './scp02';

export type InstallationInspection =
  | {state: 'absent'}
  | {
      state: 'present';
      installationId: string;
      empty: boolean;
      tagVerified: boolean;
    };

export class InspectionError extends Error {
  constructor() {
    super('the installed applet did not provide valid 2.1 inspection evidence');
    this.name = 'InspectionError';
  }
}

export async function inspectInstallation(
  tx: Transceiver,
): Promise<InstallationInspection> {
  const selected = await transmit(tx, selectAid(CARD_AID));
  if (selected.sw === 0x6a82) return {state: 'absent'};
  if (selected.sw !== 0x9000) throw new CardError(selected.sw, 0xa4);
  if (!equal(selected.data, [2, 1])) throw new InspectionError();
  const info = await transmit(tx, [0xb0, 1, 0, 0, 0]);
  if (info.sw !== 0x9000) throw new CardError(info.sw, 1);
  if (info.data.length !== 30 || info.data[0] !== 2 || info.data[1] !== 1)
    throw new InspectionError();
  const pubkey = await transmit(tx, [0xb0, 0x10, 0, 0, 0x21]);
  if (pubkey.sw !== 0x9000) throw new CardError(pubkey.sw, 0x10);
  if (pubkey.data.length !== 33 || ![2, 3].includes(pubkey.data[0]!))
    throw new InspectionError();
  const tag = await transmit(tx, selectAid(TAG_AID));
  if (tag.sw !== 0x9000 && tag.sw !== 0x6a82) throw new CardError(tag.sw, 0xa4);
  return {
    state: 'present',
    installationId: toHex(pubkey.data).toLowerCase(),
    empty: notEmpty(info.data) === null,
    tagVerified: tag.sw === 0x9000,
  };
}
