import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeHolderCommand,
  type HolderCommandOptions,
} from '../holderCommands';
import {fromHex, toHex} from '../bytes';
import {CardError, TransportError} from '../scp02';
const chipId = 'cplc-v1:4790d3213180072976207515';
const installationId =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const context = {
  chipId,
  installationId,
  configurationId: 'a'.repeat(64),
  ownerKeyReference: 'holder/card-1',
};
const proof = [0x30, 6, 2, 1, 1, 2, 1, 1];
function fixture() {
  const log: string[] = [],
    events: string[] = [];
  const replies = [
    [],
    fromHex(
      '9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000',
    ),
    [2, 1],
    fromHex(installationId),
    [2, 1, ...Array(14).fill(0), 1, ...Array(13).fill(0)],
    Array(16).fill(7),
    [],
  ];
  const tx = async (a: number[]) => {
    log.push(toHex(a));
    events.push(`apdu:${a[1]}`);
    return [...replies.shift()!, 0x90, 0];
  };
  const requests: unknown[] = [];
  const options: HolderCommandOptions = {
    sign: async request => {
      requests.push(request);
      events.push('sign');
      return proof;
    },
    saveIntent: async () => {
      events.push('intent');
    },
    canContinue: () => true,
  };
  return {tx, log, events, requests, options, replies};
}
test('identity, public context and fresh nonce are bound to one exact owner command after durable intent', async () => {
  const f = fixture();
  await executeHolderCommand(f.tx, context, {kind: 'allow-load'}, f.options);
  assert.deepEqual(f.log, [
    '00A4040008A00000015100000000',
    '80CA9F7F00',
    '00A404000BF04341534855434152440100',
    'B010000021',
    'B001000000',
    'B044000010',
    'B045000009083006020101020101',
  ]);
  assert.ok(f.events.indexOf('intent') < f.events.indexOf('apdu:68'));
  assert.ok(f.events.indexOf('sign') > f.events.indexOf('apdu:68'));
  assert.deepEqual(f.requests[0], {
    ...context,
    purpose: 'CashuCard/load',
    nonce: Array(16).fill(7),
    value: [],
    message: [
      ...Array.from('CashuCard/load', c => c.charCodeAt(0)),
      ...Array(16).fill(7),
    ],
  });
});
test('wrong identity, storage failure and cancellation while signing prevent the owner write', async () => {
  const wrong = fixture();
  await assert.rejects(() =>
    executeHolderCommand(
      wrong.tx,
      {...context, chipId: chipId.replace('7515', '7516')},
      {kind: 'allow-load'},
      wrong.options,
    ),
  );
  assert.equal(wrong.log.length, 2);
  assert.equal(wrong.requests.length, 0);
  const disk = fixture();
  disk.options.saveIntent = async () => {
    throw new Error('storage unavailable');
  };
  await assert.rejects(() =>
    executeHolderCommand(disk.tx, context, {kind: 'allow-load'}, disk.options),
  );
  assert.equal(disk.log.length, 5);
  assert.equal(disk.requests.length, 0);
  const cancel = fixture();
  let allowed = true;
  cancel.options.sign = async () => {
    allowed = false;
    return proof;
  };
  cancel.options.canContinue = () => allowed;
  await assert.rejects(
    () =>
      executeHolderCommand(
        cancel.tx,
        context,
        {kind: 'allow-load'},
        cancel.options,
      ),
    TransportError,
  );
  assert.equal(cancel.log.length, 6);
});
test('invalid proof, wrong applet and refused owner command never retry', async () => {
  const malformed = fixture();
  malformed.options.sign = async () => [0x30, 0];
  await assert.rejects(() =>
    executeHolderCommand(
      malformed.tx,
      context,
      {kind: 'allow-load'},
      malformed.options,
    ),
  );
  assert.equal(malformed.log.length, 6);
  const version = fixture();
  version.replies[2] = [2, 2];
  await assert.rejects(() =>
    executeHolderCommand(
      version.tx,
      context,
      {kind: 'allow-load'},
      version.options,
    ),
  );
  assert.equal(version.log.length, 3);
  const refused = fixture();
  const tx = async (a: number[]) =>
    a[1] === 0x45 ? (refused.log.push(toHex(a)), [0x6a, 0x91]) : refused.tx(a);
  await assert.rejects(
    () =>
      executeHolderCommand(tx, context, {kind: 'allow-load'}, refused.options),
    CardError,
  );
  assert.equal(refused.log.length, 7);
});

