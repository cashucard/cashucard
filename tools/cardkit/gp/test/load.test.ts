/** The load file as LOAD commands: reassembly, the last-block flag, the counter, the limits. */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {describe, it} from 'node:test';

import {fromHex} from '../bytes';
import {splitLoad} from '../scp02';
import {CASHU_LOAD_FILE, HELLO_LOAD_FILE} from './assets';

function reassemble(apdus: number[][]): number[] {
  return apdus.flatMap(a => a.slice(5, 5 + a[4]));
}

describe('splitLoad', () => {
  it('cuts the card load file into 82 blocks of 247 bytes, the last 61, which reassemble to it', () => {
    const file = fromHex(CASHU_LOAD_FILE.hex);
    assert.equal(file.length, 20068);
    assert.equal(
      createHash('sha256').update(Buffer.from(file)).digest('hex'),
      CASHU_LOAD_FILE.sha256,
    );
    const apdus = splitLoad(file);
    assert.equal(apdus.length, 82);
    assert.equal(apdus[81][4], 61);
    assert.ok(apdus.slice(0, 81).every(a => a[4] === 247));
    assert.deepEqual(reassemble(apdus), file);
  });

  it('marks only the last block with P1 80 and counts P2 from 0, with Le as gp sends it', () => {
    const apdus = splitLoad(fromHex(CASHU_LOAD_FILE.hex));
    apdus.forEach((a, i) => {
      assert.deepEqual(a.slice(0, 4), [
        0x80,
        0xe8,
        i === apdus.length - 1 ? 0x80 : 0x00,
        i,
      ]);
      assert.equal(a.length, 5 + a[4] + 1);
      assert.equal(a[a.length - 1], 0x00);
      assert.ok(a[4] + 8 <= 255, 'Lc + 8 fits a short APDU');
    });
  });

  it('sends the hello file in two blocks', () => {
    const file = fromHex(HELLO_LOAD_FILE.hex);
    const apdus = splitLoad(file);
    assert.equal(apdus.length, Math.ceil(file.length / 247));
    assert.deepEqual(reassemble(apdus), file);
  });

  it('takes a smaller block size (128: 157 blocks for the card)', () => {
    const file = fromHex(CASHU_LOAD_FILE.hex);
    const apdus = splitLoad(file, 128);
    assert.equal(apdus.length, 157);
    assert.deepEqual(reassemble(apdus), file);
  });

  it('refuses a block with no room for the C-MAC, and a file of more than 256 blocks', () => {
    assert.throws(() => splitLoad([1, 2, 3], 248), RangeError);
    assert.throws(() => splitLoad([1, 2, 3], 0), RangeError);
    assert.throws(
      () => splitLoad(Array.from(randomBytes(256 * 247 + 1))),
      /256/,
    );
    assert.equal(splitLoad(Array.from(randomBytes(256 * 247))).length, 256);
    assert.throws(() => splitLoad([]), RangeError);
  });

  it('leaves the file it is given as it was', () => {
    const file = Array.from(randomBytes(600));
    const copy = file.slice();
    splitLoad(file);
    assert.deepEqual(file, copy);
  });
});
