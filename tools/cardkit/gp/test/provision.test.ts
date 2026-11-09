/**
 * The install against the fake card: the happy path in order, a pull at every
 * APDU (before the card acts and after) followed by a run that sweeps and
 * installs, with Replace on and with it off, both guesses at what a torn LOAD
 * leaves, the opener rule, a mute INSTALL, refusals, the guards, a tampered
 * load file, and events that throw. Then the same install on a fake J3R452,
 * which opens SCP03 and reads the registry before its sweep: blank, and as the
 * test card came, with the seller's NDEF tag at D2760000850101, which no run
 * deletes. Then the login guard under both protocols.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  CARD_AID,
  CASHU_PACKAGE_AID,
  HELLO_PACKAGE_AID,
  OPENER_AID,
  TAG_AID,
  TAG_CLASS_AID,
} from '../aids';
import {fromHex, toHex} from '../bytes';
import {
  PHASES,
  cashuPlan,
  helloPlan,
  mayLeaveGuardedApplet,
  provision,
  rotateKeys,
  type Plan,
  type ProvisionOptions,
  type RunEvent,
} from '../provision';
import {
  FACTORY_KEYS,
  SPIKE_KEYS,
  WrongKeys,
  initializeUpdateCommand,
  openSession,
  parseCommand,
  putKeys,
  selectAid,
  type Transceiver,
} from '../scp02';
import {CASHU_LOAD_FILE, HELLO_LOAD_FILE} from './assets';
import {FakeCard, ISD, SELLER_APPLETS, pullAt} from '../../testing/fake-card';

const CASHU = cashuPlan(CASHU_LOAD_FILE);
const HELLO = helloPlan(HELLO_LOAD_FILE);
const OPENER = toHex(OPENER_AID);
const CARD = toHex(CARD_AID);
const TAG = toHex(TAG_AID);
const PKG = toHex(CASHU_PACKAGE_AID);
const APPLET_JAVA = join(
  __dirname,
  '../../../../applet/src/main/java/me/flashapp/cashu/CashuApplet.java',
);

function options(extra: Partial<ProvisionOptions> = {}): ProvisionOptions {
  let t = 0;
  return {random: n => randomBytes(n), now: () => (t += 7), ...extra};
}

/** The card as a clean install leaves it: the package and its three instances, in order, empty. */
function assertInstalled(card: FakeCard) {
  assert.deepEqual(card.instanceAids(), [OPENER, CARD, TAG]);
  assert.deepEqual([...card.packages.keys()], [PKG]);
  assert.equal(card.partial.size, 0);
  assert.equal(card.failedAuths, 0);
}

const INSTALL_ORDER = [
  0xa4, // probe: SELECT the card's applet (6A82 on a clean card)
  0xa4, // SELECT the card manager
  0xca, // FF21
  0x50, // INITIALIZE UPDATE
  0x82, // EXTERNAL AUTHENTICATE
  0xe4,
  0xe4,
  0xe4,
  0xe4, // sweep: tag, card, opener, package
  0xe6, // INSTALL [for load]
  ...new Array(88).fill(0xe8), // LOAD
  0xe6,
  0xe6,
  0xe6, // the opener, the card's applet, the tag
  0xa4,
  0x01,
  0x10,
  0xa4, // verify: 02 02, GET_INFO, GET_PUBKEY, the tag
  0xa4,
  0xca, // FF21 again
];

/**
 * The same on a J3R452: under SCP03 the sweep reads the registry first, GET
 * STATUS of the applications and of the load files, and deletes nothing
 * unless every Cashu AID on the card is the Cashu package's.
 */
const INSTALL_ORDER_SCP03 = [
  ...INSTALL_ORDER.slice(0, 5),
  0xf2,
  0xf2, // sweep: the registry
  ...INSTALL_ORDER.slice(5),
];

