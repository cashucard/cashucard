/**
 * Batch creation: the derive-and-escrow transaction. Keys for the whole batch
 * are derived and escrowed at batch creation (the prefetch-by-ordinal decision,
 * ENG-740's plan): the 9-11 s card-active window never waits on the network.
 * The one transaction is what makes "issued but unescrowed" unrepresentable.
 */
import {OpsDb} from './db';
import {deriveKeySet, newOrdinalSalt} from './keys';

export interface BatchInput {
  readonly count: number;
  readonly mintUrl: string;
  readonly pinPolicy: 'batch' | 'perCard';
  readonly pinBatch?: string;
  readonly dailyUsd: number;
  readonly noPinUsd: number;
  readonly loadSha256: string;
  readonly operatorId: number;
}

export interface BatchRow {
  readonly id: number;
  readonly ordinal_salt: Buffer;
  readonly count: number;
  readonly mint_url: string;
  readonly pin_policy: string;
  readonly pin_batch: string | null;
  readonly daily_usd: number;
  readonly no_pin_usd: number;
  readonly load_sha256: string;
  readonly operator_id: number;
  readonly created: number;
}

export function createBatch(db: OpsDb, input: BatchInput): BatchRow {
  if (input.count < 1 || input.count > 100_000) {
    throw new BatchError('count is 1..100000');
  }
  const salt = newOrdinalSalt(db.randomBytes);
  const created = db.now();
  const tx = db.db.transaction(() => {
    const info = db.db
      .prepare(
        `INSERT INTO key_batches
         (ordinal_salt, count, mint_url, pin_policy, pin_batch, daily_usd, no_pin_usd, load_sha256, operator_id, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        salt,
        input.count,
        input.mintUrl,
        input.pinPolicy,
        input.pinBatch ?? null,
        input.dailyUsd,
        input.noPinUsd,
        input.loadSha256,
        input.operatorId,
        created,
      );
    const batchId = Number(info.lastInsertRowid);
    const insert = db.db.prepare(
      `INSERT INTO issued_keys (batch_id, ordinal, enc, mac, dek, escrowed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (let ordinal = 0; ordinal < input.count; ordinal++) {
      // Derive with the master; a throw here (or anywhere in the transaction)
      // rolls the batch row back with it — the test forces one and proves it.
      const ks = deriveKeySet(requireMaster(db), salt, ordinal);
      insert.run(batchId, ordinal, ks.enc, ks.mac, ks.dek, created);
    }
    return batchId;
  });
  const batchId = tx();
  return getBatch(db, batchId) as BatchRow;
}

export class BatchError extends Error {}

/** The master from the DB's configured master source (the KMS seam, D29). */
export function requireMaster(db: OpsDb): Buffer {
  const master = db.master?.getMaster();
  if (!master || master.length < 32) {
    throw new BatchError(
      'the master key source is unset or shorter than 32 bytes',
    );
  }
  return master;
}

export function getBatch(db: OpsDb, id: number): BatchRow | undefined {
  return db.db.prepare('SELECT * FROM key_batches WHERE id = ?').get(id) as
    BatchRow | undefined;
}

export function listBatches(db: OpsDb): BatchRow[] {
  return db.db
    .prepare('SELECT * FROM key_batches ORDER BY id DESC')
    .all() as BatchRow[];
}
