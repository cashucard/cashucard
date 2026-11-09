/**
 * Key rotation against the fake card, as a J3R180 (SCP02) and as a J3R452
 * (SCP03): to the spike set and back, a PUT KEY torn before and after the
 * card takes it, the active set found from one INITIALIZE UPDATE, and a card
 * on neither set left without a failed login. The lost-reply path is the one
 * that keeps a rotation from costing a failed login, so it runs under both.
 * Then first contact (D182): a J3R452 as it ships, at version FF, moved to
 * version 01 by PUT KEY P1 00, the reopen asking for version FF before it
 * proves ours at 01, with its guards, and the rotation at version 01 held to
 * the bytes it sent before first contact existed.
 */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {describe, it} from 'node:test';

import {toHex} from '../bytes';
import {confirmManagerKeys, rotateKeys, type RotateOptions} from '../provision';
import {
  FACTORY_KEYS,
  FACTORY_KVN,
  SHIPPED_KVN,
  SPIKE_KEYS,
  parseCommand,
  type KeySet,
  type Transceiver,
} from '../scp02';
import {FakeCard, pullAt} from '../../testing/fake-card';

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
/** First contact's: the reopen asks for version FF (6A88) before it proves our set. */
const FIRST_CONTACT_ORDER = [0xa4, 0x50, 0x82, 0xd8, 0xa4, 0x50, 0x50, 0x82];
/** The INITIALIZE UPDATE that names version FF: CLA 80, INS 50, P1 FF, P2 00, Lc 08. */
const ASK_FOR_FF = [0x80, 0x50, 0xff, 0x00, 0x08];

for (const scp of [2, 3] as const) {
  describe(`rotateKeys (SCP0${scp})`, () => {
    it('moves the card to the spike set and back, proving each with a fresh secure channel', async () => {
      const card = new FakeCard({scp});
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
      // the key type the session's protocol takes: 80 (DES3) or 88 (AES)
      assert.equal(putKey[6], scp === 3 ? 0x88 : 0x80);
      // EXTERNAL AUTHENTICATE and PUT KEY as gp sends them: Le 00 after the MAC
      for (const a of card.log.filter(x => (x[0] & 0x04) !== 0)) {
        assert.equal(
          parseCommand(a).le,
          0x00,
          `INS ${toHex([a[1]])} ends in Le 00`,
        );
      }
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
      const card = new FakeCard({scp});
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
      const card = new FakeCard({scp});
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
        scp,
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
          const card = new FakeCard({scp});
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
      const card = new FakeCard({scp});
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
        // three entries of 22 bytes (80 10, the key, 03, the KCV) or of 23 (88 11 10 ...), the version, the MAC
        lc: (scp === 3 ? 70 : 67) + 8,
        sw: 0x9000,
        rlen: 10,
        ms: put.ms,
      });
      assert.ok(!JSON.stringify(r).includes(toHex(SPIKE_KEYS.enc).slice(0, 8)));
    });
  });

  describe(`observed manager key version (SCP0${scp})`, () => {
    it('reports the reopened version rather than assuming in-place version 01', async () => {
      const card = new FakeCard({scp});
      const result = await rotateKeys(
        card.transceive,
        FACTORY_KEYS,
        SPIKE_KEYS,
        options({putKey: {newKvn: 0x22}}),
      );
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.keyVersion, 0x22);
      card.reset();
      const resumed = await rotateKeys(
        card.transceive,
        FACTORY_KEYS,
        SPIKE_KEYS,
        options(),
      );
      assert.equal(resumed.ok, true);
      assert.equal(resumed.rotated, false);
      assert.equal(resumed.keyVersion, 0x22);
      assert.equal(card.failedAuths, 0);
    });
    it('confirmation authenticates only the assigned set and never sends PUT KEY', async () => {
      const {confirmManagerKeys} = await import('../provision');
      const card = new FakeCard({scp});
      const wrong = await confirmManagerKeys(
        card.transceive,
        SPIKE_KEYS,
        options(),
      );
      assert.equal(wrong.kind, 'wrongKeys');
      assert.deepEqual(card.insLog(), [0xa4, 0x50]);
      assert.equal(card.failedAuths, 0);
      card.reset();
      const at = card.log.length;
      const confirmed = await confirmManagerKeys(
        card.transceive,
        FACTORY_KEYS,
        options(),
      );
      assert.equal(confirmed.ok, true);
      assert.equal(confirmed.keyVersion, 1);
      assert.deepEqual(card.insLog().slice(at), [0xa4, 0x50, 0x82]);
    });
  });
}