describe('provision: the Cashu card', () => {
  it('installs on a clean card in the documented order, every card-manager command MACed', async () => {
    const card = new FakeCard();
    const r = await provision(card.transceive, CASHU, options());
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.phase, 'done');
    assertInstalled(card);
    assert.deepEqual(card.insLog(), INSTALL_ORDER);
    const sweep = card.log
      .filter(a => a[1] === 0xe4)
      .map(a => toHex(a.slice(7, 7 + a[6])));
    assert.deepEqual(sweep, [TAG, CARD, OPENER, PKG]);
    assert.ok(
      card.log
        .filter(a => [0x82, 0xe4, 0xe6, 0xe8].includes(a[1]))
        .every(a => a[0] === 0x84),
    );
    // as gp sends them: Le 00 after the MAC on every one (GPSession.transmit)
    for (const a of card.log.filter(x => (x[0] & 0x04) !== 0)) {
      assert.equal(
        parseCommand(a).le,
        0x00,
        `INS ${toHex([a[1]])} ends in Le 00`,
      );
    }
    assert.deepEqual(
      r.timings.map(t => t.phase),
      PHASES,
    );
    assert.equal(r.apdus.length, card.log.length);
    assert.deepEqual(r.blocks, {at: 88, of: 88});
    assert.ok(
      r.freeBefore &&
        r.freeAfter &&
        r.freeAfter.nonVolatile < r.freeBefore.nonVolatile,
    );
  });

  it("verifies the applet's version as CashuApplet.java has it, which the fake card answers", async () => {
    // VERSION_MAJOR and VERSION_MINOR, read as tools/cardctl/test_spec_consistency.py reads them
    const java = readFileSync(APPLET_JAVA, 'utf8');
    const version = ['VERSION_MAJOR', 'VERSION_MINOR'].map(name => {
      const m = new RegExp(
        `static final byte ${name}\\s*=\\s*\\(byte\\)\\s*0x([0-9A-Fa-f]{2})`,
      ).exec(java);
      assert.ok(m, `${name} in CashuApplet.java`);
      return parseInt(m[1], 16);
    });
    const select = CASHU.checks.find(
      c => toHex(c.apdu) === toHex(selectAid(CARD_AID)),
    );
    assert.deepEqual(select?.data, version, "verify's whole-AID SELECT");
    const card = new FakeCard();
    assert.equal((await provision(card.transceive, CASHU, options())).ok, true);
    assert.deepEqual(
      await card.transceive(selectAid(CARD_AID)),
      [...version, 0x90, 0x00],
      "the fake card's SELECT",
    );
    const info = await card.transceive([0xb0, 0x01, 0x00, 0x00, 0x00]);
    assert.deepEqual(info.slice(0, 2), version, "the fake card's GET_INFO");
  });

  it('records each APDU as phase, INS, Lc, SW, reply length and time, and never its bytes', async () => {
    const card = new FakeCard();
    const r = await provision(card.transceive, CASHU, options());
    for (const record of r.apdus) {
      assert.deepEqual(Object.keys(record).sort(), [
        'ins',
        'lc',
        'ms',
        'phase',
        'rlen',
        'sw',
      ]);
    }
    const text = JSON.stringify(r);
    assert.ok(!/[0-9A-Fa-f]{16}/.test(text), 'no run of hex in the result');
  });

  it('comes back from a pull at any APDU, before or after the card acts, with a run that sweeps and installs', async () => {
    const total = INSTALL_ORDER.length;
    for (const partialLoad of ['discard', 'keep'] as const) {
      for (const when of ['before', 'after'] as const) {
        for (let n = 0; n < total; n++) {
          const card = new FakeCard({partialLoad});
          const pull = pullAt(card, n, when);
          const first = await provision(
            pull.tx,
            CASHU,
            options({replace: true}),
          );
          const where = `${partialLoad}/${when}/APDU ${n}`;
          assert.equal(first.ok, false, where);
          assert.equal(first.kind, 'pulled', where);
          assert.equal(
            pull.state.late,
            0,
            `${where}: nothing was sent after the pull`,
          );
          card.reset();
          const again = await provision(
            card.transceive,
            CASHU,
            options({replace: true}),
          );
          assert.equal(
            again.ok,
            true,
            `${where}: ${again.kind} ${again.reason}`,
          );
          assertInstalled(card);
        }
      }
    }
  });

  it('after a pull with Replace off, recovers with Replace off unless the card applet got on, and then stops guarded until Replace is on', async () => {
    const total = INSTALL_ORDER.length;
    let guarded = 0;
    for (const partialLoad of ['discard', 'keep'] as const) {
      for (const when of ['before', 'after'] as const) {
        for (let n = 0; n < total; n++) {
          const card = new FakeCard({partialLoad});
          const pull = pullAt(card, n, when);
          const first = await provision(pull.tx, CASHU, options());
          const where = `${partialLoad}/${when}/APDU ${n} (${first.phase})`;
          assert.equal(first.kind, 'pulled', where);
          card.reset();
          const installed = card.instances.has(CARD);
          if (installed) {
            // the screen says to turn on Replace after a pull in any phase this can follow
            assert.ok(
              mayLeaveGuardedApplet(CASHU, first.phase),
              `${where}: the card applet is on the card`,
            );
          }
          if (first.phase === 'installTag' || first.phase === 'verify') {
            assert.ok(
              installed,
              `${where}: the card applet's INSTALL had answered`,
            );
          }
          const before = card.log.length;
          const again = await provision(card.transceive, CASHU, options());
          if (!installed) {
            assert.equal(
              again.ok,
              true,
              `${where}: ${again.kind} ${again.reason}`,
            );
            assertInstalled(card);
            continue;
          }
          guarded++;
          assert.equal(again.kind, 'guarded', where);
          assert.equal(again.phase, 'probe', where);
          assert.match(again.reason ?? '', /turn on Replace/, where);
          assert.deepEqual(
            card.log.slice(before).map(a => a[1]),
            [0xa4, 0x01],
            `${where}: SELECT and GET_INFO, nothing more`,
          );
          card.reset();
          const replaced = await provision(
            card.transceive,
            CASHU,
            options({replace: true}),
          );
          assert.equal(
            replaced.ok,
            true,
            `${where}: ${replaced.kind} ${replaced.reason}`,
          );
          assertInstalled(card);
        }
      }
    }
    assert.ok(guarded > 0, 'some pulls leave the card applet on the card');
  });

  it('names the phases a pull may leave the card applet in: from its INSTALL on, and none for the hello applet', () => {
    assert.deepEqual(
      PHASES.filter(p => mayLeaveGuardedApplet(CASHU, p)),
      ['installCard', 'installTag', 'verify', 'done'],
    );
    assert.deepEqual(
      PHASES.filter(p => mayLeaveGuardedApplet(HELLO, p)),
      [],
    );
    assert.equal(mayLeaveGuardedApplet(CASHU, 'putKey'), false);
  });

  it('keeps a torn LOAD out of the way in both variants: the sweep deletes a kept partial package', async () => {
    for (const partialLoad of ['discard', 'keep'] as const) {
      const card = new FakeCard({partialLoad});
      const loadAt = INSTALL_ORDER.indexOf(0xe8) + 36;
      const pull = pullAt(card, loadAt, 'after');
      const first = await provision(pull.tx, CASHU, options());
      assert.equal(first.kind, 'pulled');
      assert.equal(first.phase, 'load');
      assert.deepEqual(first.blocks, {at: 37, of: 88});
      card.reset();
      assert.equal(card.partial.size, partialLoad === 'keep' ? 1 : 0);
      const again = await provision(card.transceive, CASHU, options());
      assert.equal(again.ok, true, again.reason);
      assertInstalled(card);
    }
  });

  it('reports only LOAD blocks whose successful response reached the host', async () => {
    const card = new FakeCard();
    const events: RunEvent[] = [];
    const pull = pullAt(card, INSTALL_ORDER.indexOf(0xe8) + 36, 'after');
    const result = await provision(
      pull.tx,
      CASHU,
      options({onEvent: event => events.push(event)}),
    );
    assert.equal(result.kind, 'pulled');
    assert.deepEqual(result.blocks, {at: 37, of: 88});
    const written = events.filter(
      (event): event is Extract<RunEvent, {type: 'block'}> =>
        event.type === 'block',
    );
    assert.equal(written.at(-1)?.index, 36);
  });

  it('stops at a mute INSTALL of the card applet, and the next run recovers', async () => {
    const card = new FakeCard();
    let installs = 0;
    card.override = apdu =>
      apdu[1] === 0xe6 && apdu[2] === 0x0c && ++installs === 2
        ? 'mute'
        : undefined;
    const first = await provision(card.transceive, CASHU, options());
    assert.equal(first.kind, 'pulled');
    assert.equal(first.phase, 'installCard');
    card.override = undefined;
    card.reset();
    const again = await provision(
      card.transceive,
      CASHU,
      options({replace: true}),
    );
    assert.equal(again.ok, true, again.reason);
    assertInstalled(card);
  });

  it('meets the opener rule: the card applet first goes mute or 6F00 and installs nothing', async () => {
    const wrongOrder: Plan = {
      ...CASHU,
      installs: [CASHU.installs[1], CASHU.installs[0], CASHU.installs[2]],
    };
    // the phases run in table order, so put the card applet's INSTALL in the opener's phase
    wrongOrder.installs = [
      {...CASHU.installs[1], phase: 'installOpener'},
      {...CASHU.installs[0], phase: 'installCard'},
      CASHU.installs[2],
    ];
    for (const openerRule of ['mute', '6F00'] as const) {
      const card = new FakeCard({openerRule});
      const r = await provision(card.transceive, wrongOrder, options());
      assert.equal(r.ok, false);
      assert.equal(r.phase, 'installOpener');
      assert.equal(r.kind, openerRule === 'mute' ? 'pulled' : 'refused');
      assert.deepEqual(card.instanceAids(), []);
      card.reset();
      const again = await provision(card.transceive, CASHU, options());
      assert.equal(again.ok, true, again.reason);
      assertInstalled(card);
    }
  });

  it('stops at 6F00, 6985 or 6A80 from any card-manager command, and sends nothing more', async () => {
    const targets: [string, (a: number[], i: number) => boolean][] = [
      ['DELETE', a => a[1] === 0xe4],
      ['INSTALL [for load]', a => a[1] === 0xe6 && a[2] === 0x02],
      ['the first LOAD', a => a[1] === 0xe8 && a[3] === 0],
      ['LOAD 37', a => a[1] === 0xe8 && a[3] === 36],
      ['the last LOAD', a => a[1] === 0xe8 && a[2] === 0x80],
      // 84 E6 0C 00 Lc, 0A and the package, 0B and the module at 17
      [
        'INSTALL the opener',
        a =>
          a[1] === 0xe6 && a[2] === 0x0c && toHex(a.slice(17, 28)) === OPENER,
      ],
      [
        'INSTALL the card applet',
        a => a[1] === 0xe6 && a[2] === 0x0c && toHex(a.slice(17, 28)) === CARD,
      ],
      [
        'INSTALL the tag',
        a =>
          a[1] === 0xe6 &&
          a[2] === 0x0c &&
          toHex(a.slice(17, 28)) === toHex(TAG_CLASS_AID),
      ],
    ];
    for (const sw of [0x6f00, 0x6985, 0x6a80]) {
      for (const [name, match] of targets) {
        const card = new FakeCard();
        let at = -1;
        card.override = (apdu, i) =>
          at < 0 && match(apdu, i) ? ((at = i), sw) : undefined;
        const r = await provision(card.transceive, CASHU, options());
        assert.ok(at >= 0, `${name} was sent`);
        assert.equal(r.kind, 'refused', name);
        assert.equal(r.sw, sw, name);
        assert.equal(
          card.log.length,
          at + 1,
          `${name} ${sw.toString(16)}: nothing after it`,
        );
      }
    }
  });

  it('never sweeps a card applet that holds anything, with or without replace: no DELETE, no login', async () => {
    const states = [
      {unspent: 3},
      {spent: 1},
      {owner: 1},
      {pin: 1},
      {record: 1},
    ];
    for (const state of states) {
      for (const replace of [false, true]) {
        const card = new FakeCard();
        assert.equal(
          (await provision(card.transceive, CASHU, options())).ok,
          true,
        );
        card.setCardState(state);
        card.reset();
        const before = card.log.length;
        const r = await provision(card.transceive, CASHU, options({replace}));
        assert.equal(r.kind, 'guarded', JSON.stringify(state));
        assert.equal(r.phase, 'probe');
        const sent = card.log.slice(before).map(a => a[1]);
        assert.deepEqual(
          sent,
          [0xa4, 0x01],
          'SELECT and GET_INFO, nothing more',
        );
        assertInstalled(card);
      }
    }
  });

  it('removes an empty card applet only with replace on', async () => {
    const card = new FakeCard();
    assert.equal((await provision(card.transceive, CASHU, options())).ok, true);
    card.reset();
    const before = card.log.length;
    const off = await provision(card.transceive, CASHU, options());
    assert.equal(off.kind, 'guarded');
    assert.match(off.reason ?? '', /Replace/);
    assert.ok(!card.log.slice(before).some(a => a[1] === 0xe4));
    card.reset();
    const on = await provision(
      card.transceive,
      CASHU,
      options({replace: true}),
    );
    assert.equal(on.ok, true, on.reason);
    assertInstalled(card);
  });

  it('leaves alone an applet at the card AID that is not a 2.x card', async () => {
    const card = new FakeCard();
    const tx: Transceiver = async apdu =>
      apdu[1] === 0xa4 && toHex(apdu.slice(5, 5 + apdu[4])) === CARD
        ? [0x90, 0x00]
        : card.transceive(apdu);
    const r = await provision(tx, CASHU, options({replace: true}));
    assert.equal(r.kind, 'guarded');
    assert.equal(card.log.length, 0);
  });

  it('sends nothing at all for a load file that is not the build', async () => {
    const flip = (hex: string, at: number) =>
      hex.slice(0, at) + (hex[at] === '0' ? '1' : '0') + hex.slice(at + 1);
    const tampered = [
      {...CASHU_LOAD_FILE, hex: flip(CASHU_LOAD_FILE.hex, 4000)},
      {...CASHU_LOAD_FILE, hex: CASHU_LOAD_FILE.hex.slice(0, -2)},
      {
        ...CASHU_LOAD_FILE,
        sha256: CASHU_LOAD_FILE.sha256.replace(/^./, c =>
          c === '0' ? '1' : '0',
        ),
      },
      {...CASHU_LOAD_FILE, hex: 'zz' + CASHU_LOAD_FILE.hex.slice(2)},
    ];
    for (const loadFile of tampered) {
      const card = new FakeCard();
      const r = await provision(
        card.transceive,
        {...CASHU, loadFile},
        options(),
      );
      assert.equal(r.kind, 'guarded');
      assert.equal(card.log.length, 0);
      assert.equal(r.apdus.length, 0);
    }
  });

  it('sends the same APDUs whether onEvent is absent, counts, throws or rejects', async () => {
    const counts: number[] = [];
    const events: RunEvent[] = [];
    const listeners: (ProvisionOptions['onEvent'] | undefined)[] = [
      undefined,
      e => {
        events.push(e);
      },
      () => {
        throw new Error('the screen is gone');
      },
      (() =>
        Promise.reject(
          new Error('async listener'),
        )) as unknown as ProvisionOptions['onEvent'],
    ];
    for (const onEvent of listeners) {
      const card = new FakeCard();
      const r = await provision(card.transceive, CASHU, options({onEvent}));
      assert.equal(r.ok, true);
      counts.push(card.log.length);
    }
    assert.deepEqual(counts, new Array(4).fill(INSTALL_ORDER.length));
    const phases = events
      .filter(e => e.type === 'phase')
      .map(e => (e as {phase: string}).phase);
    assert.deepEqual(phases, PHASES);
    const blocks = events.filter(e => e.type === 'block') as {
      index: number;
      of: number;
    }[];
    assert.deepEqual(
      blocks.map(b => b.index),
      Array.from({length: 88}, (_, i) => i + 1),
    );
    assert.ok(blocks.every(b => b.of === 88));
    assert.equal(
      events.filter(e => e.type === 'apdu').length,
      INSTALL_ORDER.length,
    );
  });

  it('stops before EXTERNAL AUTHENTICATE on a card with other keys', async () => {
    const card = new FakeCard({
      keys: {
        enc: Array.from(SPIKE_KEYS.enc),
        mac: Array.from(SPIKE_KEYS.mac),
        dek: Array.from(SPIKE_KEYS.dek),
      },
    });
    const r = await provision(card.transceive, CASHU, options());
    assert.equal(r.kind, 'wrongKeys');
    assert.equal(r.phase, 'auth');
    assert.deepEqual(card.insLog(), [0xa4, 0xa4, 0xca, 0x50]);
    assert.equal(card.failedAuths, 0);
  });

  it('reports a refused EXTERNAL AUTHENTICATE as refused in auth (a card that MACs the other header)', async () => {
    const card = new FakeCard({macOverModifiedApdu: false});
    const r = await provision(card.transceive, CASHU, options());
    assert.equal(r.kind, 'refused');
    assert.equal(r.phase, 'auth');
    assert.equal(r.ins, 0x82);
    assert.equal(r.sw, 0x6300);
    assert.equal(card.log.length, 5);
    // the same card, with the host told to MAC the unmodified header, installs
    card.reset();
    const again = await provision(
      card.transceive,
      CASHU,
      options({macOverModifiedApdu: false}),
    );
    assert.equal(again.ok, true, again.reason);
  });

  it('loads in smaller blocks when the plan says so', async () => {
    const card = new FakeCard();
    const r = await provision(
      card.transceive,
      {...CASHU, blockSize: 128},
      options(),
    );
    assert.equal(r.ok, true, r.reason);
    assert.equal(card.insLog().filter(i => i === 0xe8).length, 169);
    assertInstalled(card);
  });
});

