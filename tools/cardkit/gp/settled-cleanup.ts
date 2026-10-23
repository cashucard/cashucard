/** Empty-card spent-entry cleanup. Private proof/PIN material stays in this call. */
import {secp256k1, schnorr} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha256';
import {CARD_AID, TAG_AID} from './aids';
import {equal, toHex} from './bytes';
import {readChipIdentity} from './identity';
import {
  CardError,
  selectAid,
  transmit,
  type Random,
  type Transceiver,
} from './scp02';

export interface ResetReview {
  chipId: string;
  installationId: string;
  unspent: number;
  spent: number;
  owner: boolean;
  pin: boolean;
  pinBlocked: boolean;
  tries: number;
  locked: boolean;
  record: boolean;
  tag: boolean;
  sealed: boolean;
  mint: string;
  /** Public record commitment, including refund key, limits and header. */
  recordDigest: string;
}
export class CleanupError extends Error {
  constructor(readonly code: string) {
    super('Card preparation stopped');
  }
}
function stop(code: string): never {
  throw new CleanupError(code);
}
const hex = (v: ArrayLike<number>) => toHex(v).toLowerCase();
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));
const digest = (a: number[]) => hex(sha256(Uint8Array.from(a)));
const u32 = (a: number[], at: number) =>
  a[at]! * 0x1000000 + (a[at + 1]! << 16) + (a[at + 2]! << 8) + a[at + 3]!;
