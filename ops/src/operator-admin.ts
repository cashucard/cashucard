/** Deployment-owned administrator policy; accounts never grant their own roles. */
import {
  defaultPwHash,
  resolveSession,
  revokeSessionsForPrincipal,
} from './auth';
import {HttpError, type RouterDeps} from './router';
import {reconcileReset} from './reconciliation';
import {
  approveFedimintReissue,
  previewFedimintReissue,
  type FedimintReissuePolicy,
} from './fedimint-reissue';

/** Only deployment configuration can select the evidence signer and the two issuers. */
function recoveryPolicy(raw?: string): FedimintReissuePolicy | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw);
    const httpsOrigin = (s: unknown) => {
      if (typeof s !== 'string' || s.length > 256) return false;
      const url = new URL(s);
      return url.protocol === 'https:' && url.origin === s;
    };
    if (
      Object.keys(value).sort().join(',') ===
        'public_key_hex,source_origin,target_origin' &&
      httpsOrigin(value.target_origin) &&
      httpsOrigin(value.source_origin) &&
      value.source_origin !== value.target_origin &&
      typeof value.public_key_hex === 'string' &&
      /^[0-9a-f]{64}$/.test(value.public_key_hex)
    )
      return value;
  } catch {
    /* Do not echo a malformed deployment setting. */
  }
  return undefined;
}

