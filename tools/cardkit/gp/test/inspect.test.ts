import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectInstallation, InspectionError} from '../inspect';
import {CardError, type Transceiver} from '../scp02';
import {fromHex, toHex} from '../bytes';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const info = [2, 1, ...Array(28).fill(0)];
const ok = (data: number[] = []) => [...data, 0x90, 0];
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
  const {tx, log} = script([ok([2, 1]), ok(info), ok(fromHex(key)), ok()]);
  assert.deepEqual(await inspectInstallation(tx), {
    state: 'present',
    installationId: key,
    empty: true,
    tagVerified: true,
  });
  assert.deepEqual(log, [
    '00A404000BF04341534855434152440100',
    'B001000000',
    'B010000021',
    '00A4040007D276000085010100',
  ]);
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
    ok(fromHex(key)),
    [0x6a, 0x82],
  ]);
  assert.deepEqual(await inspectInstallation(partial.tx), {
    state: 'present',
    installationId: key,
    empty: false,
    tagVerified: false,
  });
});
test('unknown versions, malformed responses and card refusal stop without retries', async () => {
  for (const replies of [
    [ok([2, 2])],
    [ok([2, 1]), ok(info.slice(1))],
    [ok([2, 1]), ok(info), ok([4, ...Array(32).fill(1)])],
  ]) {
    const {tx, log} = script(replies.slice());
    await assert.rejects(() => inspectInstallation(tx), InspectionError);
    assert.equal(log.length, replies.length);
  }
  const refused = script([[0x69, 0x85]]);
  await assert.rejects(() => inspectInstallation(refused.tx), CardError);
  assert.equal(refused.log.length, 1);
});