const point = (s: string) => {
  try {
    return (
      s.length === 66 &&
      /^[0-9a-f]+$/.test(s) &&
      !!secp256k1.ProjectivePoint.fromHex(s)
    );
  } catch {
    return false;
  }
};
const send = async (tx: Transceiver, a: number[]) => {
  const r = await transmit(tx, a);
  if (r.sw !== 0x9000) throw new CardError(r.sw, a[1]!);
  return r.data;
};
function info(data: number[]) {
  if (
    data.length !== 30 ||
    data[0] !== 2 ||
    data[1] !== 1 ||
    data[2] !== 128 ||
    data[8] !== 4 ||
    data[3]! + data[4]! + data[5]! !== 128 ||
    ![0, 1, 2].includes(data[7]!) ||
    data[9]! > 3 ||
    [data[10], data[11], data[16]].some(v => v !== 0 && v !== 1)
  )
    stop('unsupported-card');
  return {
    unspent: data[3]!,
    spent: data[4]!,
    pin: data[7] !== 0,
    pinBlocked: data[7] === 2,
    tries: data[9]!,
    locked: data[10] === 1,
    record: data[11] === 1,
    owner: data[16] === 1,
    sealed: !!(data[6]! & 0x80),
  };
}
async function snapshot(
  tx: Transceiver,
  expected?: Pick<ResetReview, 'chipId' | 'installationId'>,
) {
  const chip = await readChipIdentity(tx, expected?.chipId);
  if (!equal(await send(tx, selectAid(CARD_AID)), [2, 1]))
    stop('unsupported-card');
  const state = info(await send(tx, [0xb0, 1, 0, 0, 0]));
  const installationId = hex(await send(tx, [0xb0, 0x10, 0, 0, 0x21]));
  if (
    !point(installationId) ||
    (expected && installationId !== expected.installationId)
  )
    stop('identity-mismatch');
  const record = await send(tx, [0xb0, 0x16, 0, 0, 0]);
  if (
    record.length < 109 ||
    record.length !== 109 + record[105]! ||
    record[0] !== 4 ||
    record[1] !== Number(state.record)
  )
    stop('record-invalid');
  const recordedMint = String.fromCharCode(
    ...record.slice(106, 106 + record[105]!),
  );
  // Persist only a safe HTTPS origin, never credentials/query data from a card record.
  const mint =
    /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?\/?$/i.test(
      recordedMint,
    )
      ? recordedMint
      : '';
  const selected = await transmit(tx, selectAid(TAG_AID));
  if (![0x9000, 0x6a82].includes(selected.sw))
    throw new CardError(selected.sw, 0xa4);
  const review: ResetReview = {
    chipId: chip.id,
    installationId,
    ...state,
    mint,
    tag: selected.sw === 0x9000,
    recordDigest: digest(record),
  };
  // Return to the card; SELECT deliberately removes any prior grants.
  if (!equal(await send(tx, selectAid(CARD_AID)), [2, 1]))
    stop('unsupported-card');
  return {review, record};
}
/** No authentication, network or mutation. The UI sees public metadata only. */
export async function readResetReview(tx: Transceiver): Promise<ResetReview> {
  return (await snapshot(tx)).review;
}
function match(
  actual: ResetReview,
  expected: ResetReview,
  allowEmpty = false,
  allowReduced = false,
) {
  const a = actual.spent,
    b = expected.spent;
  if (
    Object.keys(actual)
      .filter(k => k !== 'spent' && k !== 'tries')
      .some(
        k =>
          actual[k as keyof ResetReview] !== expected[k as keyof ResetReview],
      ) ||
    (a !== b && !(allowEmpty && a === 0) && !(allowReduced && a < b))
  )
    stop('card-changed');
}
/** Protocol 2.1 sealed PIN, compatible with Flash/Foxy; no clear-text fallback. */
export function sealResetPin(
  body: number[],
  installationId: string,
  pin: string,
  ephemeral: Uint8Array,
): number[] {
  if (
    !/^[0-9]{4,8}$/.test(pin) ||
    body.length !== 113 ||
    !point(installationId)
  )
    stop('pin-form-invalid');
  const nonce = body.slice(0, 16),
    key = body.slice(16, 49),
    signature = body.slice(49);
  if (
    !point(hex(key)) ||
    !schnorr.verify(
      Uint8Array.from(signature),
      sha256(Uint8Array.from([...ascii('CashuCard/pinkey'), ...key])),
      installationId.slice(2),
    )
  )
    stop('pin-key-untrusted');
  const pub = Array.from(secp256k1.getPublicKey(ephemeral, false));
  const shared = secp256k1
    .getSharedSecret(ephemeral, Uint8Array.from(key), true)
    .slice(1, 33);
  const head = [...shared, ...pub, ...nonce, 0x40];
  const block = (i: number, more: number[] = []) =>
    Array.from(
      sha256(
        Uint8Array.from([...ascii('CashuCard/seal'), i, ...head, ...more]),
      ),
    );
  const clear = [
    pin.length,
    ...ascii(pin),
    ...new Array(8 - pin.length).fill(0),
  ];
  const stream = block(1),
    encrypted = clear.map((b, i) => b ^ stream[i]!);
  clear.fill(0);
  shared.fill(0);
  return [...pub, ...encrypted, ...block(0, encrypted).slice(0, 16)];
}
export interface CleanupEvidence {
  chipId: string;
  installationId: string;
  spent: number;
  proofDigest: string;
}
export interface CleanupOptions {
  pin: string;
  random: Random;
  /** Only after a durable previous cleanup intent; remaining valid proofs are freshly audited. */
  resumePartial?: boolean;
  /** Bounded HTTPS, redirect-free JSON transport. Never receives PIN/manager keys. */
  mintJson(
    origin: string,
    path: '/v1/keysets' | '/v1/checkstate',
    body?: {Ys: string[]},
  ): Promise<unknown>;
  /** Await durable evidence before VERIFY_PIN or CLEAR_SPENT. No proof bytes/PIN. */
  persist(evidence: CleanupEvidence): Promise<void>;
}
/** One explicitly approved tap. Every invocation obtains fresh settlement evidence. */
export async function cleanupSettledEntries(
  tx: Transceiver,
  expected: ResetReview,
  options: CleanupOptions,
): Promise<ResetReview> {
  expected = {...expected}; // Freeze card-specific approval before the first await.
  const {review, record} = await snapshot(tx, expected);
  match(review, expected, true, options.resumePartial === true);
  if (review.unspent || review.locked || review.pinBlocked || !review.tag)
    stop('card-not-empty');
  if (!review.spent) return review;
  if (
    !review.pin ||
    !review.sealed ||
    !review.record ||
    review.tries === 0 ||
    !/^[0-9]{4,8}$/.test(options.pin)
  )
    stop('holder-pin-required');
  if (
    !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?\/?$/i.test(
      review.mint,
    ) ||
    record[2] !== 0
  )
    stop('mint-unsupported');
  const origin = review.mint.replace(/\/$/, '');
  const bitmap = await send(tx, [0xb0, 0x14, 0, 0, 0x80]);
  if (
    bitmap.length !== 128 ||
    bitmap.some(v => v !== 0 && v !== 2) ||
    bitmap.filter(v => v === 2).length !== review.spent
  )
    stop('slot-state-invalid');
  const raw: number[][] = [],
    prefixes: string[] = [],
    Ys: string[] = [];
  for (let slot = 0; slot < 128; slot++) {
    if (bitmap[slot] !== 2) continue;
    const p = await send(tx, [0xb0, 0x13, slot, 0, 0x52]);
    if (p.length !== 82 || p[0] !== 2 || !point(hex(p.slice(45, 78))))
      stop('proof-invalid');
    const amount = u32(p, 9),
      date = u32(p, 78),
      refund = hex(record.slice(7, 40));
    if (
      !amount ||
      !Number.isInteger(Math.log2(amount)) ||
      amount > 0x80000000 ||
      (date && !point(refund))
    )
      stop('proof-invalid');
    const secret =
      '["P2PK",{"nonce":"' +
      hex(p.slice(13, 45)) +
      '","data":"' +
      review.installationId +
      '","tags":[' +
      (date ? '["locktime","' + date + '"],["refund","' + refund + '"],' : '') +
      '["sigflag","SIG_ALL"]]}]';
    const msg = sha256(
      Uint8Array.from([
        ...ascii('Secp256k1_HashToCurve_Cashu_'),
        ...ascii(secret),
      ]),
    );
    let Y: string | undefined;
    for (let i = 0; i < 65536; i++) {
      const candidate =
        '02' +
        hex(sha256(Uint8Array.from([...msg, i & 255, (i >>> 8) & 255, 0, 0])));
      if (point(candidate)) {
        Y = candidate;
        break;
      }
    }
    if (!Y || Ys.includes(Y)) stop('proof-invalid');
    raw.push(p);
    prefixes.push(hex(p.slice(1, 9)));
    Ys.push(Y);
  }
  const metadata = (await options.mintJson(origin, '/v1/keysets')) as {
    keysets?: {id: string; unit: string}[];
  };
  if (!Array.isArray(metadata?.keysets)) stop('mint-keysets-invalid');
  for (const prefix of prefixes) {
    const matches = metadata.keysets.filter(
      k =>
        k &&
        typeof k.id === 'string' &&
        /^(?:[0-9a-f]{16}|[0-9a-f]{66})$/.test(k.id) &&
        k.id.startsWith(prefix),
    );
    if (matches.length !== 1 || matches[0]!.unit !== 'sat')
      stop('mint-keyset-unresolved');
  }
  const response = (await options.mintJson(origin, '/v1/checkstate', {Ys})) as {
    states?: {Y: string; state: string}[];
  };
  if (
    !Array.isArray(response?.states) ||
    response.states.length !== Ys.length ||
    new Set(response.states.map(s => s?.Y)).size !== Ys.length ||
    response.states.some(s => !s || !Ys.includes(s.Y) || s.state !== 'SPENT')
  )
    stop('settlement-pending');
  // Detect a changed record, identity or slot while waiting for the mint.
  const fresh = await snapshot(tx, review);
  match(fresh.review, review);
  if (!equal(await send(tx, [0xb0, 0x14, 0, 0, 0x80]), bitmap))
    stop('card-changed');
  let index = 0;
  for (let slot = 0; slot < 128; slot++)
    if (bitmap[slot] === 2) {
      if (!equal(await send(tx, [0xb0, 0x13, slot, 0, 0x52]), raw[index++]!))
        stop('card-changed');
    }
  await options.persist({
    chipId: review.chipId,
    installationId: review.installationId,
    spent: review.spent,
    proofDigest: digest(raw.flat()),
  });
  const ephemeral = Uint8Array.from(options.random(32));
  let envelope: number[];
  try {
    envelope = sealResetPin(
      await send(tx, [0xb0, 0x44, 1, 0, 0]),
      review.installationId,
      options.pin,
      ephemeral,
    );
  } finally {
    ephemeral.fill(0);
  }
  try {
    await send(tx, [0xb0, 0x40, 1, 0, envelope.length, ...envelope]);
  } finally {
    envelope.fill(0);
  }
  const cleared = await send(tx, [0xb0, 0x31, 0, 0, 1]);
  if (cleared.length !== 1 || cleared[0] !== review.spent)
    stop('cleanup-unconfirmed');
  const after = await snapshot(tx, review);
  match(after.review, review, true);
  if (
    after.review.spent !== 0 ||
    (await send(tx, [0xb0, 0x14, 0, 0, 0x80])).some(v => v !== 0)
  )
    stop('cleanup-unconfirmed');
  return after.review;
}
