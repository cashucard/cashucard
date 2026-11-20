import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectInstallation, InspectionError} from '../inspect';
import {CardError, type Transceiver} from '../scp02';
import {fromHex, toHex} from '../bytes';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const info = [2, 1, ...Array(28).fill(0)];
const ok = (data: number[] = []) => [...data, 0x90, 0];
/** GET_CHANGE's page 0 on a 2.1 or 2.2 card: a count, then 80 bytes for each opening owed. */
const change = (owed: number) => ok([owed, ...Array(80 * owed).fill(7)]);
function script(replies: number[][]) {
  const log: string[] = [];
  const tx: Transceiver = async command => {
    log.push(toHex(command));
    assert.ok(replies.length, 'unexpected extra APDU');
    return replies.shift()!;
  };
  return {tx, log};
}
test('inspection reads the full applet identity and tag without authentication', async () => {
  const {tx, log} = script([
    ok([2, 1]),
    ok(info),
    change(0),
    ok(fromHex(key)),
    ok(),
  ]);
  assert.deepEqual(await inspectInstallation(tx), {
    state: 'present',
    installationId: key,
    empty: true,
    tagVerified: true,
    publicState: {
      unspent: 0,
      spent: 0,
      pin: false,
      record: false,
      owner: false,
      changeOwed: false,
    },
  });
  assert.deepEqual(log, [
    '00A404000BF04341534855434152440100',
    'B001000000',
    'B019000000',
    'B010000021',
    '00A4040007D276000085010100',
  ]);
});
test('a 2.2 card (D175: GET_OUTBOX added) and a 3.0 card are inspected as a 2.1 card is', async () => {
  for (const version of [
    [2, 2],
    [3, 0],
  ]) {
    const info = [...version, ...Array(28).fill(0)];
    const two = version[0] === 2;
    // a 3.0 card says the change owed in GET_INFO byte 29 and is not asked GET_CHANGE
    const {tx, log} = script([
      ok(version),
      ok(info),
      ...(two ? [change(0)] : []),
      ok(fromHex(key)),
      ok(),
    ]);
    assert.equal((await inspectInstallation(tx)).state, 'present');
    assert.equal(log.includes('B019000000'), two);
  }
});
// GET_INFO P1 0 of a 3.0 card in jCardSim: a 100 piece paid with 40 change owed, the till gone before LOAD_CHANGE,
// then CLEAR_SPENT under the PIN. No unspent and no spent place; byte 29 = 1.
const OWED_30 = fromHex(
  '030080000080ff0104030001000003e8016b49d2006b49d2000000006401',
);
test('a 3.0 card that owes change is not empty, though it has no unspent and no spent place', async () => {
  const {tx, log} = script([ok([3, 0]), ok(OWED_30), ok(fromHex(key)), ok()]);
  const seen = await inspectInstallation(tx);
  assert.equal(seen.state, 'present');
  if (seen.state !== 'present') return;
  assert.equal(seen.empty, false);
  assert.deepEqual(
    [
      seen.publicState.unspent,
      seen.publicState.spent,
      seen.publicState.changeOwed,
    ],
    [0, 0, true],
  );
  assert.equal(log.includes('B019000000'), false);
  // the same card with byte 29 = 0 owes nothing
  const settled = OWED_30.slice();
  settled[29] = 0;
  const clear = script([ok([3, 0]), ok(settled), ok(fromHex(key)), ok()]);
  const none = await inspectInstallation(clear.tx);
  assert.ok(none.state === 'present' && !none.publicState.changeOwed);
});
test('a 2.1 or 2.2 card is asked GET_CHANGE, and one opening owed makes it not empty', async () => {
  for (const minor of [1, 2]) {
    for (const owed of [1, 3]) {
      const {tx} = script([
        ok([2, minor]),
        ok([2, minor, ...Array(28).fill(0)]),
        change(owed),
        ok(fromHex(key)),
        ok(),
      ]);
      const seen = await inspectInstallation(tx);
      assert.ok(seen.state === 'present');
      if (seen.state !== 'present') return;
      assert.equal(seen.empty, false, `2.${minor}, ${owed} owed`);
      assert.equal(seen.publicState.changeOwed, true);
    }
  }
});
test('a GET_CHANGE that is refused or is not a count and its openings stops the inspection', async () => {
  for (const reply of [
    [0x6d, 0x00],
    ok([]),
    ok([1]),
    ok([1, ...Array(83).fill(0)]),
    ok([4, ...Array(320).fill(0)]),
  ]) {
    const {tx, log} = script([
      ok([2, 2]),
      ok([2, 2, ...Array(28).fill(0)]),
      reply,
    ]);
    await assert.rejects(() => inspectInstallation(tx), CardError);
    assert.equal(log.length, 3, 'nothing after GET_CHANGE');
  }
});
test('absence, nonempty state and a missing tag remain distinct inspection evidence', async () => {
  const absent = script([[0x6a, 0x82]]);
  assert.deepEqual(await inspectInstallation(absent.tx), {state: 'absent'});
  assert.equal(absent.log.length, 1);
  const funded = info.slice();
  funded[3] = 1;
  const partial = script([
    ok([2, 1]),
    ok(funded),
    change(0),
    ok(fromHex(key)),
    [0x6a, 0x82],
  ]);
  assert.deepEqual(await inspectInstallation(partial.tx), {
    state: 'present',
    installationId: key,
    empty: false,
    tagVerified: false,
    publicState: {
      unspent: 1,
      spent: 0,
      pin: false,
      record: false,
      owner: false,
      changeOwed: false,
    },
  });
});
test('unknown versions, malformed responses and card refusal stop without retries', async () => {
  for (const replies of [
    [ok([2, 0])],
    [ok([2, 3])],
    [ok([2, 4])],
    [ok([3, 1])],
    [ok([4, 0])],
    [ok([2, 1, 0])],
    // a 3.0 card's GET_INFO saying 2.x
    [ok([3, 0]), ok(info)],
    // GET_INFO's version not SELECT's
    [ok([2, 2]), ok(info)],
    [ok([2, 1]), ok(info.slice(1))],
    [ok([2, 1]), ok(info), change(0), ok([4, ...Array(32).fill(1)])],
  ]) {
    const {tx, log} = script(replies.slice());
    await assert.rejects(() => inspectInstallation(tx), InspectionError);
    assert.equal(log.length, replies.length);
  }
  const refused = script([[0x69, 0x85]]);
  await assert.rejects(() => inspectInstallation(refused.tx), CardError);
  assert.equal(refused.log.length, 1);
});
