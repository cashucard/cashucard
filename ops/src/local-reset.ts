/** Local escrow recovery. Default invocation previews metadata and never opens PC/SC. */
import Database from 'better-sqlite3';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {OpsDb} from './db';
import {openSqliteFile} from './sqlite-file';
import {
  ProvisioningError,
  assertChipId,
  assertInstallationId,
} from './provisioning';
import {
  authorizeResetIntent,
  getResetIntent,
  issueResetKeys,
} from './reset-intents';
import {completeReset} from './reset-results';
import {openResetReader, ResetReaderError} from './pcsc-reset';
import {
  assessResetPreflight,
  inspectInstallation,
  readChipIdentity,
  resetOwnedCard,
  CardError,
  ChipIdentityMismatch,
  InspectionError,
  TransportError,
  type ResetStage as CardResetStage,
} from '../../tools/cardkit';
import {
  loadResetJournal,
  writeResetJournal,
  type ResetJournal,
} from '../../apps/provisioner/src/resetJournal';
import type {JournalStorage} from '../../apps/provisioner/src/journal';

export interface LocalResetOptions {
  db: string;
  journal: string;
  origin: string;
  operatorId: number;
  chipId: string;
  installationId: string;
  sourceAttemptId: string;
  reader: string;
  python: string;
}
interface SourceRow {
  batch_id: number;
  ordinal: number;
  operator_id: number;
  key_env: 'factory' | 'issued';
  escrow_present: number;
}
export class LocalResetFailure extends Error {
  constructor(
    readonly phase: string,
    readonly code: string,
    readonly sw?: number,
    readonly ins?: number,
  ) {
    super('local reset stopped; retain its journal and source backup');
  }
}
function protectedFile(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('unsafe local file');
}
function sourceRow(
  db: Database.Database,
  options: LocalResetOptions,
): SourceRow {
  assertChipId(options.chipId);
  assertInstallationId(options.installationId);
  const row = db
    .prepare(
      `SELECT a.batch_id,a.ordinal,a.operator_id,o.key_env,
    EXISTS(SELECT 1 FROM issued_keys k WHERE k.batch_id=a.batch_id AND k.ordinal=a.ordinal) AS escrow_present
    FROM provisioning_attempts a JOIN provisioning_records r ON r.attempt_id=a.attempt_id
    JOIN operators o ON o.id=a.operator_id
    WHERE a.attempt_id=? AND a.chip_id=? AND r.installation_id=? AND a.state='recorded' AND a.operator_id=?`,
    )
    .get(
      options.sourceAttemptId,
      options.chipId,
      options.installationId,
      options.operatorId,
    ) as SourceRow | undefined;
  if (
    !row ||
    row.escrow_present !== 1 ||
    !['factory', 'issued'].includes(row.key_env) ||
    db
      .prepare(
        "SELECT 1 FROM provisioning_attempts WHERE chip_id=? AND state IN ('active','quarantined','abandoned')",
      )
      .get(options.chipId)
  )
    throw new Error('local source requires reconciliation');
  return row;
}
export function previewLocalReset(options: LocalResetOptions) {
  if (!/^http:\/\/127\.0\.0\.1(?::[1-9][0-9]{0,4})?$/.test(options.origin))
    throw new Error('local recovery requires the historical loopback origin');
  protectedFile(options.db);
  const db = new Database(options.db, {readonly: true, fileMustExist: true});
  try {
    const row = sourceRow(db, options);
    return {
      mode: 'metadata-preview',
      chip_id: options.chipId,
      installation_id: options.installationId,
      source_attempt_id: options.sourceAttemptId,
      operator_id: row.operator_id,
      key_env: row.key_env,
      escrow_present: true,
      card_accessed: false,
      writes_permitted: false,
    };
  } finally {
    db.close();
  }
}
function atomicWrite(path: string, value: string): void {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  const parent = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
async function backupSource(
  options: LocalResetOptions,
  fingerprint: string,
  row: SourceRow,
): Promise<void> {
  const destination = options.journal + '.source-backup.db';
  if (existsSync(destination)) {
    protectedFile(destination);
    const backup = new Database(destination, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (
        backup.pragma('quick_check', {simple: true}) !== 'ok' ||
        JSON.stringify(sourceRow(backup, options)) !== JSON.stringify(row)
      )
        throw new Error('invalid source backup');
    } finally {
      backup.close();
    }
    return;
  }
  const temporary = destination + '.' + fingerprint.slice(0, 12) + '.tmp';
  if (existsSync(temporary))
    throw new Error('incomplete source backup requires review');
  const source = new Database(options.db, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(temporary);
  } finally {
    source.close();
  }
  chmodSync(temporary, 0o600);
  const fd = openSync(temporary, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, destination);
  const parent = openSync(dirname(destination), constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
/** Uses the same journal and reset domains as the phone. Tests inject a fake transport. */
export async function executeLocalReset(
  options: LocalResetOptions,
  connect: typeof openResetReader = openResetReader,
) {
  process.umask(0o077);
  previewLocalReset(options);
  const parent = dirname(options.journal);
  mkdirSync(parent, {recursive: true, mode: 0o700});
  const directory = lstatSync(parent);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    directory.uid !== process.getuid?.()
  )
    throw new Error('unsafe recovery directory');
  const lock = openSync(options.journal + '.lock', 'wx', 0o600);
  let service: OpsDb | undefined,
    reader: Awaited<ReturnType<typeof openResetReader>> | undefined;
  let phase = 'source';
  try {
    protectedFile(options.db);
    const source = new Database(options.db, {
      readonly: true,
      fileMustExist: true,
    });
    let row: SourceRow;
    try {
      row = sourceRow(source, options);
    } finally {
      source.close();
    }
    const binding = {
      schema: 1,
      source_db: resolve(options.db),
      origin: options.origin,
      reader: options.reader,
      source_attempt_id: options.sourceAttemptId,
      chip_id: options.chipId,
      installation_id: options.installationId,
      operator_id: options.operatorId,
      source: row,
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(binding))
      .digest('hex');
    const storage: JournalStorage = {
      read: async () => {
        if (!existsSync(options.journal)) return null;
        protectedFile(options.journal);
        if (lstatSync(options.journal).size > 65536)
          throw new Error('oversized journal');
        const saved = JSON.parse(readFileSync(options.journal, 'utf8')) as {
          fingerprint: string;
          binding: unknown;
          journal: ResetJournal;
        };
        if (
          saved.fingerprint !== fingerprint ||
          JSON.stringify(saved.binding) !== JSON.stringify(binding)
        )
          throw new Error('source binding changed');
        return JSON.stringify(saved.journal);
      },
      replace: async value =>
        atomicWrite(
          options.journal,
          JSON.stringify({fingerprint, binding, journal: JSON.parse(value)}),
        ),
    };
    phase = 'journal';
    let journal = await loadResetJournal(storage);
    if (!journal) {
      journal = {
        schema: 1,
        stage: 'reviewed',
        service_origin: options.origin,
        source_origin: options.origin,
        operator_id: row.operator_id,
        key_env: row.key_env,
        device_id: randomUUID(),
        reset_id: randomUUID(),
        chip_id: options.chipId,
        installation_id: options.installationId,
        source_attempt_id: options.sourceAttemptId,
        consent: {erase_owner_and_proofs: true, value_handled: true},
      };
      await writeResetJournal(storage, journal);
    }
    if (
      journal.chip_id !== options.chipId ||
      journal.installation_id !== options.installationId ||
      journal.source_attempt_id !== options.sourceAttemptId ||
      journal.operator_id !== options.operatorId ||
      journal.service_origin !== options.origin ||
      journal.source_origin !== options.origin ||
      journal.key_env !== row.key_env ||
      journal.stage === 'stopped'
    )
      throw new Error('journal requires reconciliation');
    phase = 'backup';
    await backupSource(options, fingerprint, row);
    phase = 'source-lock';
    const sql = openSqliteFile(options.db);
    try {
      sql.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
      service = new OpsDb({sql});
    } catch (error) {
      sql.close?.();
      throw error;
    }
    const scope = {
      operator_id: journal.operator_id,
      device_id: journal.device_id,
      key_env: journal.key_env,
    };
    let intent: ReturnType<typeof getResetIntent> | undefined;
    phase = 'service-read';
    try {
      intent = getResetIntent(service, scope, journal.reset_id);
    } catch (e) {
      if (!(e instanceof ProvisioningError) || e.status !== 404) throw e;
    }
    if (
      intent &&
      journal.service_intent_receipt !== undefined &&
      journal.service_intent_receipt !== JSON.stringify(intent.receipt)
    )
      throw new Error('service authority changed');
    if (intent?.completion_receipt) {
      if (!['factory_verified', 'complete'].includes(journal.stage))
        throw new Error('completion requires reconciliation');
    } else if (
      journal.stage !== 'factory_verified' &&
      journal.stage !== 'complete'
    ) {
      phase = 'reader-connect';
      reader = await connect(options.python, options.reader);
      if (!intent) {
        if (journal.stage !== 'reviewed')
          throw new Error('saved authority is missing');
        phase = 'fresh-identity';
        await readChipIdentity(reader.tx, journal.chip_id);
        phase = 'fresh-installation';
        const inspected = await inspectInstallation(reader.tx);
        phase = 'preflight';
        const preflight = assessResetPreflight({
          chipId: journal.chip_id,
          installation: inspected,
          provenance: {
            chipId: journal.chip_id,
            installationId: journal.installation_id,
            keySourceRef: fingerprint,
          },
          consent: {
            chipId: journal.chip_id,
            installationId: journal.installation_id,
            eraseOwnerAndProofs: true,
            valueHandled: true,
          },
        });
        if (!preflight.ok || inspected.state !== 'present')
          throw new Error('fresh inspection refused');
        phase = 'authorization';
        authorizeResetIntent(service, scope, {
          reset_id: journal.reset_id,
          chip_id: journal.chip_id,
          installation_id: journal.installation_id,
          source_attempt_id: journal.source_attempt_id,
          consent: journal.consent,
          inspection: {
            unspent: inspected.publicState.unspent,
            spent: inspected.publicState.spent,
            has_owner: inspected.publicState.owner,
            pin_present: inspected.publicState.pin,
            record_present: inspected.publicState.record,
            tag_present: inspected.tagVerified,
          },
        });
        intent = getResetIntent(service, scope, journal.reset_id);
      }
      const receipt = JSON.stringify(intent.receipt);
      if (
        journal.service_intent_receipt !== undefined &&
        journal.service_intent_receipt !== receipt
      )
        throw new Error('service authority changed');
      phase = 'key-release';
      const issued = issueResetKeys(service, scope, journal.reset_id);
      const keys = {
        enc: Array.from<number>(issued.enc),
        mac: Array.from<number>(issued.mac),
        dek: Array.from<number>(issued.dek),
      };
      try {
        phase = 'card-reset';
        const result = await resetOwnedCard(reader.tx, {
          keys,
          authority: {
            chipId: journal.chip_id,
            installationId: journal.installation_id,
            sourceRef: fingerprint,
            intentReceipt: receipt,
            eraseOwnerAndProofs: true,
            valueHandled: true,
          },
          stage: journal.stage as CardResetStage,
          random: n => randomBytes(n),
          now: () => performance.now(),
          persist: async (stage, evidence) => {
            const next: ResetJournal = {
              ...journal!,
              stage,
              service_intent_receipt: receipt,
              ...(evidence
                ? {
                    factory_evidence: {
                      gp_key_version: evidence.keyVersion,
                      verified_at: Math.floor(Date.now() / 1000),
                    },
                  }
                : {}),
            };
            await writeResetJournal(storage, next);
            journal = next;
          },
        });
        if (!result.ok)
          return {ok: false, stage: journal.stage, kind: result.kind};
      } finally {
        for (const field of ['enc', 'mac', 'dek'] as const) {
          issued[field].fill(0);
          keys[field].fill(0);
        }
      }
    }
    if (!intent || !journal.factory_evidence)
      throw new Error('factory evidence is missing');
    phase = 'completion';
    const receipt = completeReset(service, scope, journal.reset_id, {
      reset_id: journal.reset_id,
      source_attempt_id: journal.source_attempt_id,
      chip_id: journal.chip_id,
      removed_installation_id: journal.installation_id,
      gp_key_version: journal.factory_evidence.gp_key_version,
      verified_at: journal.factory_evidence.verified_at,
      manager_keys: 'factory',
      cashu_package: 'absent',
    });
    phase = 'local-acknowledgement';
    await writeResetJournal(storage, {
      ...journal,
      stage: 'complete',
      reconciliation_receipt: JSON.stringify(receipt),
    });
    return {
      ok: true,
      stage: 'complete',
      chip_id: journal.chip_id,
      reset_id: journal.reset_id,
    };
  } catch (error) {
    const readerError =
      error instanceof ResetReaderError
        ? error
        : error instanceof TransportError &&
            error.cause instanceof ResetReaderError
          ? error.cause
          : null;
    const code =
      readerError?.code ??
      (error instanceof ProvisioningError
        ? error.code
        : error instanceof ChipIdentityMismatch
          ? 'chip-mismatch'
          : error instanceof InspectionError
            ? 'invalid-applet-evidence'
            : error instanceof CardError
              ? 'card-refused'
              : error instanceof TransportError
                ? 'transport-failed'
                : error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'SQLITE_BUSY'
                  ? 'source-busy'
                  : 'stopped');
    throw new LocalResetFailure(
      phase,
      code,
      error instanceof CardError ? error.sw : undefined,
      error instanceof CardError ? error.ins : undefined,
    );
  } finally {
    try {
      await reader?.close();
    } finally {
      try {
        service?.close();
      } finally {
        closeSync(lock);
        unlinkSync(options.journal + '.lock');
      }
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      db: {type: 'string'},
      journal: {type: 'string'},
      origin: {type: 'string'},
      operator: {type: 'string'},
      chip: {type: 'string'},
      installation: {type: 'string'},
      source: {type: 'string'},
      reader: {type: 'string'},
      python: {type: 'string'},
      execute: {type: 'boolean'},
      'consent-erase-owner-and-proofs': {type: 'boolean'},
      'value-handled': {type: 'boolean'},
      help: {type: 'boolean'},
    },
    strict: true,
  });
  if (parsed.values.help) {
    console.log(
      'local-reset: --db --journal --origin --operator --chip --installation --source --reader --python; preview by default; execution also requires --execute --consent-erase-owner-and-proofs --value-handled',
    );
    return;
  }
  const required = (key: keyof typeof parsed.values): string => {
    const value = parsed.values[key];
    if (typeof value !== 'string' || !value)
      throw new Error('missing public option');
    return value;
  };
  const options: LocalResetOptions = {
    db: resolve(required('db')),
    journal: resolve(required('journal')),
    origin: required('origin'),
    operatorId: Number(required('operator')),
    chipId: required('chip'),
    installationId: required('installation'),
    sourceAttemptId: required('source'),
    reader: required('reader'),
    python: required('python'),
  };
  if (!Number.isSafeInteger(options.operatorId) || options.operatorId < 1)
    throw new Error('invalid operator');
  if (!parsed.values.execute) {
    console.log(JSON.stringify(previewLocalReset(options)));
    return;
  }
  if (
    !parsed.values['consent-erase-owner-and-proofs'] ||
    !parsed.values['value-handled']
  )
    throw new Error('consent required');
  process.umask(0o077);
  const result = await executeLocalReset(options);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module)
  main().catch(error => {
    console.error(
      JSON.stringify(
        error instanceof LocalResetFailure
          ? {
              ok: false,
              phase: error.phase,
              reason: error.code,
              sw: error.sw,
              ins: error.ins,
            }
          : {ok: false, phase: 'preparation', reason: 'stopped'},
      ),
    );
    process.exitCode = 1;
  });
