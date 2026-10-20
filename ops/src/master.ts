/**
 * The master-key seam (D29, the plan's custody decision): v1 reads
 * OPS_MASTER_KEY from the runtime-injected environment — on the droplet from
 * the process env, on Workers from a wrangler secret (`wrangler secret put`,
 * never shell history). A KMS/HSM behind this same interface is a config
 * change, not a code change.
 */
export interface MasterSource {
  getMaster(): Buffer;
}

/** Reads the named variable from the process env (Node: server, ops CLI). */
export class EnvMaster implements MasterSource {
  private cached: Buffer | null = null;

  constructor(
    /** Where the hex comes from; the process env by default. */
    private readonly read?: () => string | undefined,
  ) {}

  getMaster(): Buffer {
    if (this.cached === null) {
      const hex = this.read ? this.read() : process.env.OPS_MASTER_KEY;
      if (!hex) {
        throw new Error('OPS_MASTER_KEY is not set in the environment');
      }
      const cleaned = hex.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length < 64) {
        throw new Error('OPS_MASTER_KEY must be at least 32 bytes of hex');
      }
      this.cached = Buffer.from(cleaned, 'hex');
    }
    // The assignment above guarantees non-null; TS's narrowing does not
    // carry it across the branch, so assert here.
    return this.cached as Buffer;
  }
}
