import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync, sign} from 'node:crypto';
import {generateIdentity, identityToRecipient} from 'age-encryption';
import {createOperatorSession, hashPassword} from '../src/auth';
import {AnchorFeed} from '../src/anchor';
import {HolderIssueState} from '../src/issue';
import {routeRequest} from '../src/route-request';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  disposeAttempt,
} from '../src/provisioning';
import {
  exportEscrowSql,
  decryptEscrowExport,
  restoreEscrowExport,
} from '../src/export';
import {testDb} from './helpers';
import {recordCard} from '../src/registry';

const id = (n: number) =>
  'cc000000-0000-4000-8000-' + String(n).padStart(12, '0');
const attempts = '/admin/provisioning/attempts';
const target = attempts + '/' + id(3) + '/fedimint-reset';
async function admin(db: ReturnType<typeof testDb>) {
  db.db
    .prepare(
      'INSERT INTO operators(name,password_hash,key_env,created) VALUES (?,?,?,?)',
    )
    .run(
      'recovery-admin',
      await hashPassword('synthetic-password'),
      'issued',
      db.now(),
    );
  const {token} = (await createOperatorSession(
    db,
    'recovery-admin',
    'synthetic-password',
  ))!;
  return (
    path: string,
    body?: unknown,
    trust?: string,
    admins = '["recovery-admin"]',
    bearer = token,
  ) => {
    const deps = {
      db,
      anchor: new AnchorFeed(async () => {
        throw Error('unexpected fetch');
      }),
      holderState: new HolderIssueState(),
      mints: [],
      operatorAdmins: () => admins,
      fedimintReissueTrust: () => trust,
    };
    return routeRequest(
      deps,
      new Request('https://cashu.example' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: 'Bearer ' + bearer,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      }),
    );
  };
}

test('only deployment configuration enables the administrator recovery route', async () => {
  const db = testDb();
  try {
    const call = await admin(db);
    const path = target + '/approve';
    assert.equal((await call(path, {})).status, 503);
    assert.equal((await call(path, {}, 'bad-config', '[]')).status, 403);
    assert.equal(
      (await call(path, {}, 'bad-config', '["recovery-admin"]', 'bad-session'))
        .status,
      401,
    );
    for (const trust of [
      'bad-config',
      JSON.stringify({source_origin: 'https://example.org'}),
    ]) {
      const result = await call(path, {}, trust);
      assert.equal(result.status, 503);
      assert.equal(
        (result.body as {reason: string}).reason,
        'fedimint-reissue-policy-invalid',
      );
    }
  } finally {
    db.close();
  }
});

