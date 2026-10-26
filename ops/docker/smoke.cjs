/** One disposable container journey; no cards, external services or production credentials. */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');

const image = process.env.OPS_TEST_IMAGE || 'cashu-card-ops:test';
const id = `ops-test-${randomUUID()}`;
const volumes = ['secrets', 'data', 'backups', 'restore'].map(
  s => `${id}-${s}`,
);
const containers = [id, `${id}-restored`];
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const mount = (i, target, readonly = false) => [
  '--mount',
  `type=volume,src=${volumes[i]},dst=${target}${readonly ? ',readonly' : ''}`,
];
const code = (script, ...extra) =>
  docker(
    'run',
    '--rm',
    ...mount(0, '/secrets'),
    ...extra,
    '--entrypoint',
    'node',
    image,
    '-e',
    script,
  );
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(origin, path = '/healthz', status = 200) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + path)).status === status) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Container did not reach expected ${path} status`);
}
async function request(origin, path, body, token) {
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? {'content-type': 'application/json'} : {}),
      ...(token ? {authorization: `Bearer ${token}`} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return {status: response.status, body: await response.json()};
}
function run(name, data, setup = true) {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs',
    '/tmp',
    '-p',
    '127.0.0.1::8821',
    ...mount(0, '/secrets', true),
    ...mount(data, '/data'),
    ...mount(2, '/backups'),
    '-e',
    'OPS_MASTER_KEY_FILE=/secrets/master-key',
    ...(setup
      ? ['-e', 'OPS_OPERATOR_SETUP_FILE=/secrets/operator-setup.json']
      : []),
    '-e',
    'OPS_OPERATOR_ADMINS=["issuer-admin"]',
    '-e',
    'OPS_MINTS=["https://mint.example"]',
    image,
  );
  return `http://127.0.0.1:${docker('port', name, '8821/tcp').split(':').pop()}`;
}
async function main() {
  try {
    assert.throws(() => docker('run', '--rm', image));
    assert.equal(
      docker(
        'run',
        '--rm',
        '--entrypoint',
        'node',
        image,
        '-e',
        "const fs=require('fs');process.stdout.write(String(['node_modules/typescript','node_modules/wrangler','node_modules/@cashu-card/cardkit/node_modules','dist/pcsc-reset.js'].every(p=>!fs.existsSync(p))))",
      ),
      'true',
      'Runtime contains production dependencies and server commands only',
    );
    for (const volume of volumes) docker('volume', 'create', volume);
    docker(
      'run',
      '--rm',
      ...mount(0, '/secrets'),
      image,
      'init',
      'issuer-admin',
    );
    const setup = JSON.parse(
      code(
        "process.stdout.write(require('fs').readFileSync('/secrets/operator-setup.json','utf8'))",
      ),
    );
    const before = code(
      "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('/secrets/master-key')).digest('hex'))",
    );
    assert.throws(() =>
      docker(
        'run',
        '--rm',
        ...mount(0, '/secrets'),
        image,
        'init',
        'issuer-admin',
      ),
    );
    assert.equal(
      code(
        "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('/secrets/master-key')).digest('hex'))",
      ),
      before,
    );
    const recipient = code(
      "(async()=>{const age=require('age-encryption');const identity=await age.generateIdentity();require('fs').writeFileSync('/secrets/recovery-identity',identity,{mode:0o600});process.stdout.write(await age.identityToRecipient(identity))})().catch(()=>process.exit(1))",
    );
    let origin = run(id, 1);
    await waitFor(origin, '/readyz');
    docker('exec', id, 'node', 'healthcheck.cjs');
    console.log('Container startup and operator bootstrap verified.');
    assert.notEqual(docker('exec', id, 'id', '-u'), '0');
    assert.equal(docker('inspect', '--format', '{{.Config.User}}', id), 'node');
    assert.equal((await request(origin, '/admin/operators')).status, 401);
    const login = await request(origin, '/auth/operator/session', {
      name: setup.name,
      password: setup.password,
    });
    assert.equal(login.status, 200);
    const token = login.body.token;
    const batch = await request(
      origin,
      '/provisioning/batches',
      {
        device_id: randomUUID(),
        batch_request_id: randomUUID(),
        count: 1,
        mint_url: 'https://mint.example',
        pin_policy: 'perCard',
        daily_usd: 10,
        no_pin_usd: 1,
        load_sha256: 'ab'.repeat(32),
      },
      token,
    );
    assert.equal(batch.status, 200);
    docker('stop', '--time', '20', id);
    assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', id), '0');
    docker('start', id);
    origin = `http://127.0.0.1:${docker('port', id, '8821/tcp').split(':').pop()}`;
    await waitFor(origin, '/readyz');
    assert.equal(
      (await request(origin, '/admin/operators', undefined, token)).status,
      200,
      'A repeated bootstrap nonce preserves sessions',
    );
    const saved = await request(origin, '/registry/batches', undefined, token);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.batches.length, 1, 'Batch state survives restart');
    const backup = docker(
      'exec',
      '-e',
      `OPS_BACKUP_RECIPIENT=${recipient}`,
      id,
      'node',
      'dist/standalone.js',
      'backup',
    );
    const name = backup.split(': ').pop();
    assert.match(name, /^[0-9]+-[a-f0-9-]+\.age$/);
    docker(
      'run',
      '--rm',
      ...mount(0, '/secrets', true),
      ...mount(2, '/backups', true),
      ...mount(3, '/data'),
      '-e',
      'OPS_RECOVERY_IDENTITY_FILE=/secrets/recovery-identity',
      image,
      'restore',
      `/backups/${name}`,
    );
    const recovered = run(containers[1], 3, false);
    await waitFor(recovered);
    assert.equal(
      (await fetch(recovered + '/readyz')).status,
      503,
      'Restoration retains the recovery fence',
    );
    assert.equal(
      docker(
        'exec',
        containers[1],
        'node',
        '-e',
        "const {OpsDb}=require('./dist/db');const {openSqliteFile}=require('./dist/sqlite-file');const db=new OpsDb({sql:openSqliteFile(process.env.OPS_DB)});process.stdout.write(String(db.db.prepare('SELECT COUNT(*) AS n FROM issued_keys').get().n));db.close()",
      ),
      '1',
      'Encrypted recovery retains the issued key mapping',
    );
    assert.equal(
      (
        await request(recovered, '/auth/operator/session', {
          name: setup.name,
          password: setup.password,
        })
      ).status,
      401,
      'Restored credentials remain disabled',
    );
    const output = docker('logs', id);
    assert.ok(
      !output.includes(setup.password) && !output.includes(token),
      'Logs exclude credentials',
    );
    console.log(
      'Container checks passed: bootstrap, auth, batch, restart, shutdown, encrypted backup and fenced restore.',
    );
  } finally {
    for (const name of containers) {
      try {
        docker('rm', '-f', name);
      } catch {}
    }
    for (const volume of volumes) {
      try {
        docker('volume', 'rm', volume);
      } catch {}
    }
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
