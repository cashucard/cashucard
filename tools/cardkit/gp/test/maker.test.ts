/**
 * The card maker's settings file (maker/maker.json): the shared repository's
 * is the neutral example, and every rule of maker/maker.schema.json is held
 * here as tools/maker/test_maker.py holds it for the Python checker.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {MakerError, parseMaker} from '../maker';

const ROOT = join(__dirname, '../../../..');
const FILE = JSON.parse(
  readFileSync(join(ROOT, 'maker/maker.json'), 'utf8'),
) as Record<string, unknown>;
const VECTORS = JSON.parse(
  readFileSync(join(ROOT, 'spec/vectors/tag-address.json'), 'utf8'),
) as {invalid: {hex: string; why: string}[]};

const good = {
  example: false,
  name: 'A card maker',
  tagAddress: 'https://cards.example.net/c',
  securityDomain: {aid: 'A00000015153504341534400', dapPublicKey: '04AB'},
  designCodes: ['ZZ1', 'ZZ2'],
};

describe('maker/maker.json', () => {
  it("the shared repository's file is valid, the neutral example, and names no maker", () => {
    const m = parseMaker(FILE);
    assert.equal(m.example, true);
    assert.equal(m.tagAddress, 'https://example.com/card');
    assert.equal(m.securityDomain, null);
    assert.deepEqual(m.designCodes, []);
    assert.match(m.name, /^Example/);
  });

  it('a maker of its own is read whole', () => {
    assert.deepEqual(parseMaker(good), good);
    assert.deepEqual(
      parseMaker({...good, securityDomain: null}).securityDomain,
      null,
    );
  });

  it('refuses every broken file with a message that names the field', () => {
    const bad: [unknown, RegExp][] = [
      [null, /not a JSON object/],
      [[], /not a JSON object/],
      [{...good, extra: 1}, /unknown field "extra"/],
      [{...good, example: 'no'}, /example/],
      [{...good, name: ''}, /name/],
      [{...good, name: 'x'.repeat(65)}, /name/],
      [{...good, tagAddress: undefined}, /tagAddress/],
      [{...good, securityDomain: {aid: 'a0000001'}}, /securityDomain.aid/],
      [
        {...good, securityDomain: {aid: 'A0000001515353', key: 'x'}},
        /unknown field "key"/,
      ],
      [
        {
          ...good,
          securityDomain: {aid: 'A0000001515353', dapPublicKey: 'secret'},
        },
        /dapPublicKey/,
      ],
      [{...good, designCodes: ['fx1']}, /designCodes/],
      [{...good, designCodes: ['ZZ1', 'ZZ1']}, /designCodes/],
    ];
    for (const [value, why] of bad) {
      assert.throws(() => parseMaker(value), MakerError);
      assert.throws(() => parseMaker(value), why);
    }
    const {designCodes: _, ...noCodes} = good;
    assert.throws(() => parseMaker(noCodes), /no designCodes/);
  });

  it('refuses every invalid tag address of spec/vectors/tag-address.json', () => {
    for (const v of VECTORS.invalid) {
      const tagAddress = Buffer.from(v.hex, 'hex').toString('latin1');
      assert.throws(
        () => parseMaker({...good, tagAddress}),
        /tagAddress/,
        v.why,
      );
    }
  });
});
