/**
 * The password-hash seam (the ENG-740 Workers amendment): operator passwords
 * verify through this interface, whose stored string carries its algorithm
 * and parameters so old rows keep verifying after the backend changes.
 *
 * Implementations:
 *  - `node` — scrypt (node:crypto), what the first deploy wrote. The Node
 *    server and the ops CLI use it.
 *  - `native` — Workers' native scrypt 16384/8/5 (D103), with exact legacy
 *    verification and one-time successful-login migration.
 *  - `subtle` — legacy PBKDF2-SHA256 over WebCrypto (`crypto.subtle.deriveBits`),
 *    600k iterations, OWASP's 2023 floor for PBKDF2-SHA256 and the path the
 *    legacy Durable Object format. Native WebCrypto is preferred; the deployed
 *    iteration-cap error uses the pinned noble implementation (D52).
 *
 * The stored format: `scrypt$N$r$p$salt$hash` or `pbkdf2$iter$salt$hash`,
 * hex salt and hash. Verify dispatches on the prefix; hash always writes the
 * backend the process is running on. Timing-safe compare on both paths.
 */
import {randomBytes, scrypt, scryptSync, timingSafeEqual} from 'node:crypto';
import {pbkdf2Async} from '@noble/hashes/pbkdf2';
import {scryptAsync} from '@noble/hashes/scrypt';
import {sha256} from '@noble/hashes/sha256';

/** Which backend this process hashes with; verification is format-driven. */
export type PwHashBackend = 'node' | 'subtle';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  /** Called only after verification; null retains the original hash. */
  upgrade?(password: string, stored: string): Promise<string | null>;
}

const PBKDF2_ITERATIONS = 600_000;
const KEY_LEN = 64;
export const NATIVE_SCRYPT_PROFILE = Object.freeze({
  N: 16384,
  r: 8,
  p: 5,
  maxmem: 32 * 1024 * 1024,
});
type ScryptDeriver = (
  password: string,
  salt: Uint8Array,
) => Promise<Uint8Array>;
const nativeScrypt: ScryptDeriver = (password, salt) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, NATIVE_SCRYPT_PROFILE, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
const costLimited = (e: unknown) =>
  e instanceof RangeError &&
  e.message.startsWith('Scrypt failed: cost exceeds maximum');

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

/** Workers: native memory-hard hashing; old formats remain readable unchanged. */
export class NativePwHash extends NodePwHash {
  private available = true;
  constructor(private derive: ScryptDeriver = nativeScrypt) {
    super();
  }
  private async nativeHash(password: string): Promise<string | null> {
    if (!this.available) return null;
    const salt = randomBytes(16);
    try {
      const key = await this.derive(password, salt);
      if (key.length !== KEY_LEN)
        throw new Error('Invalid password KDF result');
      return `scrypt$16384$8$5$${toHex(salt)}$${toHex(key)}`;
    } catch (error) {
      // No work-factor reduction when an edge applies an additional native cap.
      if (!costLimited(error)) throw error;
      this.available = false;
      return null;
    }
  }
  override async hash(password: string): Promise<string> {
    return (
      (await this.nativeHash(password)) ?? new SubtlePwHash().hash(password)
    );
  }
  async upgrade(password: string, stored: string): Promise<string | null> {
    // Upgrade only formats this application actually issued; do not replace
    // arbitrary stronger/custom costs based on a format prefix alone.
    if (
      !/^(?:pbkdf2\$600000\$[0-9a-f]{32}\$[0-9a-f]{128}|scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128})$/.test(
        stored,
      )
    )
      return null;
    return this.nativeHash(password);
  }
}

/** The Workers backend: PBKDF2-SHA256, retaining the 600k work factor. */
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
  try {
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
  } catch (error) {
    // Deployed workerd may cap native PBKDF2 at 100k even when local
    // workerd accepts 600k. Preserve the exact KDF, work factor and format.
    if (
      !(error instanceof Error) ||
      error.name !== 'NotSupportedError' ||
      !error.message.includes('iteration counts above 100000 are not supported')
    ) {
      throw error;
    }
    return pbkdf2Async(sha256, password, salt, {
      c: iterations,
      dkLen: KEY_LEN,
    });
  }
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
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    !/^[0-9a-f]{32}$/.test(saltHex!) ||
    !/^[0-9a-f]{128}$/.test(hashHex!)
  ) {
    return false;
  }
  const expected = fromHex(hashHex!);
  const actual = await derivePbkdf2(password, fromHex(saltHex!), iterations);
  return timingSafeEqualLen(expected, actual);
}

async function verifyScrypt(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (!/^[0-9a-f]{32}$/.test(saltHex!) || !/^[0-9a-f]{128}$/.test(hashHex!))
    return false;
  const expected = fromHex(hashHex!);
  const profile = {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: 64 * 1024 * 1024,
  };
  let actual: Uint8Array;
  try {
    actual = scryptSync(password, fromHex(saltHex!), expected.length, profile);
  } catch (error) {
    if (!costLimited(error)) throw error;
    // A migrated credential remains readable after a deployment/backend change.
    // The JS fallback preserves every parameter; it cannot lower the KDF cost.
    actual = await scryptAsync(password, fromHex(saltHex!), {
      ...profile,
      dkLen: expected.length,
    });
  }
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
