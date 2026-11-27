import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ed25519} from '@noble/curves/ed25519';
import {testDb, testDoDb} from './helpers';
import {
  createProvisioningBatch,
  reserveAttempt,
  bindAttempt,
  disposeAttempt,
} from '../src/provisioning';
import {
  approveFedimintReissue,
  previewFedimintReissue,
  assertFedimintReissueAudit,
  type FedimintReissueRow,
  type FedimintReissueAttempt,
} from '../src/fedimint-reissue';
import {
  canonicalFedimintResetPayload,
  type FedimintResetPayload,
} from '../src/fedimint-reset-proof';

const uuid = (n: number) =>
  '00000000-0000-4000-8000-' + n.toString().padStart(12, '0');
const chip = 'cplc-v1:' + 'ab'.repeat(12);
const attemptId = uuid(3);
const secret = Uint8Array.from({length: 32}, (_, i) => i + 10);
const policy = {
  target_origin: 'https://cashu.test',
  source_origin: 'https://fedimint.test',
  public_key_hex: Buffer.from(ed25519.getPublicKey(secret)).toString('hex'),
};

function fixture(backend = testDb, late = true) {
  const db = backend(),
    start = db.now();
  let clock = start;
  Object.defineProperty(db, 'now', {configurable: true, value: () => clock});
  db.db
    .prepare(
      'INSERT INTO operators(name,password_hash,key_env,created) VALUES (?,?,?,?)',
    )
    .run('reviewer', 'synthetic', 'issued', start);
  const scope = {
    operator_id: 1,
    device_id: uuid(1),
    key_env: 'issued' as const,
  };
  const batch = createProvisioningBatch(db, scope, {
    batch_request_id: uuid(2),
    count: 2,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard',
    daily_usd: 0,
    no_pin_usd: 0,
    load_sha256: 'ab'.repeat(32),
  });
  reserveAttempt(db, scope, {
    attempt_id: attemptId,
    batch_id: batch.batch_id,
    ordinal: 0,
  });
  bindAttempt(db, scope, attemptId, {revision: 0, chip_id: chip});
  clock = start + (late ? 5 : 1);
  disposeAttempt(db, scope, attemptId, {
    revision: 1,
    kind: 'quarantined',
    reason: 'authentication-failed',
  });
  clock = start + 10;
  const payload: FedimintResetPayload = {
    purpose: 'cashu-card/fedimint-reset-reissue/v1',
    target_origin: policy.target_origin,
    attempt_id: attemptId,
    revision: 2,
    chip_id: chip,
    target_bound_at: start,
    source_origin: policy.source_origin,
    short_id: '1234abce',
    operator_id: 1,
    setup_journal_sha256: '33'.repeat(32),
    source_snapshot_sha256: '44'.repeat(32),
    source_snapshot_created_at_ms: (start + 3) * 1000 + 200,
    gp_key_version: 1,
    manager_keys: 'factory',
    package: 'absent',
    verified_at_ms: (start + 2) * 1000 + 100,
    completed_at_ms: (start + 3) * 1000 + 200,
    cashu_select_sw: '6a82',
    fedimint_select_sw: '6a82',
    observed_at_ms: (start + 7) * 1000 + 300,
  };
  const sign = (updates: Partial<FedimintResetPayload> = {}) => {
    const body = {...payload, ...updates};
    return {
      proof: {
        payload: body,
        signature_hex: Buffer.from(
          ed25519.sign(
            Buffer.from(canonicalFedimintResetPayload(body)),
            secret,
          ),
        ).toString('hex'),
      },
    };
  };
  const target = () =>
    db.db
      .prepare('SELECT * FROM provisioning_attempts WHERE attempt_id=?')
      .get(attemptId) as FedimintReissueAttempt;
  const approve = (req: unknown = sign()) =>
    approveFedimintReissue(db, 1, attemptId, req, policy);
  return {
    db,
    start,
    batch,
    scope,
    payload,
    sign,
    target,
    approve,
    setClock: (v: number) => {
      clock = v;
    },
  };
}

for (const backend of [testDb, testDoDb]) {
  for (const late of [true, false]) {
    test(
      backend.name +
        ' verifies a stopped initial install, with acknowledgement ' +
        (late ? 'after' : 'before') +
        ' the source reset',
      () => {
        const {db, sign, approve, target, setClock, start} = fixture(
          backend,
          late,
        );
        try {
          const before = target();
          const preview = previewFedimintReissue(db, attemptId, sign(), policy);
          assert.equal(preview.attempt_id, attemptId);
          assert.equal(target().fence_released, 0);
          const receipt = approve();
          assert.equal(target().fence_released, 1);
          assert.deepEqual(target(), {...before, fence_released: 1});
          const audit = db.db
            .prepare('SELECT * FROM fedimint_reissues')
            .get() as FedimintReissueRow;
          assert.doesNotThrow(() =>
            assertFedimintReissueAudit(audit, target()),
          );
          assert.throws(() =>
            assertFedimintReissueAudit({...audit, actor_id: 2}, target()),
          );
          setClock(start + 2000);
          assert.deepEqual(approve(), receipt);
          assert.throws(() =>
            approve(sign({observed_at_ms: (start + 8) * 1000})),
          );
        } finally {
          db.close();
        }
      },
    );
  }
}

