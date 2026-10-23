import {expect, it} from 'vitest';
import {NativePwHash} from '../../src/pwhash';

it('native memory-hard profile hashes and verifies inside workerd without a WebCrypto downgrade', async () => {
  const h = new NativePwHash(),
    stored = await h.hash('public workerd fixture');
  expect(stored).toMatch(/^scrypt\$32768\$8\$3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  expect(await h.verify('public workerd fixture', stored)).toBe(true);
  expect(await h.verify('wrong fixture', stored)).toBe(false);
});