describe('provision: the Cashu card on a J3R452, which opens SCP03', () => {
  it('installs on a clean card in the same order, the registry read before the sweep, every card-manager command under the SCP03 C-MAC', async () => {
    const card = new FakeCard({scp: 3});
    const r = await provision(card.transceive, CASHU, options());
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.phase, 'done');
    assertInstalled(card);
    assert.deepEqual(card.insLog(), INSTALL_ORDER_SCP03);
    // GET STATUS of the applications, then of the load files, as readCashuRegistry sends them
    assert.deepEqual(
      card.log
        .filter(a => a[1] === 0xf2)
        .map(a => toHex(a.slice(0, 7)) + toHex(a.slice(-1))),
      ['84F240020A4F0000', '84F220020A4F0000'],
    );
    assert.deepEqual(
      r.apdus.filter(a => a.ins === 0xf2).map(a => a.phase),
      ['sweep', 'sweep'],
    );
    // SCP03's 32-byte INITIALIZE UPDATE reply, and one login's counter
    assert.equal(r.apdus.find(a => a.ins === 0x50)?.rlen, 32);
    assert.equal(card.seq, 1);
    for (const a of card.log.filter(x => (x[0] & 0x04) !== 0)) {
      assert.equal(a[0], 0x84);
      assert.equal(
        parseCommand(a).le,
        0x00,
        `INS ${toHex([a[1]])} ends in Le 00`,
      );
    }
    assert.deepEqual(r.blocks, {at: 88, of: 88});
  });

  it('comes back from a pull at any APDU, before or after the card acts, with a run that sweeps and installs', async () => {
    const total = INSTALL_ORDER_SCP03.length;
    for (const partialLoad of ['discard', 'keep'] as const) {
      for (const when of ['before', 'after'] as const) {
        for (let n = 0; n < total; n++) {
          const card = new FakeCard({scp: 3, partialLoad});
          const pull = pullAt(card, n, when);
          const first = await provision(
            pull.tx,
            CASHU,
            options({replace: true}),
          );
          const where = `${partialLoad}/${when}/APDU ${n}`;
          assert.equal(first.kind, 'pulled', where);
          assert.equal(pull.state.late, 0, where);
          card.reset();
          const again = await provision(
            card.transceive,
            CASHU,
            options({replace: true}),
          );
          assert.equal(
            again.ok,
            true,
            `${where}: ${again.kind} ${again.reason}`,
          );
          assertInstalled(card);
        }
      }
    }
  });

  /** The seller's applets on a card, in the order they were made. */
  const SELLER = SELLER_APPLETS.map(a => a.instance);

  it("stops guarded before any DELETE on a J3R452 as the test card came, whose seller's NDEF tag holds D2760000850101 (scp03-07), Replace on or off", async () => {
    const card = new FakeCard({scp: 3, sellerApplets: true});
    assert.deepEqual(card.instanceAids(), SELLER);
    assert.ok(card.instanceAids().includes(TAG), "the seller's tag is there");
    for (const replace of [false, true]) {
      const before = card.log.length;
      const r = await provision(card.transceive, CASHU, options({replace}));
      assert.equal(r.ok, false, `Replace ${replace}`);
      assert.equal(r.kind, 'guarded');
      assert.equal(r.phase, 'sweep');
      assert.match(r.reason!, /D2760000850101/);
      assert.match(r.reason!, /nothing was deleted/);
      // the probe (6A82: no card applet), the card manager, FF21, the login, then the registry and no more
      assert.deepEqual(
        card.log.slice(before).map(a => a[1]),
        [0xa4, 0xa4, 0xca, 0x50, 0x82, 0xf2, 0xf2],
      );
      card.reset();
    }
    assert.ok(!card.insLog().includes(0xe4), 'no DELETE');
    assert.deepEqual(card.instanceAids(), SELLER, "the seller's applets stay");
    assert.deepEqual(
      [...card.packages.keys()],
      SELLER_APPLETS.map(a => a.pkg),
    );
    assert.equal(card.failedAuths, 0);
  });

  it("keeps the seller's applets through a pull at any APDU: every run after it stops guarded, and none sends a DELETE", async () => {
    const clean = new FakeCard({scp: 3, sellerApplets: true});
    await provision(clean.transceive, CASHU, options({replace: true}));
    assert.equal(clean.log.length, 7);
    for (const when of ['before', 'after'] as const) {
      for (let n = 0; n < clean.log.length; n++) {
        const card = new FakeCard({scp: 3, sellerApplets: true});
        const pull = pullAt(card, n, when);
        const first = await provision(pull.tx, CASHU, options({replace: true}));
        const where = `${when}/APDU ${n}`;
        assert.equal(first.kind, 'pulled', where);
        card.reset();
        const again = await provision(
          card.transceive,
          CASHU,
          options({replace: true}),
        );
        assert.equal(again.kind, 'guarded', `${where}: ${again.reason}`);
        assert.ok(!card.insLog().includes(0xe4), `${where}: no DELETE`);
        assert.deepEqual(card.instanceAids(), SELLER, where);
      }
    }
  });

  it('reads the registry only on SCP03 and only for a sweep of the Cashu AIDs: the J3R180 sends what it always has, and the hello plan never reads it', async () => {
    const j3r180 = new FakeCard();
    assert.equal(
      (await provision(j3r180.transceive, CASHU, options())).ok,
      true,
    );
    assert.deepEqual(j3r180.insLog(), INSTALL_ORDER);
    // the hello applet's sweep names none of the Cashu AIDs, so the seller's tag does not stop it
    const j3r452 = new FakeCard({scp: 3, sellerApplets: true});
    const hello = await provision(j3r452.transceive, HELLO, options());
    assert.equal(hello.ok, true, hello.reason);
    assert.ok(!j3r452.insLog().includes(0xf2));
    assert.deepEqual(j3r452.instanceAids(), SELLER);
  });

  // the card manager's AID on Open Platform cards, which the SCP03 challenge is made over here
  const OTHER = 'A000000003000000';

  it('selects, logs in to, loads into and rotates the security domain sdAid names', async () => {
    const card = new FakeCard({scp: 3, isd: OTHER});
    // the default AID is not this card manager's: its SELECT is refused, and nothing more is sent
    const lost = await provision(card.transceive, CASHU, options());
    assert.equal(lost.kind, 'refused');
    assert.equal(lost.phase, 'selectIsd');
    assert.equal(lost.sw, 0x6a82);
    assert.deepEqual(card.insLog(), [0xa4, 0xa4]);
    card.reset();
    const before = card.log.length;
    const sdAid = fromHex(OTHER);
    const r = await provision(card.transceive, CASHU, options({sdAid}));
    assert.equal(r.ok, true, r.reason);
    assertInstalled(card);
    const sent = card.log.slice(before);
    assert.deepEqual(
      sent.filter(a => a[1] === 0xa4).map(a => toHex(a.slice(5, 5 + a[4]))),
      [CARD, OTHER, CARD, TAG, OTHER],
      'the probe, the security domain, the checks, the security domain',
    );
    const forLoad = sent.find(a => a[1] === 0xe6 && a[2] === 0x02)!;
    assert.equal(
      toHex(forLoad.slice(16, 25)),
      '08' + OTHER,
      'INSTALL [for load] names it',
    );
    card.reset();
    const rotated = await rotateKeys(
      card.transceive,
      FACTORY_KEYS,
      SPIKE_KEYS,
      options({sdAid}),
    );
    assert.equal(rotated.ok, true, rotated.reason);
    assert.equal(toHex(card.keys.mac), toHex(SPIKE_KEYS.mac));
    assert.equal(card.failedAuths, 0);
  });

  it('reads the registry for the security domain sdAid names, so a torn install there comes back', async () => {
    const sdAid = fromHex(OTHER);
    const total = INSTALL_ORDER_SCP03.length;
    for (let n = 0; n < total; n++) {
      const card = new FakeCard({scp: 3, isd: OTHER, partialLoad: 'keep'});
      const pull = pullAt(card, n, 'after');
      const first = await provision(
        pull.tx,
        CASHU,
        options({replace: true, sdAid}),
      );
      assert.equal(first.kind, 'pulled', `APDU ${n}`);
      card.reset();
      const again = await provision(
        card.transceive,
        CASHU,
        options({replace: true, sdAid}),
      );
      assert.equal(again.ok, true, `APDU ${n}: ${again.kind} ${again.reason}`);
      assertInstalled(card);
    }
  });

  it("stops at WrongKeys, before EXTERNAL AUTHENTICATE, when the card's challenge was made over another AID than sdAid", async () => {
    // a card manager that answers to the usual ISD AID as well, but makes its challenge over its own
    const card = new FakeCard({scp: 3, isd: OTHER});
    const alias: Transceiver = apdu =>
      apdu[1] === 0xa4 && toHex(apdu.slice(5, 5 + apdu[4])) === ISD
        ? card.transceive(selectAid(fromHex(OTHER)))
        : card.transceive(apdu);
    const r = await provision(alias, CASHU, options());
    assert.equal(r.kind, 'wrongKeys');
    assert.equal(r.phase, 'auth');
    assert.deepEqual(card.insLog(), [0xa4, 0xa4, 0xca, 0x50]);
    assert.equal(card.failedAuths, 0);
    // told the AID, the same card opens
    card.reset();
    const again = await provision(
      alias,
      CASHU,
      options({sdAid: fromHex(OTHER)}),
    );
    assert.equal(again.ok, true, again.reason);
  });

  for (const scp of [2, 3] as const) {
    it(`stops before EXTERNAL AUTHENTICATE when probing with a key set the card no longer holds (SCP0${scp})`, async () => {
      const card = new FakeCard({scp});
      const rotated = await rotateKeys(
        card.transceive,
        FACTORY_KEYS,
        SPIKE_KEYS,
        options(),
      );
      assert.equal(rotated.ok, true, rotated.reason);
      card.reset();
      const before = card.log.length;
      const r = await provision(card.transceive, CASHU, options());
      assert.equal(r.kind, 'wrongKeys');
      assert.equal(r.phase, 'auth');
      const sent = card.log.slice(before).map(a => a[1]);
      assert.deepEqual(sent, [0xa4, 0xa4, 0xca, 0x50]);
      assert.ok(!sent.includes(0x82), 'no EXTERNAL AUTHENTICATE');
      assert.equal(card.failedAuths, 0);
      // the set it holds still opens it
      card.reset();
      const again = await provision(
        card.transceive,
        CASHU,
        options({keys: SPIKE_KEYS}),
      );
      assert.equal(again.ok, true, again.reason);
      assert.equal(card.failedAuths, 0);
    });
  }
});

