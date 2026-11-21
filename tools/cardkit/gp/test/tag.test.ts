/**
 * The tag's address: the card maker's, given in the tag's install parameters
 * and named nowhere in the card's package. Every vector of
 * spec/vectors/tag-address.json is held to this module's check, which is the
 * applet's (TagInstallTest runs the same file on the applet in jCardSim); a
 * plan cannot be made without a valid address; the install sends it in C9 and
 * the run reads it back from the tag.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {TAG_AID, TAG_CLASS_AID, CASHU_PACKAGE_AID} from '../aids';
import {fromHex, toHex} from '../bytes';
import {cashuPlan, provision} from '../provision';
import {installAndSelectable} from '../scp02';
import {
  TAG_ADDRESS_MAX,
  tagAddressProblem,
  tagInstallParameters,
  tagNdefNew,
} from '../tag';
import {CASHU_LOAD_FILE, TEST_TAG_ADDRESS} from './assets';
import {FakeCard} from '../../testing/fake-card';

interface Vectors {
  valid: {address: string; hex: string; cc: string; ndefNew: string}[];
  invalid: {why: string; hex: string}[];
}
const VECTORS: Vectors = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../spec/vectors/tag-address.json'),
    'utf8',
  ),
);
const text = (h: string) => Buffer.from(h, 'hex').toString('latin1');
const options = () => {
  let t = 0;
  return {random: (n: number) => randomBytes(n), now: () => (t += 7)};
};

describe('the tag address', () => {
  it('every valid vector passes, and its install parameters and NDEF file are the vector bytes', () => {
    assert.ok(VECTORS.valid.length >= 5);
    for (const v of VECTORS.valid) {
      assert.equal(tagAddressProblem(v.address), null, v.address);
      assert.equal(toHex(fromHex(v.hex)), toHex(Buffer.from(v.address)));
      assert.equal(
        toHex(tagInstallParameters(v.address)),
        toHex([0xc9, v.hex.length / 2, ...fromHex(v.hex)]),
      );
      assert.equal(toHex(tagNdefNew(v.address)), v.ndefNew.toUpperCase());
    }
  });

  it('every invalid vector, and a missing address, is refused with a reason, and makes no plan', () => {
    assert.ok(VECTORS.invalid.length >= 20);
    for (const v of VECTORS.invalid) {
      const address = text(v.hex);
      assert.ok(tagAddressProblem(address), v.why);
      assert.throws(() => tagInstallParameters(address), RangeError, v.why);
      assert.throws(
        () => cashuPlan(CASHU_LOAD_FILE, {tagAddress: address}),
        RangeError,
        v.why,
      );
    }
    assert.throws(
      () => cashuPlan(CASHU_LOAD_FILE, {} as {tagAddress: string}),
      /no tag address/,
    );
    assert.throws(
      () =>
        (cashuPlan as unknown as (f: typeof CASHU_LOAD_FILE) => unknown)(
          CASHU_LOAD_FILE,
        ),
      RangeError,
    );
    assert.equal(TAG_ADDRESS_MAX, 127);
  });

  it("the tag's INSTALL carries the address in C9, and the run reads it back from the tag", async () => {
    const plan = cashuPlan(CASHU_LOAD_FILE, {tagAddress: TEST_TAG_ADDRESS});
    const card = new FakeCard();
    const r = await provision(card.transceive, plan, options());
    assert.equal(r.ok, true, r.reason);
    const installs = card.log.filter(a => a[1] === 0xe6 && a[2] === 0x0c);
    assert.equal(installs.length, 3);
    // the tag's INSTALL, its MAC taken off: the module's command with the address in C9
    const sent = installs[2].slice(5, 5 + installs[2][4] - 8);
    const want = installAndSelectable(
      CASHU_PACKAGE_AID,
      TAG_CLASS_AID,
      TAG_AID,
      {
        parameters: tagInstallParameters(TEST_TAG_ADDRESS),
      },
    );
    assert.equal(toHex(sent), toHex(want.slice(5, 5 + want[4])));
    assert.ok(toHex(sent).includes(toHex(Buffer.from(TEST_TAG_ADDRESS))));
    // and the other two INSTALLs carry C9 00, as before
    for (const other of installs.slice(0, 2)) {
      assert.ok(toHex(other).includes('02C900'), toHex(other));
    }
    const read = card.log.findIndex(a => a[0] === 0x00 && a[1] === 0xb0);
    assert.ok(read > 0, 'a READ BINARY of the NDEF file');
  });

  it("a run stops at the check when the tag says another address than the plan's", async () => {
    const card = new FakeCard();
    const plan = cashuPlan(CASHU_LOAD_FILE, {tagAddress: TEST_TAG_ADDRESS});
    const other = cashuPlan(CASHU_LOAD_FILE, {
      tagAddress: 'https://example.org/card',
    });
    // the install of one address, the check of another
    const mixed = {...plan, checks: other.checks};
    const r = await provision(card.transceive, mixed, options());
    assert.equal(r.ok, false);
    assert.equal(r.phase, 'verify');
  });
});