test('stale observations, wrong targets, changed evidence and ambiguous cross-clock ordering keep the fence', () => {
  const {db, start, payload, sign, approve, target, setClock} = fixture();
  try {
    assert.throws(() => approve(sign({attempt_id: uuid(55)})));
    assert.throws(() => approve(sign({revision: 1})));
    assert.throws(() => approve(sign({chip_id: 'cplc-v1:' + '01'.repeat(12)})));
    assert.throws(() => approve(sign({target_bound_at: start - 1})));
    assert.throws(() =>
      approve(sign({observed_at_ms: (start + 5) * 1000 + 800})),
    );
    assert.throws(
      () =>
        approve(
          sign({
            verified_at_ms: (start + 5) * 1000 + 400,
            completed_at_ms: (start + 6) * 1000,
            source_snapshot_created_at_ms: (start + 6) * 1000,
          }),
        ),
      /reissue-evidence-order/,
    );
    assert.throws(
      () =>
        approve(
          sign({
            completed_at_ms: (start + 5) * 1000 + 100,
            source_snapshot_created_at_ms: (start + 5) * 1000 + 100,
          }),
        ),
      /reissue-evidence-order/,
    );
    assert.throws(() =>
      approve(sign({observed_at_ms: payload.completed_at_ms})),
    );
    assert.throws(() => approve(sign({observed_at_ms: (start + 11) * 1000})));
    const tampered = sign();
    tampered.proof.payload.short_id = 'feeeaadd';
    assert.throws(() => approve(tampered));
    assert.throws(() => approve({...sign(), reviewed: true}));
    assert.throws(() => approveFedimintReissue(db, 1, uuid(4), sign(), policy));
    setClock(start + 908);
    assert.throws(() => approve());
    assert.equal(target().fence_released, 0);
    assert.deepEqual(
      db.db.prepare('SELECT * FROM fedimint_reissues').all(),
      [],
    );
  } finally {
    db.close();
  }
});

test('neither preview nor approval will bypass recovery or backup, and auditing and fence release are atomic', () => {
  const {db, approve, target, sign} = fixture();
  try {
    const preview = () => previewFedimintReissue(db, attemptId, sign(), policy);
    db.db
      .prepare('UPDATE provisioning_control SET recovery_required=1 WHERE id=1')
      .run();
    assert.throws(preview, /recovery-required/);
    assert.throws(approve, /recovery-required/);
    db.db
      .prepare('UPDATE provisioning_control SET recovery_required=0 WHERE id=1')
      .run();
    Object.defineProperty(db, 'independentBackupIssuer', {
      configurable: true,
      get: () => 'issuer.test',
    });
    assert.throws(preview, /independent-backup-stale/);
    assert.throws(approve, /independent-backup-stale/);
    Object.defineProperty(db, 'independentBackupIssuer', {
      configurable: true,
      get: () => undefined,
    });
    assert.throws(
      () => approveFedimintReissue(db, 2, attemptId, sign(), policy),
      /admin-required/,
    );
    db.db
      .exec(`CREATE TRIGGER stop_release BEFORE UPDATE OF fence_released ON provisioning_attempts
        WHEN NEW.fence_released=1 BEGIN SELECT RAISE(ABORT,'injected write error'); END;`);
    assert.throws(approve, /injected write error/);
    assert.equal(target().fence_released, 0);
    assert.deepEqual(
      db.db.prepare('SELECT * FROM fedimint_reissues').all(),
      [],
    );
    db.db.exec('DROP TRIGGER stop_release;');
    approve();
    assert.equal(target().fence_released, 1);
  } finally {
    db.close();
  }
});

test('only an acknowledged authentication failure from this initial install may be reviewed', () => {
  for (const change of [
    "state='active',disposition_json=NULL,disposition_receipt=NULL",
    "state='abandoned'",
    'revision=3',
    'bind_receipt=NULL',
    'disposition_receipt=NULL',
    "disposition_json='{}'",
    "disposition_receipt='{}'",
    'fence_released=1',
  ]) {
    const {db, approve} = fixture();
    try {
      db.db.exec('UPDATE provisioning_attempts SET ' + change);
      assert.throws(approve);
      assert.deepEqual(
        db.db.prepare('SELECT * FROM fedimint_reissues').all(),
        [],
      );
    } finally {
      db.close();
    }
  }
});

