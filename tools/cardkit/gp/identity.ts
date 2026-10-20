/**
 * Read-only chip identity for ENG-741 (D31). Public CPLC fields guard against
 * accidental card substitution; they are not ownership authentication.
 */
import {ISD_AID} from './aids';
import {type Bytes, bytes, toHex} from './bytes';
import {CardError, selectAid, transmit, type Transceiver} from './scp02';

export interface ChipIdentity {
  readonly id: string;
  readonly icFabricator: string;
  readonly icType: string;
  readonly icFabricationDate: string;
  readonly icSerialNumber: string;
  readonly icBatchIdentifier: string;
}

/** Parse exactly the 9F7F/42-byte CPLC TLV, without a status word. */
export function parseCplc(data: Bytes): ChipIdentity {
  const b = bytes(data);
  if (b.length !== 45 || b[0] !== 0x9f || b[1] !== 0x7f || b[2] !== 42) {
    throw new RangeError('CPLC must be a 9F7F TLV with exactly 42 data bytes');
  }
  const serial = b.slice(15, 19);
  if (
    serial.every(value => value === 0) ||
    serial.every(value => value === 255)
  ) {
    throw new RangeError('CPLC serial is unset');
  }
  const hex = (start: number, end: number) =>
    toHex(b.slice(3 + start, 3 + end)).toLowerCase();
  const fields = {
    icFabricator: hex(0, 2),
    icType: hex(2, 4),
    icFabricationDate: hex(10, 12),
    icSerialNumber: hex(12, 16),
    icBatchIdentifier: hex(16, 18),
  };
  return {
    id: `cplc-v1:${fields.icFabricator}${fields.icType}${fields.icFabricationDate}${fields.icSerialNumber}${fields.icBatchIdentifier}`,
    ...fields,
  };
}

export class ChipIdentityMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super('the presented chip does not match the saved attempt');
    this.name = 'ChipIdentityMismatch';
  }
}

/** SELECT ISD then GET DATA only. No authentication, mutation or retries. */
export async function readChipIdentity(
  tx: Transceiver,
  expectedId?: string,
): Promise<ChipIdentity> {
  const selected = await transmit(tx, selectAid(ISD_AID));
  if (selected.sw !== 0x9000) {
    throw new CardError(selected.sw, 0xa4);
  }
  const reply = await transmit(tx, [0x80, 0xca, 0x9f, 0x7f, 0]);
  if (reply.sw !== 0x9000) {
    throw new CardError(reply.sw, 0xca);
  }
  const identity = parseCplc(reply.data);
  if (expectedId !== undefined && identity.id !== expectedId) {
    throw new ChipIdentityMismatch(expectedId, identity.id);
  }
  return identity;
}