/** The keys a fake card holds, as its options take them. */
function holding(keys: KeySet) {
  return {
    enc: Array.from(keys.enc),
    mac: Array.from(keys.mac),
    dek: Array.from(keys.dek),
  };
}

describe('first contact: an SCP03 card at key version FF, as a J3R452 ships (D182)', () => {
  it('puts our set at version 01 with PUT KEY P1 00, finds version FF gone and proves ours at 01; the set it shipped with no longer opens it', async () => {
    const card = new FakeCard({scp: 3, kvn: SHIPPED_KVN});
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.rotated, true);
    assert.equal(r.firstContact, true);
    assert.equal(r.keyVersion, FACTORY_KVN);
    assert.deepEqual(card.insLog(), FIRST_CONTACT_ORDER);
    // 84 D8 00 81 4E: P1 00, 70 bytes of entries and the C-MAC, the new version 01 first
    assert.deepEqual(card.log[3].slice(0, 6), [
      0x84,
      0xd8,
      0x00,
      0x81,
      0x4e,
      FACTORY_KVN,
    ]);
    // the reopen names version FF, plain, and the card holds none: 6A88, and no login follows it
    assert.deepEqual(card.log[5].slice(0, 5), ASK_FOR_FF);
    assert.deepEqual(
      r.apdus.slice(5).map(a => [a.phase, a.ins, a.sw]),
      [
        ['reopen', 0x50, 0x6a88],
        ['reopen', 0x50, 0x9000],
        ['reopen', 0x82, 0x9000],
      ],
    );
    assert.equal(card.kvn, FACTORY_KVN);
    assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS));
    card.reset();
    const at = card.log.length;
    const shipped = await confirmManagerKeys(
      card.transceive,
      FACTORY_KEYS,
      options(),
    );
    assert.equal(shipped.kind, 'wrongKeys');
    assert.deepEqual(card.insLog().slice(at), [0xa4, 0x50]);
    assert.equal(card.failedAuths, 0);
  });

  it('comes back from a pull at any APDU, before or after the card acts, at version 01 with one PUT KEY in all and no failed login', async () => {
    for (const when of ['before', 'after'] as const) {
      for (let n = 0; n < FIRST_CONTACT_ORDER.length; n++) {
        const where = `${when} ${n}`;
        const card = new FakeCard({scp: 3, kvn: SHIPPED_KVN});
        const pull = pullAt(card, n, when);
        const first = await rotateKeys(
          pull.tx,
          FACTORY_KEYS,
          SPIKE_KEYS,
          options(),
        );
        assert.equal(first.kind, 'pulled', where);
        assert.equal(pull.state.late, 0, where);
        card.reset();
        const again = await rotateKeys(
          card.transceive,
          FACTORY_KEYS,
          SPIKE_KEYS,
          options(),
        );
        assert.equal(again.ok, true, `${where}: ${again.reason}`);
        assert.equal(again.keyVersion, FACTORY_KVN, where);
        // the run that sent PUT KEY made first contact; one that found our set at 01 says nothing of it
        assert.equal(
          again.firstContact,
          again.rotated ? true : undefined,
          where,
        );
        assert.equal(card.kvn, FACTORY_KVN, where);
        assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS), where);
        assert.equal(
          card.insLog().filter(i => i === 0xd8).length,
          1,
          `${where}: one PUT KEY reached the card`,
        );
        assert.equal(card.failedAuths, 0, where);
      }
    }
  });

  it("stops at wrongKeys after INITIALIZE UPDATE alone on a card that proves neither set (still on the seller's keys)", async () => {
    const card = new FakeCard({
      scp: 3,
      kvn: SHIPPED_KVN,
      keys: holding({
        enc: randomBytes(16),
        mac: randomBytes(16),
        dek: randomBytes(16),
      }),
    });
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.kind, 'wrongKeys');
    assert.equal(r.phase, 'auth');
    assert.deepEqual(card.insLog(), [0xa4, 0x50], 'no 82, no D8');
    assert.equal(card.kvn, SHIPPED_KVN);
    assert.equal(card.failedAuths, 0);
  });

  it('stops guarded before EXTERNAL AUTHENTICATE when the card proves the new set at version FF', async () => {
    // only an in-place rotation of a shipped card puts our set at FF, and the reset refuses FF: quarantine, never record
    const card = new FakeCard({
      scp: 3,
      kvn: SHIPPED_KVN,
      keys: holding(SPIKE_KEYS),
    });
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'guarded');
    assert.equal(r.phase, 'auth');
    assert.match(r.reason!, /version FF/);
    assert.deepEqual(card.insLog(), [0xa4, 0x50], 'no 82, no D8');
    assert.equal(card.failedAuths, 0);
  });

  it('stops guarded at the reopen when the card then proves our set at a version other than 01', async () => {
    // a card that put ours elsewhere: never a silent success
    const card = new FakeCard({scp: 3, kvn: SHIPPED_KVN});
    const tx: Transceiver = async apdu => {
      const reply = await card.transceive(apdu);
      if (apdu[1] === 0xd8) {
        card.kvn = 0x02;
      }
      return reply;
    };
    const r = await rotateKeys(tx, FACTORY_KEYS, SPIKE_KEYS, options());
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'guarded');
    assert.equal(r.phase, 'reopen');
    assert.match(r.reason!, /version 02/);
    assert.equal(r.firstContact, undefined);
    assert.deepEqual(card.insLog(), FIRST_CONTACT_ORDER);
    assert.equal(card.failedAuths, 0);
  });

  it('stops guarded at the reopen, with no second login, on a card that kept its FF set beside ours, whichever set it picks for P1 00', async () => {
    // the test card dropped the FF set (GET DATA E0 listed 01 alone); one that kept it still opens to the set it shipped with
    for (const pick of ['new', 'shipped'] as const) {
      const card = new FakeCard({
        scp: 3,
        kvn: SHIPPED_KVN,
        keepsShippedSet: pick,
      });
      const r = await rotateKeys(
        card.transceive,
        FACTORY_KEYS,
        SPIKE_KEYS,
        options(),
      );
      assert.equal(r.ok, false, pick);
      assert.equal(r.kind, 'guarded', `${pick}: ${r.reason}`);
      assert.equal(r.phase, 'reopen', pick);
      assert.match(r.reason!, /still answers key version FF/, pick);
      assert.equal(r.firstContact, undefined, pick);
      // PUT KEY went in, then INITIALIZE UPDATE for FF was answered 9000, and nothing after it
      assert.deepEqual(
        card.insLog(),
        [0xa4, 0x50, 0x82, 0xd8, 0xa4, 0x50],
        pick,
      );
      assert.deepEqual(card.log[5].slice(0, 5), ASK_FOR_FF, pick);
      assert.equal(card.failedAuths, 0, pick);
      assert.equal(card.kvn, FACTORY_KVN, pick);
      assert.deepEqual(keysOf(card), hexKeys(SPIKE_KEYS), pick);
      assert.equal(card.shipped?.kvn, SHIPPED_KVN, pick);
    }
  });

  it('stops guarded at the reopen when the card answers INITIALIZE UPDATE for version FF with anything but 6A88', async () => {
    const card = new FakeCard({scp: 3, kvn: SHIPPED_KVN});
    // only the reopen names FF: the first INITIALIZE UPDATE leaves the choice to the card (P1 00)
    card.override = apdu =>
      apdu[1] === 0x50 && apdu[2] === SHIPPED_KVN ? 0x6d00 : undefined;
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.kind, 'guarded', r.reason);
    assert.equal(r.phase, 'reopen');
    assert.match(r.reason!, /6D00/);
    assert.equal(r.firstContact, undefined);
    assert.deepEqual(card.insLog(), [0xa4, 0x50, 0x82, 0xd8, 0xa4, 0x50]);
    assert.equal(card.failedAuths, 0);
  });

  it('refuses any putKey from the caller at first contact, before EXTERNAL AUTHENTICATE, and leaves the card at FF', async () => {
    for (const putKey of [
      {p1: SHIPPED_KVN, newKvn: SHIPPED_KVN},
      {newKvn: 0x22},
      {p1: SHIPPED_KVN},
      {p1: 0x00, newKvn: FACTORY_KVN},
      {},
    ]) {
      const where = JSON.stringify(putKey);
      const card = new FakeCard({scp: 3, kvn: SHIPPED_KVN});
      const r = await rotateKeys(
        card.transceive,
        FACTORY_KEYS,
        SPIKE_KEYS,
        options({putKey}),
      );
      assert.equal(r.kind, 'guarded', `${where}: ${r.reason}`);
      assert.equal(r.phase, 'auth', where);
      assert.match(r.reason!, /first contact/, where);
      assert.deepEqual(card.insLog(), [0xa4, 0x50], `${where}: no 82, no D8`);
      assert.equal(card.kvn, SHIPPED_KVN, where);
      assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS), where);
      assert.equal(card.failedAuths, 0, where);
    }
  });

  it('stops guarded before EXTERNAL AUTHENTICATE on an SCP02 card at version FF, where first contact was never measured', async () => {
    const card = new FakeCard({kvn: SHIPPED_KVN});
    const r = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options(),
    );
    assert.equal(r.kind, 'guarded');
    assert.equal(r.phase, 'auth');
    assert.deepEqual(card.insLog(), [0xa4, 0x50]);
    assert.equal(card.kvn, SHIPPED_KVN);
    assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS));
    assert.equal(card.failedAuths, 0);
  });
});

