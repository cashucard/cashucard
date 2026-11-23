/** Read-only installation evidence; no authentication, mutation or retry. */
import {CARD_AID, TAG_AID, supportedCardVersion} from './aids';
import {equal, toHex} from './bytes';
import {readChangeOwed} from './change-owed';
import {notEmpty} from './provision';
import {CardError, selectAid, transmit, type Transceiver} from './scp02';

export type InstallationInspection =
  | {state: 'absent'}
  | {
      state: 'present';
      installationId: string;
      empty: boolean;
      tagVerified: boolean;
      publicState: {
        unspent: number;
        spent: number;
        pin: boolean;
        record: boolean;
        owner: boolean;
        /**
         * The card made a payment whose change is not back on it yet: GET_INFO
         * byte 29 on 3.0, GET_CHANGE's count on 2.1 and 2.2. Deleting the
         * applet loses that change for good.
         */
        changeOwed: boolean;
      };
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
  if (!supportedCardVersion(selected.data)) throw new InspectionError();
  const info = await transmit(tx, [0xb0, 1, 0, 0, 0]);
  if (info.sw !== 0x9000) throw new CardError(info.sw, 1);
  if (info.data.length !== 30 || !equal(info.data.slice(0, 2), selected.data))
    throw new InspectionError();
  const changeOwed = await readChangeOwed(c => transmit(tx, c), info.data);
  const pubkey = await transmit(tx, [0xb0, 0x10, 0, 0, 0x21]);
  if (pubkey.sw !== 0x9000) throw new CardError(pubkey.sw, 0x10);
  if (pubkey.data.length !== 33 || ![2, 3].includes(pubkey.data[0]!))
    throw new InspectionError();
  const tag = await transmit(tx, selectAid(TAG_AID));
  if (tag.sw !== 0x9000 && tag.sw !== 0x6a82) throw new CardError(tag.sw, 0xa4);
  return {
    state: 'present',
    installationId: toHex(pubkey.data).toLowerCase(),
    empty: notEmpty(info.data) === null && !changeOwed,
    tagVerified: tag.sw === 0x9000,
    publicState: {
      unspent: info.data[3]!,
      spent: info.data[4]!,
      pin: info.data[7] !== 0,
      record: info.data[11] !== 0,
      owner: info.data[16] !== 0,
      changeOwed,
    },
  };
}