test('an open reset, a live historic install, or even a same-second later binding cannot be erased', () => {
  for (const history of [
    'own-record',
    'prior-live',
    'later-bind',
    'simultaneous-bind',
    'open-reset',
    'closed-before-bind',
    'damaged-old-reset',
    'reset-same-second',
  ]) {
    const {db, start, batch, approve, target} = fixture();
    const prior = uuid(30),
      install = '02' + '12'.repeat(32),
      reset = uuid(31);
    try {
      if (history !== 'own-record') {
        const bound =
          start +
          (history === 'later-bind'
            ? 1
            : history === 'simultaneous-bind'
              ? 0
              : -100);
        db.db
          .prepare(
            `INSERT INTO provisioning_attempts
          (attempt_id,batch_id,ordinal,operator_id,device_id,revision,state,chip_id,created,bind_receipt)
          VALUES (?,?,1,1,?,2,'recorded',?,?,?)`,
          )
          .run(
            prior,
            batch.batch_id,
            uuid(29),
            chip,
            bound,
            JSON.stringify({
              attempt_id: prior,
              revision: 1,
              chip_id: chip,
              bound_at: bound,
            }),
          );
      }
      db.db
        .prepare('INSERT INTO provisioning_records VALUES (?,?,?,?,?,?)')
        .run(
          history === 'own-record' ? attemptId : prior,
          install,
          install.slice(-4),
          '{}',
          '{}',
          start - 80,
        );
      if (!['own-record', 'prior-live'].includes(history)) {
        db.db
          .prepare('INSERT INTO reset_intents VALUES (?,?,?,?,?,?,?,?,?)')
          .run(
            reset,
            chip,
            install,
            prior,
            1,
            uuid(28),
            '{}',
            '{}',
            start - 70,
          );
        if (history !== 'open-reset') {
          const completed =
            history === 'reset-same-second' ? start : start - 60;
          const common = {
            reset_id: reset,
            chip_id: chip,
            removed_installation_id: install,
            manager_keys: 'factory',
            cashu_package: 'absent',
          };
          const record = {
            ...common,
            source_attempt_id: prior,
            gp_key_version: 1,
            verified_at: completed,
          };
          const receipt = {
            ...common,
            operator_id: 1,
            device_id: uuid(28),
            completed_at: completed,
          };
          db.db
            .prepare('INSERT INTO reset_results VALUES (?,?,?,?)')
            .run(
              reset,
              history === 'damaged-old-reset' ? '{}' : JSON.stringify(record),
              JSON.stringify(receipt),
              completed,
            );
        }
      }
      if (history === 'closed-before-bind') {
        approve();
        assert.equal(target().fence_released, 1);
      } else {
        assert.throws(approve, /reissue-chip-history/, history);
        assert.equal(target().fence_released, 0);
      }
    } finally {
      db.close();
    }
  }
});

test('a matching legacy Cashu card at the same batch and ordinal keeps the existing fence', () => {
  const {db, batch, approve, target, start} = fixture();
  try {
    db.db
      .prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?)')
      .run('abcd', batch.batch_id, 1, 0, start, 'legacy', 'ab'.repeat(32));
    assert.throws(approve, /reissue-chip-history/);
    assert.equal(target().fence_released, 0);
  } finally {
    db.close();
  }
});

test('a proof at the freshness boundary retains the same approval time used to admit it', () => {
  const {db, start, approve, target} = fixture();
  try {
    let now = start + 907;
    Object.defineProperty(db, 'now', {value: () => now++});
    const receipt = approve();
    assert.equal(receipt.approved_at, start + 907);
    const audit = db.db
      .prepare('SELECT * FROM fedimint_reissues')
      .get() as FedimintReissueRow;
    assert.doesNotThrow(() => assertFedimintReissueAudit(audit, target()));
  } finally {
    db.close();
  }
});

test('a reading inside the current second can be retried unchanged on the next tick', () => {
  const {db, start, approve, target, sign, setClock} = fixture();
  try {
    const now = start + 10;
    const preview = (req: unknown) =>
      previewFedimintReissue(db, attemptId, req, policy);
    assert.doesNotThrow(() => preview(sign({observed_at_ms: now * 1000})));
    const req = sign({observed_at_ms: now * 1000 + 999});
    assert.throws(() => preview(req), /reissue-evidence-next-second/);
    assert.throws(() => approve(req), /reissue-evidence-next-second/);
    assert.throws(
      () => preview(sign({observed_at_ms: (now + 1) * 1000})),
      /reissue-evidence-stale/,
    );
    assert.equal(target().fence_released, 0);
    setClock(now + 1);
    assert.doesNotThrow(() => preview(req));
    assert.equal(approve(req).approved_at, now + 1);
    assert.equal(target().fence_released, 1);
  } finally {
    db.close();
  }
});
