/** Public personalization values for the existing 2.1 wire. No secrets or writes. */
import {bytes, equal, type Bytes} from './bytes';
import {CardError, transmit, type Transceiver} from './scp02';

export interface CardRecordConfiguration {
  /** Only the sat unit is supported by this integration. */
  unit: 0;
  /** Printable ASCII wire text, 1..77 bytes. Endpoint policy belongs to the caller. */
  mint: string;
  /** Compressed public-key framing or 33 zeros. Does not validate curve membership. */
  refundKey: Bytes;
  design: string | null;
}
export interface CardRecordObservation {
  recordSet: boolean;
  unit: number;
  mint: string;
  refundKey: number[];
  design: string | null;
  dailySats: number;
  hardestBits: number[];
  lastHeader: number[];
  rolls: number;
  rolloverBudget: number;
  allowanceArmed: boolean;
}
export interface OwnerLimits {
  dailySats: number;
  paymentSats: number;
  noPinSats: number;
  rolloverBudget: number;
}
function ascii(value: string, max: number, empty = false): number[] {
  if (
    typeof value !== 'string' ||
    (!empty && !value.length) ||
    value.length > max ||
    /[^\x21-\x7e]/.test(value)
  ) {
    throw new RangeError('invalid card text');
  }
  return Array.from(value, c => c.charCodeAt(0));
}
function refund(value: Bytes): number[] {
  const key = bytes(value);
  if (
    key.length !== 33 ||
    (!key.every(n => n === 0) && key[0] !== 2 && key[0] !== 3)
  ) {
    throw new RangeError('invalid refund public-key framing');
  }
  return key;
}
function design(value: string | null): number[] {
  if (value === null) return [0, 0, 0];
  if (!/^[A-Z0-9]{3}$/.test(value)) throw new RangeError('invalid card design');
  return ascii(value, 3);
}
function u32(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError('limit must be an unsigned 32-bit integer');
  }
  return [
    Math.floor(value / 0x1000000),
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}
function readU32(data: number[], at: number): number {
  return (
    data[at]! * 0x1000000 +
    data[at + 1]! * 0x10000 +
    data[at + 2]! * 256 +
    data[at + 3]!
  );
}
/** Value only: caller supplies any required owner proof and APDU framing. */
export function encodeCardRecord(config: CardRecordConfiguration): number[] {
  if (config.unit !== 0) throw new RangeError('unsupported card unit');
  const mint = ascii(config.mint, 77);
  return [
    config.unit,
    ...refund(config.refundKey),
    ...Array<number>(65).fill(0),
    mint.length,
    ...mint,
    ...design(config.design),
  ];
}
/** Exact GET_CARD 2.1 framing; reserved bytes are required to be zero. */
export function decodeCardRecord(value: Bytes): CardRecordObservation {
  const data = bytes(value);
  const length = data[105];
  if (
    data[0] !== 4 ||
    length === undefined ||
    length > 77 ||
    data.length !== 109 + length ||
    ![0, 1].includes(data[1]!) ||
    ![0, 1].includes(data[78]!) ||
    data[77]! > 30 ||
    data.slice(79, 105).some(n => n !== 0)
  ) {
    throw new RangeError('malformed GET_CARD response');
  }
  const mint = String.fromCharCode(...data.slice(106, 106 + length));
  ascii(mint, 77, data[1] === 0);
  const code = data.slice(106 + length);
  const cardDesign = code.every(n => n === 0)
    ? null
    : String.fromCharCode(...code);
  design(cardDesign);
  return {
    recordSet: data[1] === 1,
    unit: data[2]!,
    mint,
    refundKey: refund(data.slice(7, 40)),
    design: cardDesign,
    dailySats: readU32(data, 3),
    hardestBits: data.slice(40, 44),
    lastHeader: data.slice(44, 76),
    rolls: data[76]!,
    rolloverBudget: data[77] || 7,
    allowanceArmed: data[78] === 1,
  };
}
/** Checks record fields only, never owner identity, PIN, limits or payment readiness. */
export function assertCardRecordMatches(
  expected: CardRecordConfiguration,
  observed: CardRecordObservation,
): void {
  encodeCardRecord(expected); // validate before comparing any claimed success
  if (!observed.recordSet) throw new Error('card record is not set');
  if (observed.unit !== expected.unit) throw new Error('card unit mismatch');
  if (observed.mint !== expected.mint) throw new Error('card mint mismatch');
  if (!equal(observed.refundKey, expected.refundKey))
    throw new Error('card refund key mismatch');
  if (observed.design !== expected.design)
    throw new Error('card design mismatch');
}
/** Full 13-byte SET_LIMIT value, without proof or command execution. */
export function encodeOwnerLimits(limits: OwnerLimits): number[] {
  if (
    !Number.isInteger(limits.rolloverBudget) ||
    limits.rolloverBudget < 1 ||
    limits.rolloverBudget > 30
  ) {
    throw new RangeError('rollover budget must be 1..30');
  }
  return [
    ...u32(limits.dailySats),
    ...u32(limits.paymentSats),
    ...u32(limits.noPinSats),
    limits.rolloverBudget,
  ];
}
/** Caller must already have selected/identified the applet. No SELECT clears grants. */
export async function readCardRecord(
  tx: Transceiver,
): Promise<CardRecordObservation> {
  const reply = await transmit(tx, [0xb0, 0x16, 0, 0, 0]);
  if (reply.sw !== 0x9000) throw new CardError(reply.sw, 0x16);
  return decodeCardRecord(reply.data);
}
