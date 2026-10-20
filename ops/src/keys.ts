/**
 * Per-card key derivation (D29): HKDF-SHA256 from the runtime-injected master,
 * salt = the batch's ordinal salt, info = "gp-enc"|"gp-mac"|"gp-dek" plus the
 * card's ordinal. Deterministic by construction — a lost response re-issues
 * byte-identical sets, which is the whole point of deriving rather than
 * generating (ops/test/keys.test.ts holds this).
 */
import {hkdf} from '@noble/hashes/hkdf';
import {sha256} from '@noble/hashes/sha2';

import type {KeySet} from './keyset';

const KEY_LEN = 16; // DES3 keys, what scp02.ts's KeySet carries

export const INFO_ENC = 'gp-enc';
export const INFO_MAC = 'gp-mac';
export const INFO_DEK = 'gp-dek';

/**
 * The key set for `ordinal` of the batch whose ordinal salt is `salt`.
 * Pure: same master+salt+ordinal in, same 48 bytes out, forever.
 */
export function deriveKeySet(
  master: Buffer,
  salt: Buffer,
  ordinal: number,
): KeySet {
  if (master.length < 32) {
    throw new Error('the master key is at least 32 bytes');
  }
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error('the ordinal is a non-negative integer');
  }
  const ord = Buffer.alloc(4);
  ord.writeUInt32BE(ordinal >>> 0);
  return {
    enc: Buffer.from(
      hkdf(
        sha256,
        master,
        salt,
        Buffer.concat([Buffer.from(INFO_ENC), ord]),
        KEY_LEN,
      ),
    ),
    mac: Buffer.from(
      hkdf(
        sha256,
        master,
        salt,
        Buffer.concat([Buffer.from(INFO_MAC), ord]),
        KEY_LEN,
      ),
    ),
    dek: Buffer.from(
      hkdf(
        sha256,
        master,
        salt,
        Buffer.concat([Buffer.from(INFO_DEK), ord]),
        KEY_LEN,
      ),
    ),
  };
}

/**
 * The batch's ordinal salt: 16 random bytes, generated once at batch creation
 * and stored on the batch row, so every derive in the batch shares it.
 */
export function newOrdinalSalt(randomBytes: (n: number) => Buffer): Buffer {
  return randomBytes(16);
}
