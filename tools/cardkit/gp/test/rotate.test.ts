/**
 * Key rotation against the fake card: to the spike set and back, a PUT KEY
 * torn before and after the card takes it, the active set found from one
 * INITIALIZE UPDATE, and a card on neither set left without a failed login.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {describe, it} from 'node:test';

import {toHex} from '../bytes';
import {rotateKeys, type RotateOptions} from '../provision';
import {FACTORY_KEYS, SPIKE_KEYS, type KeySet} from '../scp02';
import {FakeCard, pullAt} from './fake-card';

function options(extra: Partial<RotateOptions> = {}): RotateOptions {
  let t = 0;
  return {random: n => randomBytes(n), now: () => (t += 5), ...extra};
}

function keysOf(card: FakeCard): string[] {
  return [toHex(card.keys.enc), toHex(card.keys.mac), toHex(card.keys.dek)];
}

function hexKeys(k: KeySet): string[] {
  return [toHex(k.enc), toHex(k.mac), toHex(k.dek)];
}

const ROTATE_ORDER = [0xa4, 0x50, 0x82, 0xd8, 0xa4, 0x50, 0x82];

describe('rotateKeys', () => {
  it('moves the card to the spike set and back, proving each with a fresh secure channel', async () => {
    const card = new FakeCard();
    const there = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(there.ok, true, there.reason);
    assert.equal(there.active, 'to');
    assert.equal(there.rotated, true);
    assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS));
    assert.equal(card.kvn, 0x01, 'replaced in place: P1 01, new version 01');
    assert.deepEqual(card.insLog(), ROTATE_ORDER);
    const putKey = card.log[3];
    assert.deepEqual(putKey.slice(0, 4), [0x84, 0xd8, 0x01, 0x81]);
    card.reset();
    const back = await rotateKeys(
      card.transceive,
      SPIKE_KEYS,
      FACTORY_KEYS,
      options(),
    );
    assert.equal(back.ok, true, back.reason);
    assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS));
    assert.equal(card.failedAuths, 0);
    assert.deepEqual(
      back.timings.map(t => t.phase),
      ['selectIsd', 'auth', 'putKey', 'reopen', 'done'],
    );
  });

  it('after a PUT KEY torn before the card took it, rotates again from the old set', async () => {
    const card = new FakeCard();
    const pull = pullAt(card, ROTATE_ORDER.indexOf(0xd8), 'before');
    const first = await rotateKeys(
      pull.tx,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(first.kind, 'pulled');
    assert.equal(first.phase, 'putKey');
    assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS));
    card.reset();
    const before = card.log.length;
    const again = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(again.ok, true, again.reason);
    assert.equal(again.rotated, true);
    assert.deepEqual(
      card.log.slice(before).map(a => a[1]),
      ROTATE_ORDER,
    );
    assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS));
    assert.equal(card.failedAuths, 0);
  });

  it('after a PUT KEY the card took but whose reply was lost, finds the new set from one INITIALIZE UPDATE', async () => {
    const card = new FakeCard();
    const pull = pullAt(card, ROTATE_ORDER.indexOf(0xd8), 'after');
    const first = await rotateKeys(
      pull.tx,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(first.kind, 'pulled');
    assert.deepEqual(
      keysOf(card),
      hexKeys(SPIKE_KEYS),
      'the card took the new keys',
    );
    card.reset();
    const before = card.log.length;
    const again = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(again.ok, true, again.reason);
    assert.equal(again.active, 'to');
    assert.equal(again.rotated, false);
    assert.deepEqual(
      card.log.slice(before).map(a => a[1]),
      [0xa4, 0x50, 0x82],
      'one INITIALIZE UPDATE, one login, no PUT KEY',
    );
    assert.equal(card.failedAuths, 0);
  });

  it('sends no EXTERNAL AUTHENTICATE to a card on neither set', async () => {
    const other: KeySet = {
      enc: randomBytes(16),
      mac: randomBytes(16),
      dek: randomBytes(16),
    };
    const card = new FakeCard({
      keys: {
        enc: Array.from(other.enc),
        mac: Array.from(other.mac),
        dek: Array.from(other.dek),
      },
    });
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'wrongKeys');
    assert.deepEqual(card.insLog(), [0xa4, 0x50]);
    assert.equal(card.failedAuths, 0);
  });

  it('comes back from a pull at any APDU, before or after the card acts, and never fails a login', async () => {
    for (const when of ['before', 'after'] as const) {
      for (let n = 0; n < ROTATE_ORDER.length; n++) {
        const card = new FakeCard();
        const pull = pullAt(card, n, when);
        const first = await rotateKeys(
          pull.tx,
          FACTORY_KEYS,
          SPIKE_KEYS,
          options(),
        );
        assert.equal(first.kind, 'pulled', `${when} ${n}`);
        assert.equal(pull.state.late, 0);
        card.reset();
        const again = await rotateKeys(
          card.transceive,
          FACTORY_KEYS,
          SPIKE_KEYS,
          options(),
        );
        assert.equal(again.ok, true, `${when} ${n}: ${again.reason}`);
        assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS));
        card.reset();
        const back = await rotateKeys(
          card.transceive,
          SPIKE_KEYS,
          FACTORY_KEYS,
          options(),
        );
        assert.equal(back.ok, true);
        assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS));
        assert.equal(card.failedAuths, 0, `${when} ${n}`);
      }
    }
  });

  it('records the PUT KEY as its INS and length only', async () => {
    const card = new FakeCard();
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    const put = r.apdus.find(a => a.ins === 0xd8)!;
    assert.deepEqual(put, {
      phase: 'putKey',
      ins: 0xd8,
      lc: 67 + 8,
      sw: 0x9000,
      rlen: 10,
      ms: put.ms,
    });
    assert.ok(!JSON.stringify(r).includes(toHex(SPIKE_KEYS.enc).slice(0, 8)));
  });
});