const fail = (status: number, code: string): never => {
  throw new HttpError(status, code, code);
};
export async function operatorAdminRequest(
  deps: RouterDeps,
  token: string | null,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<[number, unknown]> {
  const authorize = () => {
    const session = resolveSession(deps.db, token);
    if (!session) return fail(401, 'no-session');
    let names: unknown;
    try {
      names = JSON.parse(deps.operatorAdmins?.() ?? '[]');
    } catch {
      return fail(503, 'operator-admin-policy-invalid');
    }
    if (
      !Array.isArray(names) ||
      !names.every(
        x => typeof x === 'string' && /^[A-Za-z0-9._@-]{1,64}$/.test(x),
      )
    )
      return fail(503, 'operator-admin-policy-invalid');
    const row = deps.db.db
      .prepare('SELECT name FROM operators WHERE id = ?')
      .get(session.principalId) as {name: string} | undefined;
    if (!row || !names.includes(row.name))
      return fail(403, 'operator-admin-required');
    return session.principalId;
  };
  const actor = authorize();
  const db = deps.db;
  const reconciliation =
    /^\/admin\/provisioning\/attempts\/([^/]+)\/reconcile-reset$/.exec(path);
  if (method === 'POST' && reconciliation)
    return [200, {receipt: reconcileReset(db, actor, reconciliation[1], body)}];
  const fedimint =
    /^\/admin\/provisioning\/attempts\/([^/]+)\/fedimint-reset\/(preview|approve)$/.exec(
      path,
    );
  if (method === 'POST' && fedimint) {
    const configured = deps.fedimintReissueTrust?.();
    if (configured === undefined) return fail(503, 'fedimint-reissue-disabled');
    const policy = recoveryPolicy(configured);
    if (!policy) return fail(503, 'fedimint-reissue-policy-invalid');
    const [, attemptId, action] = fedimint;
    return action === 'preview'
      ? [200, {preview: previewFedimintReissue(db, attemptId, body, policy)}]
      : [
          200,
          {receipt: approveFedimintReissue(db, actor, attemptId, body, policy)},
        ];
  }
  if (method === 'GET' && path === '/admin/provisioning/attempts') {
    const policy = recoveryPolicy(deps.fedimintReissueTrust?.());
    const attempts = db.db
      .prepare(
        `SELECT a.attempt_id,a.batch_id,a.ordinal,a.operator_id,a.device_id,a.state,a.revision,
        a.chip_id,a.created,a.fence_released,
        json_extract(a.bind_receipt,'$.bound_at') AS target_bound_at,
        f.receipt_json AS approved_receipt,
        (a.state='quarantined' AND a.revision=2 AND a.chip_id IS NOT NULL AND a.fence_released=0
         AND a.bind_receipt IS NOT NULL AND a.disposition_receipt IS NOT NULL
         AND a.disposition_json=? AND NOT EXISTS (
           SELECT 1 FROM provisioning_records r WHERE r.attempt_id=a.attempt_id
         )) AS candidate
        FROM provisioning_attempts a LEFT JOIN fedimint_reissues f ON f.attempt_id=a.attempt_id
        ORDER BY a.created DESC,a.attempt_id DESC LIMIT 100`,
      )
      .all(
        JSON.stringify({kind: 'quarantined', reason: 'authentication-failed'}),
      ) as {
      candidate: number;
      approved_receipt: string | null;
      [field: string]: unknown;
    }[];
    const visible = attempts.map(
      ({candidate, target_bound_at, approved_receipt, ...row}) => {
        const reviewable = candidate === 1 && policy !== undefined;
        return {
          ...row,
          fedimint_reset_reviewable: reviewable,
          ...(approved_receipt
            ? {fedimint_reissue_receipt: JSON.parse(approved_receipt)}
            : {}),
          ...(reviewable
            ? {
                fedimint_reset_target: {
                  target_origin: policy.target_origin,
                  source_origin: policy.source_origin,
                  attempt_id: row.attempt_id,
                  revision: row.revision,
                  chip_id: row.chip_id,
                  target_bound_at,
                },
              }
            : {}),
        };
      },
    );
    return [200, {attempts: visible}];
  }
  if (method === 'GET' && path === '/admin/operators')
    return [
      200,
      {
        operators: db.db
          .prepare(
            'SELECT id,name,key_env,created,disabled FROM operators ORDER BY id',
          )
          .all(),
      },
    ];
  if (method === 'GET' && path === '/admin/operators/audit')
    return [
      200,
      {
        events: db.db
          .prepare('SELECT * FROM operator_audit ORDER BY id DESC LIMIT 100')
          .all(),
      },
    ];
  if (method !== 'POST') return fail(404, 'not-found');
  const create = path === '/admin/operators';
  const match =
    /^\/admin\/operators\/([1-9][0-9]*)\/(disable|enable|reset-password)$/.exec(
      path,
    );
  if (!create && !match) return fail(404, 'not-found');
  const action = create ? 'create' : match![2];
  const fields = create
    ? ['name', 'password', 'keyEnv']
    : action === 'reset-password'
      ? ['password']
      : [];
  if (Object.keys(body).some(k => !fields.includes(k)))
    return fail(400, 'bad-field');
  if (
    create &&
    (typeof body.name !== 'string' ||
      !/^[A-Za-z0-9._@-]{1,64}$/.test(body.name) ||
      (body.keyEnv !== undefined &&
        body.keyEnv !== 'issued' &&
        body.keyEnv !== 'factory'))
  )
    return fail(400, 'bad-field');
  let hash: string | undefined;
  if (create || action === 'reset-password') {
    if (
      typeof body.password !== 'string' ||
      body.password.length < 12 ||
      body.password.length > 1024
    )
      return fail(400, 'bad-password');
    hash = await (deps.passwordHasher ?? defaultPwHash).hash(body.password);
  }
  return db.db.transaction(() => {
    // Hashing yields: session and deployment authorization must still be live.
    const actor = authorize();
    let id = create ? 0 : Number(match![1]);
    if (!Number.isSafeInteger(id)) return fail(400, 'bad-id');
    if (create) {
      if (
        db.db
          .prepare('SELECT id FROM operators WHERE name = ?')
          .get(body.name as string)
      )
        return fail(409, 'operator-exists');
      db.db
        .prepare(
          'INSERT INTO operators (name,password_hash,key_env,created) VALUES (?,?,?,?)',
        )
        .run(
          body.name as string,
          hash!,
          String(body.keyEnv ?? 'issued'),
          db.now(),
        );
      id = (
        db.db
          .prepare('SELECT id FROM operators WHERE name = ?')
          .get(body.name as string) as {id: number}
      ).id;
    } else {
      if (!db.db.prepare('SELECT id FROM operators WHERE id = ?').get(id))
        return fail(404, 'operator-not-found');
      if (action === 'disable' && id === actor)
        return fail(409, 'cannot-disable-self');
      if (action === 'reset-password')
        db.db
          .prepare('UPDATE operators SET password_hash = ? WHERE id = ?')
          .run(hash!, id);
      else
        db.db
          .prepare('UPDATE operators SET disabled = ? WHERE id = ?')
          .run(action === 'disable' ? 1 : 0, id);
      revokeSessionsForPrincipal(db, id);
    }
    db.db
      .prepare(
        'INSERT INTO operator_audit (actor_id,target_id,action,created) VALUES (?,?,?,?)',
      )
      .run(actor, id, action, db.now());
    return [create ? 201 : 200, {id, action}] as [number, unknown];
  });
}
