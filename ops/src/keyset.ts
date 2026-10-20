/**
 * The per-card key set, shaped exactly as tools/cardkit/gp/scp02.ts's KeySet:
 * three 16-byte DES3 keys. The service derives and escrows them; the shape is
 * the contract with the provisioner's /keys/issue response.
 */
export interface KeySet {
  readonly enc: Buffer;
  readonly mac: Buffer;
  readonly dek: Buffer;
}