test('administrator preview, retry, ordinary rebind and authenticated export/restore preserve one decision', async () => {
  const {canonicalFedimintResetPayload, FEDIMINT_RESET_PURPOSE} =
    await import('../src/fedimint-reset-proof');
  const db = testDb();
  try {
    const start = db.now();
    let clock = start;
    Object.defineProperty(db, 'now', {value: () => clock});
    const call = await admin(db);
    const scope = {
      operator_id: 1,
      device_id: id(1),
      key_env: 'issued' as const,
    };
    const batch = createProvisioningBatch(db, scope, {
      batch_request_id: id(2),
      mint_url: 'https://mint.example',
      count: 2,
      pin_policy: 'perCard',
      daily_usd: 0,
      no_pin_usd: 0,
      load_sha256: 'aa'.repeat(32),
    });
    const chip = 'cplc-v1:' + 'a5'.repeat(12);
    reserveAttempt(db, scope, {
      attempt_id: id(3),
      batch_id: batch.batch_id,
      ordinal: 0,
    });
    bindAttempt(db, scope, id(3), {revision: 0, chip_id: chip});
    clock += 10;
    disposeAttempt(db, scope, id(3), {
      revision: 1,
      kind: 'quarantined',
      reason: 'authentication-failed',
    });
    const keys = generateKeyPairSync('ed25519');
    const trust = {
      source_origin: 'https://fed.example',
      target_origin: 'https://cashu.example',
      public_key_hex: Buffer.from(
        keys.publicKey.export({format: 'jwk'}).x!,
        'base64url',
      ).toString('hex'),
    };
    const config = JSON.stringify(trust);
    const expected = {
      target_origin: trust.target_origin,
      source_origin: trust.source_origin,
      chip_id: chip,
      attempt_id: id(3),
      revision: 2,
      target_bound_at: start,
    };
    const list = async (config?: string) =>
      (await call(attempts, undefined, config)).body as {
        attempts: {
          attempt_id: string;
          fedimint_reset_reviewable: boolean;
          fedimint_reset_target?: unknown;
          fedimint_reissue_receipt?: unknown;
        }[];
      };
    const disabled = (await list()).attempts[0];
    assert.equal(disabled.fedimint_reset_reviewable, false);
    assert.deepEqual((await list('bad-config')).attempts[0], disabled);
    assert.equal(disabled.fedimint_reset_target, undefined);
    assert.deepEqual(
      (await list(config)).attempts[0].fedimint_reset_target,
      expected,
    );
    const payload = {
      ...expected,
      purpose: FEDIMINT_RESET_PURPOSE,
      short_id: '1258acdf',
      operator_id: 17,
      gp_key_version: 1,
      manager_keys: 'factory',
      package: 'absent',
      cashu_select_sw: '6a82',
      fedimint_select_sw: '6a82',
      setup_journal_sha256: 'fe'.repeat(32),
      verified_at_ms: (start + 3) * 1000,
      completed_at_ms: (start + 4) * 1000,
      source_snapshot_sha256: '64'.repeat(32),
      source_snapshot_created_at_ms: (start + 4) * 1000,
      observed_at_ms: (start + 12) * 1000,
    } as const;
    const proof = {
      payload,
      signature_hex: sign(
        null,
        Buffer.from(canonicalFedimintResetPayload(payload)),
        keys.privateKey,
      ).toString('hex'),
    };
    clock = start + 13;
    reserveAttempt(db, scope, {
      attempt_id: id(4),
      batch_id: batch.batch_id,
      ordinal: 1,
    });
    const rebind = () =>
      bindAttempt(db, scope, id(4), {revision: 0, chip_id: chip});
    assert.equal(
      (await call(target + '/preview', {proof}, config)).status,
      200,
    );
    assert.throws(rebind, /unresolved/);
    const results = await Promise.all([
      call(target + '/approve', {proof}, config),
      call(target + '/approve', {proof}, config),
    ]);
    assert.equal(results[0].status, 200);
    assert.deepEqual(results[1], results[0]);
    clock++;
    rebind();
    const history = (await list(config)).attempts.find(
      x => x.attempt_id === id(3),
    )!;
    assert.equal(history.fedimint_reset_reviewable, false);
    assert.equal(history.fedimint_reset_target, undefined);
    assert.deepEqual(
      (await list()).attempts.find(a => a.attempt_id === id(3))
        ?.fedimint_reissue_receipt,
      (results[0].body as {receipt: unknown}).receipt,
    );
    const identity = await generateIdentity();
    const backup = await exportEscrowSql(
      db.db,
      await identityToRecipient(identity),
      clock,
    );
    const exported = await decryptEscrowExport(backup.armored, identity);
    assert.equal(exported.version, 8);
    if (exported.version !== 8) throw Error('Expected export v8');
    const lateReport = {
      short_id: 'b715',
      batch_id: batch.batch_id,
      key_id: 1,
      ordinal: 0,
      installed_at: start,
      installer: 'synthetic-legacy',
      load_sha256: 'aa'.repeat(32),
    };
    assert.deepEqual(recordCard(db, lateReport), {kind: 'conflict'});
    const contradictory = testDb();
    try {
      assert.throws(
        () =>
          restoreEscrowExport(contradictory.db, {
            ...exported,
            cards: [lateReport],
          }),
        /invalid recovery export/,
      );
    } finally {
      contradictory.close();
    }
    const audits = exported.fedimint_reissues!;
    assert.equal(audits.length, 1);
    const restored = testDb();
    try {
      restoreEscrowExport(restored.db, exported);
      assert.deepEqual(
        restored.db.prepare('SELECT * FROM fedimint_reissues').all(),
        audits,
      );
      assert.deepEqual(
        restored.db
          .prepare('SELECT recovery_required FROM provisioning_control')
          .get(),
        {recovery_required: 1},
      );
    } finally {
      restored.close();
    }
    for (const rows of [
      [],
      [audits[0], audits[0]],
      [{...audits[0], actor_id: 777}],
      [{...audits[0], public_key: '21'.repeat(32)}],
      [
        {
          ...audits[0],
          proof_json: audits[0].proof_json.replace('1258acdf', '1258acde'),
        },
      ],
      [{...audits[0], receipt_json: '{}'}],
    ]) {
      const empty = testDb();
      try {
        assert.throws(
          () =>
            restoreEscrowExport(empty.db, {
              ...exported,
              fedimint_reissues: rows,
            }),
          /invalid recovery export/,
        );
        assert.deepEqual(empty.db.prepare('SELECT * FROM operators').all(), []);
      } finally {
        empty.close();
      }
    }
    // The Fedimint source has one completion per original card ID. Another
    // stopped target cannot consume the same original ID with amended dates.
    const secondBind = clock;
    clock++;
    disposeAttempt(db, scope, id(4), {
      revision: 1,
      kind: 'quarantined',
      reason: 'authentication-failed',
    });
    const repeatedSource = {
      ...payload,
      attempt_id: id(4),
      target_bound_at: secondBind,
      verified_at_ms: (clock + 1) * 1000,
      completed_at_ms: (clock + 2) * 1000,
      source_snapshot_created_at_ms: (clock + 2) * 1000,
      observed_at_ms: (clock + 3) * 1000,
    };
    clock += 4;
    const repeated = await call(
      attempts + '/' + id(4) + '/fedimint-reset/approve',
      {
        proof: {
          payload: repeatedSource,
          signature_hex: sign(
            null,
            Buffer.from(canonicalFedimintResetPayload(repeatedSource)),
            keys.privateKey,
          ).toString('hex'),
        },
      },
      config,
    );
    assert.equal(repeated.status, 409);
    assert.equal(
      (repeated.body as {reason: string}).reason,
      'reissue-source-used',
    );
  } finally {
    db.close();
  }
});