/**
 * sha256 over every APDU of a rotation from the public default to the spike
 * set at version 01, one hex line each, with the host challenge fixed: what
 * cardkit sent at 1382268, before first contact existed.
 */
const ROTATION_AT_01: Record<2 | 3, string> = {
  2: 'c0bb9ed8abc77f89055f561de3f08f2a4fcc6538fbbf79a0e46c28f4a0a9bfe3',
  3: 'e552e2362eab77f7040cd881c61655845c373ecaf9e8b4e987abe5233966cf9a',
};

for (const scp of [2, 3] as const) {
  describe(`rotateKeys away from first contact (SCP0${scp})`, () => {
    it('sends at version 01 the APDUs it sent before first contact existed, byte for byte', async () => {
      const card = new FakeCard({scp});
      const r = await rotateKeys(card.transceive, FACTORY_KEYS, SPIKE_KEYS, {
        random: n => new Array(n).fill(0x5a),
        now: () => 0,
      });
      assert.equal(r.ok, true, r.reason);
      assert.equal(r.firstContact, undefined);
      assert.deepEqual(card.log[3].slice(0, 4), [0x84, 0xd8, 0x01, 0x81]);
      const sent = card.log.map(a => toHex(a)).join('\n');
      assert.equal(
        createHash('sha256').update(sent).digest('hex'),
        ROTATION_AT_01[scp],
      );
    });

    it('stops guarded before EXTERNAL AUTHENTICATE when PUT KEY would have P1 00 on a card not at FF: asked for at 01, or by default at 00', async () => {
      for (const [kvn, putKey] of [
        [0x01, {p1: 0x00}],
        [0x00, undefined],
      ] as const) {
        const card = new FakeCard({scp, kvn});
        const r = await rotateKeys(
          card.transceive,
          FACTORY_KEYS,
          SPIKE_KEYS,
          options({putKey}),
        );
        const where = `version ${kvn}`;
        assert.equal(r.kind, 'guarded', where);
        assert.equal(r.phase, 'auth', where);
        assert.match(r.reason!, /P1 00/, where);
        assert.deepEqual(card.insLog(), [0xa4, 0x50], `${where}: no 82, no D8`);
        assert.deepEqual(keysOf(card), hexKeys(FACTORY_KEYS), where);
        assert.equal(card.failedAuths, 0, where);
      }
    });
  });
}
