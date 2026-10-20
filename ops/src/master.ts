/**
 * The master-key seam (D29, the plan's custody decision): v1 reads
 * OPS_MASTER_KEY from the runtime-injected environment — the phoenixd posture,
 * a dedicated droplet, never a prompt, never shell history (AGENTS.md).
 * A KMS/HSM behind this same interface is a config change, not a code change.
 */
export interface MasterSource {
  getMaster(): Buffer;
}

export class EnvMaster implements MasterSource {
  private cached: Buffer | null = null;

  getMaster(): Buffer {
    if (this.cached === null) {
      const hex = process.env.OPS_MASTER_KEY;
      if (!hex) {
        throw new Error('OPS_MASTER_KEY is not set in the environment');
      }
      const cleaned = hex.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length < 64) {
        throw new Error('OPS_MASTER_KEY must be at least 32 bytes of hex');
      }
      this.cached = Buffer.from(cleaned, 'hex');
    }
    return this.cached;
  }
}
