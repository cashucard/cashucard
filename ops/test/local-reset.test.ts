import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OpsDb} from '../src/db';
import {openSqliteFile} from '../src/sqlite-file';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  recordAttempt,
  issueAttemptKeys,
} from '../src/provisioning';
import {
  executeLocalReset,
  previewLocalReset,
  type LocalResetOptions,
} from '../src/local-reset';
import {
  cashuPlan,
  provision,
  rotateKeys,
  FACTORY_KEYS,
  fromHex,
} from '../../tools/cardkit';
import {FakeCard} from '../../tools/cardkit/gp/test/fake-card';
import {CASHU_LOAD_FILE} from '../../tools/cardkit/gp/test/assets';
import {randomBytes} from 'node:crypto';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const chip = 'cplc-v1:4790d3213041093363205547';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cashu-local-reset-'));
  chmodSync(directory, 0o700);
  const options: LocalResetOptions = {
    db: join(directory, 'source.db'),
    journal: join(directory, 'reset.json'),
    origin: 'http://127.0.0.1:8821',
    operatorId: 1,
    chipId: chip,
    installationId: key,
    sourceAttemptId: uuid(3),
    reader: 'ACS ACR122U PICC Interface',
    python: '/must-not-be-executed',
  };
  const db = new OpsDb({
    sql: openSqliteFile(options.db),
    master: {getMaster: () => Buffer.alloc(32, 90)},
  });
  chmodSync(options.db, 0o600);
  db.db
    .prepare(
      "INSERT INTO operators(name,password_hash,key_env,created) VALUES ('one','test','issued',1)",
    )
    .run();
  const scope = {
    operator_id: 1,
    device_id: uuid(1),
    key_env: 'issued' as const,
  };
  const config = {
    batch_request_id: uuid(2),
    count: 1,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard' as const,
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: 'ab'.repeat(32),
  };
  const batch = createProvisioningBatch(db, scope, config);
  reserveAttempt(db, scope, {
    attempt_id: uuid(3),
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  bindAttempt(db, scope, uuid(3), {revision: 0, chip_id: chip});
  const issued = issueAttemptKeys(db, scope, uuid(3));
  const keys = {
    enc: Array.from<number>(issued.enc),
    mac: Array.from<number>(issued.mac),
    dek: Array.from<number>(issued.dek),
  };
  recordAttempt(db, scope, uuid(3), {
    revision: 1,
    record: {
      attempt_id: uuid(3),
      batch_id: batch.batch_id,
      ordinal: 0,
      chip_id: chip,
      installation_id: key,
      display_id: key.slice(-4),
      load_sha256: config.load_sha256,
      gp_key_version: 1,
      operator_id: 1,
      device_id: scope.device_id,
      key_env: 'issued',
      configuration_revision: 1,
      verified_stage: 'rotated',
      verified_at: db.now(),
    },
  });
  db.close();
  const card = new FakeCard();
  const run = {random: (n: number) => randomBytes(n), now: () => 0};
  assert.equal(
    (await provision(card.transceive, cashuPlan(CASHU_LOAD_FILE), run)).ok,
    true,
  );
  assert.equal(
    (await rotateKeys(card.transceive, FACTORY_KEYS, keys, run)).ok,
    true,
  );
  card.reset();
  const tx = async (apdu: number[]) => {
    if (apdu[0] === 0xb0 && apdu[1] === 0x10) return [...fromHex(key), 0x90, 0];
    return card.transceive(apdu);
  };
  return {directory, options, card, tx};
}

test('default CLI preview reads metadata without changing the database or opening a reader', async () => {
  const {directory, options} = await fixture();
  try {
    const before = readFileSync(options.db);
    const args = [
      '--import',
      'tsx',
      'src/local-reset.ts',
      '--db',
      options.db,
      '--journal',
      options.journal,
      '--origin',
      options.origin,
      '--operator',
      '1',
      '--chip',
      chip,
      '--installation',
      key,
      '--source',
      uuid(3),
      '--reader',
      options.reader,
      '--python',
      options.python,
    ];
    const stdout = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(stdout), previewLocalReset(options));
    assert.equal(JSON.parse(stdout).card_accessed, false);
    assert.equal(existsSync(options.journal), false);
    assert.deepEqual(readFileSync(options.db), before);
    assert.throws(() =>
      previewLocalReset({...options, origin: 'https://ops.cashucard.org'}),
    );
    assert.throws(() =>
      execFileSync(process.execPath, [...args, '--execute'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    );
    assert.equal(existsSync(options.journal), false);
    assert.deepEqual(readFileSync(options.db), before);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('local runner integrates private escrow, durable journal, interrupted reset and completion without hardware', async () => {
  const {directory, options, card, tx} = await fixture();
  let lost = false,
    connections = 0;
  try {
    const first = await executeLocalReset(options, async () => {
      connections++;
      return {
        close: async () => {},
        tx: async apdu => {
          const reply = await tx(apdu);
          if (!lost && apdu[1] === 0xe4) {
            lost = true;
            throw new Error('lost reply');
          }
          return reply;
        },
      };
    });
    assert.equal(first.ok, false);
    assert.equal(
      JSON.parse(readFileSync(options.journal, 'utf8')).journal.stage,
      'delete_intent',
    );
    card.reset();
    const result = await executeLocalReset(options, async () => {
      connections++;
      return {tx, close: async () => {}};
    });
    assert.equal(result.ok, true);
    assert.equal(card.failedAuths, 0);
    assert.equal(card.instances.size, 0);
    assert.equal(statSync(options.journal).mode & 0o777, 0o600);
    assert.equal(
      statSync(options.journal + '.source-backup.db').mode & 0o777,
      0o600,
    );
    const saved = JSON.parse(readFileSync(options.journal, 'utf8')).journal;
    assert.equal(saved.stage, 'complete');
    assert.equal(saved.factory_evidence.gp_key_version, 1);
    assert.equal(existsSync(options.journal + '.lock'), false);
    assert.deepEqual(
      await executeLocalReset(options, async () => {
        throw new Error('must not reconnect');
      }),
      result,
    );
    // Service completion committed, but its local acknowledgement was lost.
    const unacknowledged = JSON.parse(readFileSync(options.journal, 'utf8'));
    unacknowledged.journal.stage = 'factory_verified';
    delete unacknowledged.journal.reconciliation_receipt;
    writeFileSync(options.journal, JSON.stringify(unacknowledged), {
      mode: 0o600,
    });
    assert.deepEqual(
      await executeLocalReset(options, async () => {
        throw new Error('must not reconnect');
      }),
      result,
    );
    assert.equal(connections, 2);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('reader startup failure retains reviewed state and reports its safe phase', async () => {
  const {directory, options} = await fixture();
  try {
    await assert.rejects(
      () =>
        executeLocalReset(options, async () => {
          throw new Error('private native detail');
        }),
      error =>
        error instanceof Error &&
        'phase' in error &&
        error.phase === 'reader-connect' &&
        !error.message.includes('private native detail'),
    );
    assert.equal(
      JSON.parse(readFileSync(options.journal, 'utf8')).journal.stage,
      'reviewed',
    );
    const db = new OpsDb({sql: openSqliteFile(options.db)});
    assert.deepEqual(
      db.db.prepare('SELECT count(*) AS count FROM reset_intents').get(),
      {count: 0},
    );
    db.close();
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
