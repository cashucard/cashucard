import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {SubtlePwHash} from '../src/pwhash';

test('deployed PBKDF2 iteration cap preserves the 600k format and interoperable hash', async t => {
  t.mock.method(crypto.subtle, 'deriveBits', async () => {
    throw new DOMException(
      'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).',
      'NotSupportedError',
    );
  });
  const hasher = new SubtlePwHash();
  const stored = await hasher.hash('public test password');
  const [algorithm, iterations, salt, hash] = stored.split('$');
  assert.equal(algorithm, 'pbkdf2');
  assert.equal(iterations, '600000');
  assert.equal(
    hash,
    pbkdf2Sync(
      'public test password',
      Buffer.from(salt!, 'hex'),
      600000,
      64,
      'sha256',
    ).toString('hex'),
  );
  assert.equal(await hasher.verify('public test password', stored), true);
  assert.equal(await hasher.verify('wrong password', stored), false);
});

test('unrelated WebCrypto errors fail closed', async t => {
  t.mock.method(crypto.subtle, 'deriveBits', async () => {
    throw new DOMException('unrelated failure', 'OperationError');
  });
  await assert.rejects(new SubtlePwHash().hash('public test password'), {
    name: 'OperationError',
  });
});