describe('provision: the hello applet', () => {
  it('installs it, hears HELLO, and deletes it again, leaving the card as it found it', async () => {
    const card = new FakeCard();
    const start = card.free;
    const r = await provision(card.transceive, HELLO, options());
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(card.insLog(), [
      0xa4,
      0xca,
      0x50,
      0x82, // the card manager, FF21, login
      0xe4,
      0xe4, // sweep
      0xe6,
      0xe8,
      0xe8,
      0xe6, // load and install
      0xa4,
      0x01, // SELECT, HELLO
      0xa4,
      0x50,
      0x82,
      0xe4,
      0xe4, // log in again, delete it
      0xa4,
      0xca, // FF21
    ]);
    assert.equal(card.instances.size, 0);
    assert.equal(card.packages.size, 0);
    assert.equal(card.free, start);
    assert.equal(r.freeAfter?.nonVolatile, r.freeBefore?.nonVolatile);
    assert.deepEqual(
      r.timings.map(t => t.phase),
      PHASES.filter(p => !['probe', 'installOpener', 'installTag'].includes(p)),
    );
  });

  it('touches nothing of the card applet', async () => {
    const card = new FakeCard();
    assert.equal((await provision(card.transceive, CASHU, options())).ok, true);
    card.setCardState({unspent: 5, owner: 1});
    card.reset();
    const before = card.log.length;
    const r = await provision(card.transceive, HELLO, options());
    assert.equal(r.ok, true, r.reason);
    assertInstalled(card);
    const deleted = card.log
      .slice(before)
      .filter(a => a[1] === 0xe4)
      .map(a => toHex(a.slice(7, 7 + a[6])));
    assert.equal(deleted.length, 4);
    assert.ok(deleted.every(aid => aid.startsWith(toHex(HELLO_PACKAGE_AID))));
  });

  it('recovers from a pull anywhere', async () => {
    const clean = new FakeCard();
    await provision(clean.transceive, HELLO, options());
    for (const when of ['before', 'after'] as const) {
      for (let n = 0; n < clean.log.length; n++) {
        const card = new FakeCard({partialLoad: n % 2 ? 'keep' : 'discard'});
        const pull = pullAt(card, n, when);
        const first = await provision(pull.tx, HELLO, options());
        assert.equal(first.kind, 'pulled');
        card.reset();
        const again = await provision(card.transceive, HELLO, options());
        assert.equal(again.ok, true, `${when} ${n}: ${again.reason}`);
        assert.equal(
          card.instances.size + card.packages.size + card.partial.size,
          0,
        );
      }
    }
  });
});

