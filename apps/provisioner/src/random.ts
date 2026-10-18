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
