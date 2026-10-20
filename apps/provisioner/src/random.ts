/**
 * Random bytes for the host challenge, from crypto.getRandomValues
 * (react-native-get-random-values, the first import in index.js).
 */
interface Crypto {
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function randomBytes(length: number): number[] {
  const crypto = (globalThis as unknown as {crypto?: Crypto}).crypto;
  if (!crypto) {
    throw new Error(
      'crypto.getRandomValues is missing: react-native-get-random-values must be imported first',
    );
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(length)));
}

/** Canonical UUID v4 for durable request/device identities. */
export function randomUuid(): string {
  const bytes = randomBytes(16);
  // UUID version/variant bits, retaining the remaining CSPRNG output.
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
