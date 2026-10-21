import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCardRecord,
  decodeCardRecord,
  encodeOwnerLimits,
  assertCardRecordMatches,
  readCardRecord,
} from '../configuration';
import {toHex} from '../bytes';
import {CardError} from '../scp02';
const expected = {
  unit: 0 as const,
  mint: 'https://mint.test',
  refundKey: Array(33).fill(0),
  design: 'FL1',
};
function response() {
  const d = Array(109 + expected.mint.length).fill(0);
  d[0] = 4;
  d[1] = 1;
  d[105] = expected.mint.length;
  d.splice(
    106,
    expected.mint.length,
    ...Array.from(expected.mint, c => c.charCodeAt(0)),
  );
  d.splice(106 + expected.mint.length, 3, 70, 76, 49);
  return d;
}
test('SET_CARD value pins wire offsets and ignored legacy bytes without mutating input', () => {
  const before = JSON.stringify(expected),
    value = encodeCardRecord(expected);
  assert.deepEqual(value.slice(0, 99), Array(99).fill(0));
  assert.equal(value[99], 17);
  assert.equal(
    toHex(value.slice(100)),
    '68747470733A2F2F6D696E742E74657374464C31',
  );
  assert.equal(JSON.stringify(expected), before);
  assert.deepEqual(
    encodeCardRecord({...expected, design: null}).slice(-3),
    [0, 0, 0],
  );
});
test('GET_CARD framing, unsigned amounts and comparison cannot turn missing/mismatched records into success', () => {
  const d = response();
  d.splice(3, 4, 255, 255, 255, 255);
  const record = decodeCardRecord(d);
  assert.equal(record.dailySats, 4294967295);
  assert.equal(record.rolloverBudget, 7);
  assertCardRecordMatches(expected, record);
  assert.throws(
    () =>
      assertCardRecordMatches(
        {...expected, mint: 'https://other.test'},
        record,
      ),
    /mint/,
  );
  assert.throws(
    () =>
      assertCardRecordMatches(
        expected,
        decodeCardRecord(d.map((v, i) => (i === 1 ? 0 : v))),
      ),
    /not set/,
  );
  for (const bad of [
    d.slice(1),
    [...d, 0],
    d.map((v, i) => (i === 0 ? 5 : v)),
    d.map((v, i) => (i === 105 ? 78 : v)),
    d.map((v, i) => (i === 79 ? 1 : v)),
  ])
    assert.throws(() => decodeCardRecord(bad));
});
test('invalid text, byte values, refund framing and design are rejected before encoding', () => {
  for (const change of [
    {mint: 123},
    {mint: ''},
    {mint: 'x'.repeat(78)},
    {mint: 'https://mint.test/é'},
    {unit: 1},
    {refundKey: [0, ...Array(32).fill(1)]},
    {refundKey: Array(32).fill(0)},
    {design: 'fl1'},
    {design: 'AB'},
  ])
    assert.throws(() =>
      encodeCardRecord({...expected, ...change} as typeof expected),
    );
  assert.throws(() =>
    decodeCardRecord(response().map((v, i) => (i === 7 ? 256 : v))),
  );
  const unset = Array(109).fill(0);
  unset[0] = 4;
  assert.equal(decodeCardRecord(unset).recordSet, false);
});
test('owner limit values preserve unsigned range and reject rounding or invalid budgets', () => {
  const limits = {
    dailySats: 4294967295,
    paymentSats: 256,
    noPinSats: 1,
    rolloverBudget: 30,
  };
  assert.equal(toHex(encodeOwnerLimits(limits)), 'FFFFFFFF00000100000000011E');
  for (const n of [-1, 0.1, NaN, Infinity, 4294967296])
    for (const field of ['dailySats', 'paymentSats', 'noPinSats'])
      assert.throws(() => encodeOwnerLimits({...limits, [field]: n}));
  for (const rolloverBudget of [0, 31, 1.5])
    assert.throws(() => encodeOwnerLimits({...limits, rolloverBudget}));
});
test('read-back uses one GET_CARD without deselect, authentication, mutation or retry', async () => {
  const log: string[] = [];
  const record = await readCardRecord(async a => {
    log.push(toHex(a));
    return [...response(), 0x90, 0];
  });
  assertCardRecordMatches(expected, record);
  assert.deepEqual(log, ['B016000000']);
  let calls = 0;
  await assert.rejects(
    () =>
      readCardRecord(async () => {
        calls++;
        return [0x69, 0x85];
      }),
    CardError,
  );
  assert.equal(calls, 1);
});