test('published P-256 vectors verify the exact signer message for load and thirteen-byte limits', async () => {
  const {readFileSync} = await import('node:fs');
  const {resolve} = await import('node:path');
  const {createPublicKey, verify} = await import('node:crypto');
  const vectors = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../spec/vectors/owner.json'),
      'utf8',
    ),
  );
  const key = createPublicKey({
    key: Buffer.from(
      '3059301306072a8648ce3d020106082a8648ce3d030107034200' + vectors.ownerKey,
      'hex',
    ),
    format: 'der',
    type: 'spki',
  });
  for (const kind of ['allow-load', 'set-limits'] as const) {
    const vector = vectors.proofs.find((p: {label: string; value: string}) =>
      kind === 'allow-load'
        ? p.label === 'CashuCard/load'
        : p.label === 'CashuCard/set-limit' && p.value.length === 26,
    );
    const f = fixture();
    f.replies[5] = fromHex(vector.nonce);
    f.options.sign = async request => {
      assert.equal(toHex(request.value).toLowerCase(), vector.value);
      assert.equal(
        verify(
          'sha256',
          Buffer.from(request.message),
          key,
          Buffer.from(vector.signature, 'hex'),
        ),
        true,
      );
      return fromHex(vector.signature);
    };
    await executeHolderCommand(
      f.tx,
      context,
      kind === 'allow-load'
        ? {kind}
        : {
            kind,
            limits: {
              dailySats: 5000,
              paymentSats: 100,
              noPinSats: 50,
              rolloverBudget: 7,
            },
          },
      f.options,
    );
    assert.equal(f.log.length, 7);
  }
});

test('set-card freezes public values before asynchronous approval and a lost write reply is never retried', async () => {
  const f = fixture();
  const configuration = {
    unit: 0 as const,
    mint: 'https://mint.test',
    refundKey: Array(33).fill(0),
    design: null,
  };
  f.options.saveIntent = async intent => {
    configuration.mint = 'https://changed.test';
    assert.equal(Object.isFrozen(intent.value), true);
  };
  f.options.sign = async request => {
    assert.equal(Object.isFrozen(request.message), true);
    assert.equal(request.purpose, 'CashuCard/set-card');
    return proof;
  };
  let writes = 0;
  const tx = async (a: number[]) => {
    if (a[1] === 0x32) {
      writes++;
      throw new Error('reply lost');
    }
    return f.tx(a);
  };
  await assert.rejects(
    () =>
      executeHolderCommand(
        tx,
        context,
        {kind: 'set-card', configuration},
        f.options,
      ),
    TransportError,
  );
  assert.equal(writes, 1);
});

test('a pending wallet approval excludes a concurrent command on the same transport', async () => {
  const f = fixture();
  let approve!: (value: number[]) => void;
  let signing!: () => void;
  const entered = new Promise<void>(resolve => {
    signing = resolve;
  });
  f.options.sign = () => {
    signing();
    return new Promise(resolve => {
      approve = resolve;
    });
  };
  const pending = executeHolderCommand(
    f.tx,
    context,
    {kind: 'allow-load'},
    f.options,
  );
  await entered;
  await assert.rejects(
    () => executeHolderCommand(f.tx, context, {kind: 'allow-load'}, f.options),
    /already active/,
  );
  assert.equal(f.log.length, 6);
  approve(proof);
  await pending;
  assert.equal(f.log.length, 7);
});

test('cancellation after the nonce reply prevents even invoking the wallet signer', async () => {
  const f = fixture();
  let allowed = true;
  let signs = 0;
  f.options.canContinue = () => {
    if (f.log.length === 6)
      queueMicrotask(() => {
        allowed = false;
      });
    return allowed;
  };
  f.options.sign = async () => {
    signs++;
    return proof;
  };
  await assert.rejects(
    () => executeHolderCommand(f.tx, context, {kind: 'allow-load'}, f.options),
    TransportError,
  );
  assert.equal(signs, 0);
  assert.equal(f.log.length, 6);
});
