import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import crypto from 'node:crypto';
import {NativePwHash, NodePwHash} from '../src/pwhash';
import {createOperatorSession} from '../src/auth';
import {testDb} from './helpers';

const legacy =
  'pbkdf2$600000$5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a$d8a3173efab35d6516381d924cdb32a759fc656c55e20fb38295ab50ea5a60de7952c0ea4e4e08b5fe9b40a7451145f6b78a43390a8b3a39d5607695e677882f';
test('native profile is memory-hard, interoperable and preserves the legacy verifier', async () => {
  const hasher = new NativePwHash();
  const stored = await hasher.hash('public test password');
  assert.match(stored, /^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  const parts = stored.split('$');
  assert.equal(
    parts[5],
    scryptSync('public test password', Buffer.from(parts[4]!, 'hex'), 64, {
      N: 32768,
      r: 8,
      p: 3,
      maxmem: 64 * 1024 * 1024,
    }).toString('hex'),
  );
  assert.equal(
    await new NodePwHash().verify('public test password', stored),
    true,
  );
  assert.equal(await hasher.verify('public test password', legacy), true);
  assert.equal(await hasher.verify('wrong', stored), false);
  assert.equal(await hasher.upgrade('public test password', stored), null);
});
test('only a successful legacy login upgrades atomically, without changing password, session revocation or attempt budget', async () => {
  const db = testDb();
  db.db
    .prepare(
      "INSERT INTO operators(name,password_hash,key_env,created) VALUES ('operator',?,'issued',1)",
    )
    .run(legacy);
  const hasher = new NativePwHash();
  assert.equal(
    await createOperatorSession(db, 'operator', 'wrong', hasher),
    null,
  );
  assert.equal(
    (
      db.db.prepare('SELECT password_hash FROM operators').get() as {
        password_hash: string;
      }
    ).password_hash,
    legacy,
  );
  assert.ok(
    await createOperatorSession(db, 'operator', 'public test password', hasher),
  );
  const saved = (
    db.db.prepare('SELECT password_hash FROM operators').get() as {
      password_hash: string;
    }
  ).password_hash;
  assert.match(saved, /^scrypt\$32768\$8\$3\$/);
  assert.ok(
    await createOperatorSession(db, 'operator', 'public test password', hasher),
  );
  assert.equal(
    (
      db.db.prepare('SELECT password_hash FROM operators').get() as {
        password_hash: string;
      }
    ).password_hash,
    saved,
  );
  assert.equal(
    (
      db.db.prepare('SELECT attempts FROM login_attempt_budget').get() as {
        attempts: number;
      }
    ).attempts,
    3,
  );
  assert.equal(
    (
      db.db
        .prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL')
        .get() as {n: number}
    ).n,
    2,
  );
  db.close();
});
test(
  'credential recovery during hash upgrade cannot be overwritten or issue a session',
  {timeout: 1000},
  async () => {
    const db = testDb();
    db.db
      .prepare(
        "INSERT INTO operators(name,password_hash,key_env,created) VALUES ('operator','old-hash','issued',1)",
      )
      .run();
    let release!: (v: string) => void, started!: () => void;
    const waiting = new Promise<void>(r => {
      started = r;
    });
    const upgrade = () => {
      started();
      return new Promise<string>(r => {
        release = r;
      });
    };
    const login = createOperatorSession(db, 'operator', 'public test', {
      hash: async () => 'unused',
      verify: async () => true,
      upgrade,
    });
    await waiting;
    db.db.prepare("UPDATE operators SET password_hash='recovered-hash'").run();
    release('upgraded-hash');
    assert.equal(await login, null);
    assert.equal(
      (
        db.db.prepare('SELECT password_hash FROM operators').get() as {
          password_hash: string;
        }
      ).password_hash,
      'recovered-hash',
    );
    assert.equal(
      (db.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {n: number})
        .n,
      0,
    );
    db.close();
  },
);

test('an edge cost cap retains legacy credentials without a second slow hash or weaker parameters', async () => {
  let calls = 0;
  const hasher = new NativePwHash(async () => {
    calls++;
    throw new RangeError('Scrypt failed: cost exceeds maximum (test cap).');
  });
  assert.equal(await hasher.upgrade('public test password', legacy), null);
  assert.equal(await hasher.upgrade('public test password', legacy), null);
  assert.equal(calls, 1);
  const fallback = await hasher.hash('public test password');
  assert.match(fallback, /^pbkdf2\$600000\$/);
  assert.equal(await hasher.verify('public test password', fallback), true);
  const broken = new NativePwHash(async () => {
    throw new Error('unrelated crypto failure');
  });
  await assert.rejects(
    broken.hash('public test password'),
    /unrelated crypto failure/,
  );
});

test('missing or truncated hash fields never verify as an empty derived key', async () => {
  const h = new NativePwHash();
  for (const stored of [
    'scrypt$16384$8$1$' + '5a'.repeat(16) + '$',
    'pbkdf2$600000$' + '5a'.repeat(16) + '$',
  ])
    assert.equal(await h.verify('anything', stored), false);
});

test('a migrated credential survives a later native scrypt cost cap with the exact same KDF', async t => {
  const h = new NativePwHash(),
    stored = await h.hash('public test password');
  t.mock.method(crypto, 'scryptSync', () => {
    throw new RangeError('Scrypt failed: cost exceeds maximum (test cap).');
  });
  assert.equal(await h.verify('public test password', stored), true);
  assert.equal(await h.verify('wrong', stored), false);
});
