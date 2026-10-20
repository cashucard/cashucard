/** HTTP field mapping only; reservation invariants live in provisioning.ts. */
import type {Session} from './auth';
import type {OpsDb} from './db';
import {
  ProvisioningError,
  createProvisioningBatch,
  reserveAttempt,
  getAttempt,
  bindAttempt,
  recordAttempt,
  disposeAttempt,
  issueAttemptKeys,
} from './provisioning';

type Body = Record<string, unknown>;

function fields(body: Body, allowed: readonly string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ProvisioningError(400, 'bad-field', 'unexpected request field');
  }
}

function text(body: Body, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProvisioningError(400, 'bad-field', `${name} is required`);
  }
  return value;
}

function number(body: Body, name: string): number {
  const value = body[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProvisioningError(400, 'bad-field', `${name} is a finite number`);
  }
  return value;
}

function scope(session: Session, deviceId: string) {
  return {
    operator_id: session.principalId,
    device_id: deviceId,
    key_env: session.env,
  };
}

function wireKeys(result: ReturnType<typeof issueAttemptKeys>) {
  return {
    ...result,
    enc: result.enc.toString('hex'),
    mac: result.mac.toString('hex'),
    dek: result.dek.toString('hex'),
  };
}

export function provisioningHttp(
  db: OpsDb,
  session: Session,
  method: string,
  path: string,
  url: URL,
  body: Body,
): {status: number; body: unknown} {
  if (method === 'POST' && path === '/provisioning/batches') {
    fields(body, [
      'device_id',
      'batch_request_id',
      'count',
      'mint_url',
      'pin_policy',
      'daily_usd',
      'no_pin_usd',
      'load_sha256',
    ]);
    const batch = createProvisioningBatch(
      db,
      scope(session, text(body, 'device_id')),
      {
        batch_request_id: text(body, 'batch_request_id'),
        count: number(body, 'count'),
        mint_url: text(body, 'mint_url'),
        pin_policy: text(body, 'pin_policy') as 'batch' | 'perCard',
        daily_usd: number(body, 'daily_usd'),
        no_pin_usd: number(body, 'no_pin_usd'),
        load_sha256: text(body, 'load_sha256'),
      },
    );
    return {status: 200, body: {batch}};
  }
  if (method === 'POST' && path === '/provisioning/attempts') {
    fields(body, ['device_id', 'attempt_id', 'batch_id', 'ordinal']);
    const attempt = reserveAttempt(
      db,
      scope(session, text(body, 'device_id')),
      {
        attempt_id: text(body, 'attempt_id'),
        batch_id: number(body, 'batch_id'),
        ordinal: number(body, 'ordinal'),
      },
    );
    return {status: 200, body: {attempt}};
  }
  const matched = path.match(
    /^\/provisioning\/attempts\/([^/]+)(?:\/(bind|record|disposition))?$/,
  );
  if (matched) {
    const [, id, action] = matched;
    if (method === 'GET' && !action) {
      return {
        status: 200,
        body: {
          attempt: getAttempt(
            db,
            scope(session, url.searchParams.get('device_id') ?? ''),
            id!,
          ),
        },
      };
    }
    if (method === 'POST' && action) {
      const actor = scope(session, text(body, 'device_id'));
      if (action === 'bind') {
        fields(body, ['device_id', 'revision', 'chip_id']);
        return {
          status: 200,
          body: {
            receipt: bindAttempt(db, actor, id!, {
              revision: number(body, 'revision'),
              chip_id: text(body, 'chip_id'),
            }),
          },
        };
      }
      if (action === 'record') {
        fields(body, ['device_id', 'revision', 'record']);
        return {
          status: 200,
          body: {
            receipt: recordAttempt(db, actor, id!, {
              revision: number(body, 'revision'),
              record: body.record as Parameters<
                typeof recordAttempt
              >[3]['record'],
            }),
          },
        };
      }
      fields(body, ['device_id', 'revision', 'kind', 'reason']);
      return {
        status: 200,
        body: {
          receipt: disposeAttempt(db, actor, id!, {
            revision: number(body, 'revision'),
            kind: text(body, 'kind') as 'quarantined' | 'abandoned',
            reason: text(body, 'reason'),
          }),
        },
      };
    }
  }
  return {status: 404, body: {reason: 'no-such-route'}};
}

/** Retain the URL while removing numeric-only legacy key lookup. */
export function reservedKeys(db: OpsDb, session: Session, body: Body): unknown {
  fields(body, ['attempt_id', 'device_id', 'batch_id', 'ordinal']);
  if (!body.attempt_id || !body.device_id) {
    throw new ProvisioningError(
      409,
      'reservation-required',
      'an authorized attempt and device are required',
    );
  }
  const result = issueAttemptKeys(
    db,
    scope(session, text(body, 'device_id')),
    text(body, 'attempt_id'),
  );
  if (
    (body.batch_id !== undefined && body.batch_id !== result.batch_id) ||
    (body.ordinal !== undefined && body.ordinal !== result.ordinal)
  ) {
    throw new ProvisioningError(
      409,
      'reservation-mismatch',
      'the numeric reference does not match the reserved attempt',
    );
  }
  return wireKeys(result);
}
