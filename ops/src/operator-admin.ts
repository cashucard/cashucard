/** Deployment-owned administrator policy; accounts never grant their own roles. */
import {
  defaultPwHash,
  resolveSession,
  revokeSessionsForPrincipal,
} from './auth';
import {HttpError, type RouterDeps} from './router';

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
  authorize();
  const db = deps.db;
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
