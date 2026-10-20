/**
 * The password-hash seam (the ENG-740 Workers amendment): operator passwords
 * verify through this interface, whose stored string carries its algorithm
 * and parameters so old rows keep verifying after the backend changes.
 *
 * Two implementations:
 *  - `node` — scrypt (node:crypto), what the first deploy wrote. The Node
 *    server and the ops CLI use it.
 *  - `subtle` — PBKDF2-SHA256 over WebCrypto (`crypto.subtle.deriveBits`),
 *    600k iterations, OWASP's 2023 floor for PBKDF2-SHA256 and the path the
 *    Durable Object takes (no node:crypto on the Workers runtime without
 *    nodejs_compat; PBKDF2 is in the runtime's own WebCrypto).
 *
 * The stored format: `scrypt$N$r$p$salt$hash` or `pbkdf2$iter$salt$hash`,
 * hex salt and hash. Verify dispatches on the prefix; hash always writes the
 * backend the process is running on. Timing-safe compare on both paths.
 */
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';

/** Which backend this process hashes with; verification is format-driven. */
export type PwHashBackend = 'node' | 'subtle';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

const PBKDF2_ITERATIONS = 600_000;
const KEY_LEN = 64;

export class NodePwHash implements PasswordHasher {
  hash(password: string): Promise<string> {
    const salt = Buffer.from(randomBytes(16));
    const N = 16384;
    const r = 8;
    const p = 1;
    const hash = scryptSync(password, salt, KEY_LEN, {N, r, p});
    return Promise.resolve(
      `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`,
    );
  }

  async verify(password: string, stored: string): Promise<boolean> {
    if (stored.startsWith('pbkdf2$')) {
      return verifyPbkdf2(password, stored);
    }
    return verifyScrypt(password, stored);
  }
}

/** The Workers backend: PBKDF2-SHA256 over the runtime's WebCrypto. */
export class SubtlePwHash implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    if (stored.startsWith('scrypt$')) {
      return verifyScrypt(password, stored);
    }
    return verifyPbkdf2(password, stored);
  }
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations,
    },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

async function verifyPbkdf2(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const [, iterStr, saltHex, hashHex] = parts;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1) {
    return false;
  }
  const expected = fromHex(hashHex!);
  const actual = await derivePbkdf2(password, fromHex(saltHex!), iterations);
  return timingSafeEqualLen(expected, actual);
}

function verifyScrypt(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const expected = fromHex(hashHex!);
  const actual = scryptSync(password, fromHex(saltHex!), expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return timingSafeEqual(expected, actual);
}

function timingSafeEqualLen(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    // compare against self to keep the timing flat, then fail
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
