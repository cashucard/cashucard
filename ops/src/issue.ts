/**
 * Key issuance (the /keys/issue handler's rules): the set is already escrowed
 * at batch creation, so issuing is a read of issued_keys — plus the scope
 * rules the plan fixes. An operator may issue for any ordinal of any batch.
 * Holder issuance is disabled until consumer card authorization exists (D30).
 */
import {OpsDb} from './db';
import {assertIndependentBackup} from './recovery-evidence';

export interface IssuedKeysRow {
  readonly batch_id: number;
  readonly ordinal: number;
  readonly enc: Buffer;
  readonly mac: Buffer;
  readonly dek: Buffer;
  readonly escrowed_at: number;
}

export type IssueResult =
  | {ok: true; keys: IssuedKeysRow}
  | {
      ok: false;
      reason:
        | 'no-such-batch'
        | 'no-such-ordinal'
        | 'already-issued'
        | 'rate-limited'
        | 'holder-disabled';
    };

export type IssueScope =
  {kind: 'operator'} | {kind: 'holder'; tokenHash: string};

/** Holder one-shot + rate-limit state, per process; keyed by token hash. */
export class HolderIssueState {
  private readonly issued = new Map<string, string>(); // "batch:ordinal" -> tokenHash
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow = 60,
    private readonly windowSeconds = 3600,
  ) {}

  private rateLimited(now: number, tokenHash: string): boolean {
    const hits = (this.hits.get(tokenHash) ?? []).filter(
      t => now - t < this.windowSeconds,
    );
    if (hits.length >= this.maxPerWindow) {
      this.hits.set(tokenHash, hits);
      return true;
    }
    hits.push(now);
    this.hits.set(tokenHash, hits);
    return false;
  }

  /**
   * Claims the holder's right to this ordinal. Distinct outcomes so the
   * response can say which: one-shot already spent (to any holder token),
   * or the rate window full.
   */
  claim(
    now: number,
    batchId: number,
    ordinal: number,
    tokenHash: string,
  ): 'claimed' | 'already-issued' | 'rate-limited' {
    if (this.rateLimited(now, tokenHash)) {
      return 'rate-limited';
    }
    const marker = `${batchId}:${ordinal}`;
    const seen = this.issued.get(marker);
    if (seen !== undefined && seen !== tokenHash) {
      return 'already-issued';
    }
    if (seen === undefined) {
      this.issued.set(marker, tokenHash);
    }
    return 'claimed';
  }
}

export function issueKeys(
  db: OpsDb,
  batchId: number,
  ordinal: number,
  scope: IssueScope,
  _holderState: HolderIssueState,
): IssueResult {
  return db.db.transaction(() => {
    assertIndependentBackup(db);
    return readIssuedKeys(db, batchId, ordinal, scope);
  });
}

function readIssuedKeys(
  db: OpsDb,
  batchId: number,
  ordinal: number,
  scope: IssueScope,
): IssueResult {
  if (scope.kind !== 'operator') {
    return {ok: false, reason: 'holder-disabled'};
  }
  const batch = db.db
    .prepare('SELECT id, count FROM key_batches WHERE id = ?')
    .get(batchId) as {id: number; count: number} | undefined;
  if (!batch) {
    return {ok: false, reason: 'no-such-batch'};
  }
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= batch.count) {
    return {ok: false, reason: 'no-such-ordinal'};
  }
  const keys = db.db
    .prepare('SELECT * FROM issued_keys WHERE batch_id = ? AND ordinal = ?')
    .get(batchId, ordinal) as IssuedKeysRow | undefined;
  if (!keys) {
    // Unreachable while every batch creation escrowed its full range; kept so
    // the type is honest and the test can pin it.
    return {ok: false, reason: 'no-such-ordinal'};
  }
  // The DO's SqlStorage returns BLOBs as ArrayBuffer, not Buffer (the seam's
  // one dtype difference); normalize so every caller's .toString('hex') and
  // byte checks see the same shape on both backends.
  return {
    ok: true,
    keys: {
      ...keys,
      enc: Buffer.from(keys.enc),
      mac: Buffer.from(keys.mac),
      dek: Buffer.from(keys.dek),
    },
  };
}
