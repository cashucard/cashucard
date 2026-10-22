import {createHash} from 'node:crypto';
import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';

import worker, {OpsStore} from '../../src/worker';
import {createBatch} from '../../src/batches';
import {recordCard, getCard} from '../../src/registry';
import {OpsDb} from '../../src/db';
import {openSqlStorage} from '../../src/sql-do';
import {decryptEscrowExport, restoreEscrowExport} from '../../src/export';
import {issueKeys, HolderIssueState} from '../../src/issue';

// Public throwaway TEST identity, matching the recipient in the test config.
const TEST_IDENTITY =
  'AGE-SECRET-KEY-1J3FJ0UXHZWAZQN7EHJL2NHNE8CSQNJU9DYH4GT77ZRXJG7Y7N92QLLVPMZ';

it('the scheduled R2 artifact restores a registered card without the original master', async () => {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName('ops'));
  const expected = await runInDurableObject(stub, (_instance, ctx) => {
    const db = new OpsDb({
      sql: openSqlStorage(ctx.storage),
      master: {getMaster: () => Buffer.alloc(32, 90)},
    });
    const batch = createBatch(db, {
      count: 1,
      mintUrl: 'https://example.invalid',
      pinPolicy: 'perCard',
      dailyUsd: 25,
      noPinUsd: 5,
      loadSha256: 'test-cap',
      operatorId: 1,
    });
    recordCard(db, {
      short_id: 'abcdef12',
      batch_id: batch.id,
      key_id: 1,
      ordinal: 0,
      installed_at: 1000,
      installer: 'test',
      load_sha256: 'test-cap',
    });
    const keys = issueKeys(
      db,
      batch.id,
      0,
      {kind: 'operator'},
      new HolderIssueState(),
    );
    if (!keys.ok) throw new Error('test issuance failed');
    return keys.keys.enc.toString('hex');
  });
  expect((await stub.fetch('https://test/ops/backup-status')).status).toBe(401);
  const login = await stub.fetch('https://test/auth/operator/session', {
    method: 'POST',
    body: JSON.stringify({
      name: 'lead-setup',
      password: 'correct horse battery',
    }),
  });
  const {token} = (await login.json()) as {token: string};
  const status = () =>
    stub.fetch('https://test/ops/backup-status', {
      headers: {authorization: `Bearer ${token}`},
    });
  expect((await status()).status).toBe(503);
  await worker.scheduled({}, env);
  expect((await status()).status).toBe(200);
  const objects = await env.OPS_BACKUPS!.list({prefix: 'escrow/'});
  expect(objects.objects.length).toBe(1);
  const object = await env.OPS_BACKUPS!.get(objects.objects[0]!.key);
  const armored = await object!.text();
  const payload = await decryptEscrowExport(armored, TEST_IDENTITY);
  expect(object!.customMetadata).toEqual({
    version: '1',
    exported_at: String(payload.exported_at),
    ciphertext_sha256: createHash('sha256').update(armored).digest('hex'),
    ciphertext_bytes: String(new TextEncoder().encode(armored).length),
  });
  const recovered = await runInDurableObject(
    env.OPS_DO.get(env.OPS_DO.idFromName('restored-service')),
    (_instance, ctx) => {
      const db = new OpsDb({sql: openSqlStorage(ctx.storage)});
      // Remove only this fresh test object's bootstrap rows before restoration.
      db.db.exec('DELETE FROM operator_setup_commands; DELETE FROM operators');
      restoreEscrowExport(db.db, payload);
      const card = getCard(db, 'abcdef12')!;
      const keys = issueKeys(
        db,
        card.batch_id,
        card.ordinal,
        {kind: 'operator'},
        new HolderIssueState(),
      );
      if (!keys.ok) throw new Error('test restored issuance failed');
      return keys.keys.enc.toString('hex');
    },
  );
  expect(recovered).toBe(expected);
  await runInDurableObject(stub, async (_instance, ctx) => {
    await ctx.storage.put('backup-status', {
      last_success_at: 1,
      key: object!.key,
    });
  });
  expect((await status()).status).toBe(503);
});

it('missing backup configuration fails instead of reporting a successful cron', async () => {
  const stub = env.OPS_DO.get(env.OPS_DO.idFromName('missing-backup-config'));
  await runInDurableObject(stub, async instance => {
    const store = instance as OpsStore;
    const bindings = (store as unknown as {env: {OPS_BACKUPS?: R2Bucket}}).env;
    const bucket = bindings.OPS_BACKUPS;
    try {
      bindings.OPS_BACKUPS = undefined;
      await expect(store.exportEscrow()).rejects.toThrow(
        'backup configuration is incomplete',
      );
    } finally {
      bindings.OPS_BACKUPS = bucket;
    }
  });
});
