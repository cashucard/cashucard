/** Holder-wallet owner commands. No private keys, PINs, manager login or retries. */
import {CARD_AID} from './aids';
import {bytes, equal, fromHex, type Bytes} from './bytes';
import {
  encodeCardRecord,
  encodeOwnerLimits,
  type CardRecordConfiguration,
  type OwnerLimits,
} from './configuration';
import {readChipIdentity} from './identity';
import {
  CardError,
  TransportError,
  selectAid,
  transmit,
  type Reply,
  type Transceiver,
} from './scp02';

export interface HolderCommandContext {
  readonly chipId: string;
  readonly installationId: string;
  readonly configurationId: string;
  /** Wallet-owned key lookup reference; never a private key. */
  readonly ownerKeyReference: string;
}
export type HolderCommand =
  | {kind: 'set-card'; configuration: CardRecordConfiguration}
  | {kind: 'set-limits'; limits: OwnerLimits}
  | {kind: 'allow-load'};
export interface OwnerSigningRequest extends HolderCommandContext {
  readonly purpose:
    'CashuCard/set-card' | 'CashuCard/set-limit' | 'CashuCard/load';
  readonly nonce: readonly number[];
  readonly value: readonly number[];
  /** Exact unhashed label || nonce || value. Sign P-256/SHA-256 once, DER output. */
  readonly message: readonly number[];
}
export interface HolderCommandIntent extends HolderCommandContext {
  readonly purpose: OwnerSigningRequest['purpose'];
  readonly value: readonly number[];
}
export interface HolderCommandOptions {
  /** Wallet checks its key reference, context and approved operation before signing. */
  sign(request: OwnerSigningRequest): Promise<Bytes>;
  /** Must commit the exact nonsecret intent or reject before the owner write. */
  saveIntent(intent: HolderCommandIntent): Promise<void>;
  /** Actor/session generation guard; checked after each async boundary. */
  canContinue(): boolean;
}
const active = new WeakSet<Transceiver>();
function operation(command: HolderCommand): {
  ins: number;
  purpose: OwnerSigningRequest['purpose'];
  value: number[];
} {
  switch (command.kind) {
    case 'set-card':
      return {
        ins: 0x32,
        purpose: 'CashuCard/set-card',
        value: encodeCardRecord(command.configuration),
      };
    case 'set-limits':
      return {
        ins: 0x34,
        purpose: 'CashuCard/set-limit',
        value: encodeOwnerLimits(command.limits),
      };
    case 'allow-load':
      return {ins: 0x45, purpose: 'CashuCard/load', value: []};
    default:
      throw new RangeError('unsupported holder command');
  }
}
/** Strict positive P-256 DER scalars; the card verifies the actual signature. */
function signature(value: Bytes): number[] {
  const p = bytes(value);
  if (p.length < 8 || p.length > 72 || p[0] !== 0x30 || p[1] !== p.length - 2)
    throw new RangeError('invalid owner proof');
  let at = 2;
  for (let i = 0; i < 2; i++) {
    if (p[at++] !== 2) throw new RangeError('invalid owner proof');
    const n = p[at++];
    if (n === undefined || n < 1 || n > 33 || at + n > p.length)
      throw new RangeError('invalid owner proof');
    const scalar = p.slice(at, at + n);
    at += n;
    if (scalar[0]! & 128 || (n > 1 && scalar[0] === 0 && scalar[1]! < 128))
      throw new RangeError('invalid owner proof');
    const x = BigInt(
      '0x' + scalar.map(b => b.toString(16).padStart(2, '0')).join(''),
    );
    if (
      x === 0n ||
      x >= 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
    )
      throw new RangeError('invalid owner proof');
  }
  if (at !== p.length) throw new RangeError('invalid owner proof');
  return p;
}
/**
 * One approved setup command on an empty, already owned card. Establishes identity
 * before requesting a fresh nonce; SELECT clears prior grants. After success the
 * caller must read back and durably observe state before claiming completion.
 * Caller owns the NFC session and must not run unrelated APDUs while signing.
 */
export async function executeHolderCommand(
  tx: Transceiver,
  context: HolderCommandContext,
  command: HolderCommand,
  options: HolderCommandOptions,
): Promise<Reply> {
  if (
    !/^cplc-v1:[0-9a-f]{24}$/.test(context.chipId) ||
    !/^(02|03)[0-9a-f]{64}$/.test(context.installationId) ||
    !/^[0-9a-f]{64}$/.test(context.configurationId) ||
    typeof context.ownerKeyReference !== 'string' ||
    context.ownerKeyReference.length < 1 ||
    context.ownerKeyReference.length > 128
  )
    throw new RangeError('invalid holder command context');
  const op = operation(command); // snapshot caller values before any await
  const intent: HolderCommandIntent = Object.freeze({
    chipId: context.chipId,
    installationId: context.installationId,
    configurationId: context.configurationId,
    ownerKeyReference: context.ownerKeyReference,
    purpose: op.purpose,
    value: Object.freeze(op.value),
  });
  if (active.has(tx)) throw new Error('holder command already active');
  active.add(tx);
  const check = () => {
    if (!options.canContinue())
      throw new TransportError('Holder operation cancelled');
  };
  const guarded: Transceiver = async a => {
    check();
    const reply = await tx(a);
    check();
    return reply;
  };
  const send = async (a: number[]) => {
    const reply = await transmit(guarded, a);
    if (reply.sw !== 0x9000) throw new CardError(reply.sw, a[1]!);
    return reply;
  };
  try {
    await readChipIdentity(guarded, intent.chipId);
    if (!equal((await send(selectAid(CARD_AID))).data, [2, 1]))
      throw new RangeError('unsupported applet version');
    if (
      !equal(
        (await send([0xb0, 0x10, 0, 0, 0x21])).data,
        fromHex(intent.installationId),
      )
    )
      throw new Error('installation identity mismatch');
    const info = (await send([0xb0, 1, 0, 0, 0])).data;
    if (
      info.length !== 30 ||
      info[0] !== 2 ||
      info[1] !== 1 ||
      info[3] !== 0 ||
      info[4] !== 0 ||
      info[10] !== 0 ||
      info[16] !== 1
    )
      throw new Error('holder setup requires an empty unlocked owned card');
    await options.saveIntent(intent);
    check();
    const nonce = (await send([0xb0, 0x44, 0, 0, 0x10])).data;
    if (nonce.length !== 16) throw new RangeError('invalid owner nonce');
    const request: OwnerSigningRequest = Object.freeze({
      ...intent,
      nonce: Object.freeze(nonce),
      message: Object.freeze([
        ...Array.from(op.purpose, c => c.charCodeAt(0)),
        ...nonce,
        ...op.value,
      ]),
    });
    const proof = signature(await options.sign(request));
    check();
    const data = [proof.length, ...proof, ...op.value];
    if (data.length > 255)
      throw new RangeError('owner command exceeds short APDU');
    const reply = await send([0xb0, op.ins, 0, 0, data.length, ...data]);
    if (reply.data.length !== 0)
      throw new RangeError('unexpected owner command response');
    return reply;
  } finally {
    active.delete(tx);
  }
}