describe('the fake card', () => {
  it('refuses to delete a package before its instances', async () => {
    const card = new FakeCard();
    await provision(card.transceive, CASHU, options());
    card.reset();
    const {openSession, deleteAid, selectAid} = await import('../scp02');
    await card.transceive(selectAid([0xa0, 0, 0, 1, 0x51, 0, 0, 0]));
    const s = await openSession(
      card.transceive,
      {enc: card.keys.enc, mac: card.keys.mac, dek: card.keys.dek},
      n => randomBytes(n),
    );
    const r = await s.send(card.transceive, deleteAid(CASHU_PACKAGE_AID));
    assert.equal(r.sw, 0x6985);
    assert.equal(ISD, 'A000000151000000');
  });

  it("advances SCP03's 3-byte counter at every INITIALIZE UPDATE, with or without EXTERNAL AUTHENTICATE, and SCP02's only at EXTERNAL AUTHENTICATE", async () => {
    const counter = (reply: number[]) =>
      toHex(reply.slice(reply.length - 5, reply.length - 2));
    const scp03 = new FakeCard({scp: 3, seq: 5});
    const iu = () => initializeUpdateCommand(Array.from(randomBytes(8)));
    assert.equal(counter(await scp03.transceive(iu())), '000006');
    assert.equal(counter(await scp03.transceive(iu())), '000007');
    scp03.reset();
    assert.equal(counter(await scp03.transceive(iu())), '000008');
    assert.equal(scp03.abandonedHandshakes, 2);
    await openSession(scp03.transceive, FACTORY_KEYS, n => randomBytes(n));
    assert.equal(scp03.seq, 9, 'the login took one more');
    // SCP02's counter, bytes 12 and 13 of 28, stays until a login succeeds
    const scp02 = new FakeCard();
    const seq02 = (reply: number[]) => toHex(reply.slice(12, 14));
    assert.equal(seq02(await scp02.transceive(iu())), '0009');
    assert.equal(seq02(await scp02.transceive(iu())), '0009');
    await openSession(scp02.transceive, FACTORY_KEYS, n => randomBytes(n));
    assert.equal(seq02(await scp02.transceive(iu())), '000A');
  });

  it('takes PUT KEY P1 00 only on an SCP03 card at version FF, to a version from 01 to 7F, and keeps that set alone; any other P1 stays 6A80', async () => {
    /** A login with the public default, then PUT KEY of the spike set with this P1 and new version. */
    const put = async (card: FakeCard, p1: number, newKvn: number) => {
      const s = await openSession(card.transceive, FACTORY_KEYS, n =>
        randomBytes(n),
      );
      return s.send(card.transceive, putKeys(SPIKE_KEYS, s, {p1, newKvn}));
    };
    // a J3R452 as it ships, at version FF (here on the public default)
    const shipped = new FakeCard({scp: 3, kvn: 0xff});
    const r = await put(shipped, 0x00, 0x01);
    assert.equal(r.sw, 0x9000);
    assert.equal(r.data[0], 0x01, 'the new version, then the check values');
    assert.equal(r.data.length, 1 + 3 * 3);
    assert.equal(shipped.kvn, 0x01);
    assert.equal(toHex(shipped.keys.mac), toHex(SPIKE_KEYS.mac));
    // the version-FF set went with it, as on the test card (GET DATA E0 then listed version 1 alone)
    shipped.reset();
    await assert.rejects(
      openSession(shipped.transceive, FACTORY_KEYS, n => randomBytes(n)),
      WrongKeys,
    );
    const ours = await openSession(shipped.transceive, SPIKE_KEYS, n =>
      randomBytes(n),
    );
    assert.equal(ours.keyVersion, 0x01);
    assert.equal(shipped.failedAuths, 0);
    for (const [scp, kvn, p1, newKvn] of [
      [3, 0x01, 0x00, 0x01], // a set beside the one at 01
      [3, 0xff, 0x00, 0x80], // a new version outside 01..7F
      [3, 0xff, 0x00, 0xff],
      [3, 0xff, 0x00, 0x00],
      [3, 0xff, 0x01, 0x01], // a set the card does not hold
      [2, 0xff, 0x00, 0x01], // SCP02 replaces in place only
    ] as const) {
      const card = new FakeCard({scp, kvn});
      const refused = await put(card, p1, newKvn);
      const where = `SCP0${scp} at ${kvn}: P1 ${p1}, new version ${newKvn}`;
      assert.equal(refused.sw, 0x6a80, where);
      assert.equal(card.kvn, kvn, where);
      assert.equal(toHex(card.keys.mac), toHex(FACTORY_KEYS.mac), where);
    }
  });
});
