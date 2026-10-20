import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';

import {fromHex, toHex} from '../bytes';
import {CardError, TransportError, type Transceiver} from '../scp02';
import {parseCplc, readChipIdentity, ChipIdentityMismatch} from '../identity';

const CPLC = fromHex(
  '9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000',
);
const CHIP_ID = 'cplc-v1:4790d3213180072976207515';
const COMMANDS = ['00A4040008A00000015100000000', '80CA9F7F00'];

test('the owner CPLC capture yields its canonical chip identity', t => {
  const fixture = join(__dirname, 'fixtures', 'gp-info.txt');
  if (!existsSync(fixture)) {
    t.skip('pending H0 fixtures');
    return;
  }
  const captured = readFileSync(fixture, 'utf8').match(
    /\b(9F7F2A[0-9A-F]{84})\s+9000/,
  );
  assert.ok(captured);
  assert.equal(
    parseCplc(fromHex(captured[1])).id,
    'cplc-v1:4790d3213041093363205547',
  );
});

test('the USB-observed CPLC identity depends only on the chosen chip fields', () => {
  assert.equal(parseCplc(CPLC).id, CHIP_ID);
  const changed = CPLC.slice();
  // OS and personalization fields do not identify the manufactured chip.
  changed[7] ^= 1;
  changed[30] ^= 1;
  assert.equal(parseCplc(changed).id, CHIP_ID);
  for (const offset of [3, 5, 13, 15, 19]) {
    const other = CPLC.slice();
    other[offset] ^= 1;
    assert.notEqual(parseCplc(other).id, CHIP_ID);
  }
});

test('CPLC rejects malformed data and unusable serials, without calendar parsing', () => {
  const wrongTag = CPLC.slice();
  wrongTag[1] = 0x7e;
  const wrongLength = CPLC.slice();
  wrongLength[2] = 41;
  const invalidByte = CPLC.slice();
  invalidByte[4] = 256;
  const badSerials = [0, 255].map(value => {
    const data = CPLC.slice();
    data.fill(value, 15, 19);
    return data;
  });
  for (const invalid of [
    [],
    CPLC.slice(3),
    CPLC.slice(0, -1),
    [...CPLC, 0],
    wrongTag,
    wrongLength,
    invalidByte,
    ...badSerials,
  ]) {
    assert.throws(() => parseCplc(invalid), RangeError);
  }
  for (const value of [0, 255]) {
    const opaqueDate = CPLC.slice();
    opaqueDate.fill(value, 13, 15);
    assert.equal(
      parseCplc(opaqueDate).icFabricationDate,
      value.toString(16).padStart(2, '0').repeat(2),
    );
  }
});

function transport(replies: (number[] | Error)[]) {
  const commands: string[] = [];
  const tx: Transceiver = async apdu => {
    commands.push(toHex(apdu));
    const reply = replies[commands.length - 1];
    assert.ok(reply, 'unexpected extra APDU');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return {tx, commands};
}

test('identity reads send only SELECT ISD and GET DATA, and reject a mismatched chip', async () => {
  const matching = transport([
    [0x90, 0],
    [...CPLC, 0x90, 0],
  ]);
  assert.equal((await readChipIdentity(matching.tx, CHIP_ID)).id, CHIP_ID);
  assert.deepEqual(matching.commands, COMMANDS);
  const mismatch = transport([
    [0x90, 0],
    [...CPLC, 0x90, 0],
  ]);
  await assert.rejects(
    readChipIdentity(mismatch.tx, 'cplc-v1:4790d3213041093363205547'),
    ChipIdentityMismatch,
  );
  assert.deepEqual(mismatch.commands, COMMANDS);
});

test('status, malformed replies and transport loss stop identity reads without retries', async () => {
  const scenarios = [
    {replies: [[0x6a, 0x82]], error: CardError, count: 1},
    {replies: [new Error('reader lost')], error: TransportError, count: 1},
    {
      replies: [
        [0x90, 0],
        [0x6a, 0x88],
      ],
      error: CardError,
      count: 2,
    },
    {
      replies: [[0x90, 0], new Error('card removed')],
      error: TransportError,
      count: 2,
    },
    {
      replies: [
        [0x90, 0],
        [0x90, 0],
      ],
      error: RangeError,
      count: 2,
    },
    {replies: [[0x90, 0], []], error: TransportError, count: 2},
  ];
  for (const {replies, error, count} of scenarios) {
    const card = transport(replies);
    await assert.rejects(readChipIdentity(card.tx), error);
    assert.deepEqual(card.commands, COMMANDS.slice(0, count));
  }
});
