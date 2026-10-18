/**
 * Gate H0: the owner's GlobalPlatformPro captures of the spare J3R180
 * (gp/test/fixtures/README.md), replayed through this module. Each test skips,
 * saying `pending H0 fixtures`, while its capture is missing, and is required
 * once it lands: the handshake must prove the keys, and every command gp sent
 * under the MAC must be the one this module sends.
 *
 * Until then the parser and the replay are held to a log written in gp's
 * format from a run against the fake card.
 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  CARD_AID,
  CASHU_PACKAGE_AID,
  OPENER_AID,
  TAG_AID,
  TAG_CLASS_AID,
} from '../aids';
import {fromHex, toHex} from '../bytes';
import {helloPlan, provision} from '../provision';
import {
  FACTORY_KEYS,
  SPIKE_KEYS,
  deleteAid,
  installAndSelectable,
  installForLoad,
  parseFreeMemory,
  parseInitializeUpdate,
  parseReply,
  putKeys,
  splitLoad,
  type KeySet,
} from '../scp02';
import {CASHU_LOAD_FILE, HELLO_LOAD_FILE} from './assets';
import {FakeCard} from './fake-card';
import {
  formatGpExchange,
  parseGpLog,
  replay,
  type Exchange,
} from './transcript';

const FIXTURES = join(__dirname, 'fixtures');

function capture(name: string): {skip: string | false; log: () => Exchange[]} {
  const path = join(FIXTURES, name);
  const present = existsSync(path);
  return {
    skip: present
      ? false
      : `pending H0 fixtures: ${name} (tools/cardkit/gp/test/fixtures/README.md)`,
    log: () => parseGpLog(readFileSync(path, 'utf8')),
  };
}

function only(
  commands: number[][],
  match: (c: number[]) => boolean,
  what: string,
): number[] {
  const found = commands.filter(match);
  assert.equal(found.length, 1, `one ${what} in the capture`);
  return found[0];
}

describe('the gp -d log reader', () => {
  it('reads back a log written in gp format, and replays its secure channel', async () => {
    const card = new FakeCard();
    const lines: string[] = [
      'GlobalPlatformPro v25.10.20',
      'Reader: ACS ACR122U PICC Interface',
      '# a line gp prints that is not an APDU',
    ];
    const tx = async (apdu: number[]) => {
      const reply = await card.transceive(apdu);
      lines.push(formatGpExchange(apdu, reply));
      return reply;
    };
    let t = 0;
    const r = await provision(tx, helloPlan(HELLO_LOAD_FILE), {
      random: n => randomBytes(n),
      now: () => (t += 1),
    });
    assert.equal(r.ok, true);
    const log = parseGpLog(lines.join('\n'));
    assert.equal(log.length, card.log.length);
    log.forEach((e, i) => assert.deepEqual(e.command, card.log[i]));
    const session = replay(log, FACTORY_KEYS);
    assert.deepEqual(
      session.commands.map(c => c[1]),
      [0xe4, 0xe4, 0xe6, 0xe8, 0xe8, 0xe6],
    );
    assert.throws(() => replay(log, SPIKE_KEYS), /do not prove|does not prove/);
  });
});

describe('gate H0: the spare card through gp v25.10.20', () => {
  const info = capture('gp-info.txt');
  it('the card opens SCP02 on key set 01 (gp -i)', {skip: info.skip}, () => {
    const iu = info.log().find(e => e.command[1] === 0x50 && e.reply);
    assert.ok(iu, 'an INITIALIZE UPDATE');
    const reply = parseInitializeUpdate(parseReply(iu!.reply!));
    assert.equal(reply.scp, 0x02);
    assert.equal(reply.kvn, 0x01);
  });

  const list = capture('gp-list.txt');
  it(
    "the handshake and every MACed command of gp --list are this module's",
    {skip: list.skip},
    () => {
      const r = replay(list.log(), FACTORY_KEYS);
      assert.ok(r.commands.length > 0, 'gp sent commands under the MAC');
    },
  );

  const ff21 = capture('gp-ff21.txt');
  it('FF21 parses, with no key', {skip: ff21.skip}, () => {
    const e = ff21
      .log()
      .find(
        x =>
          x.command[1] === 0xca &&
          x.command[2] === 0xff &&
          x.command[3] === 0x21,
      );
    assert.ok(e && e.reply, 'a GET DATA FF21 and its reply');
    const free = parseFreeMemory(parseReply(e!.reply!).data);
    assert.ok(free && free.nonVolatile > 0, 'free memory');
  });

  const deletes: [string, number[]][] = [
    ['gp-delete-tag.txt', TAG_AID],
    ['gp-delete-card.txt', CARD_AID],
    ['gp-delete-opener.txt', OPENER_AID],
    ['gp-delete-package.txt', CASHU_PACKAGE_AID],
  ];
  for (const [name, aid] of deletes) {
    const c = capture(name);
    it(
      `DELETE ${toHex(aid)} is this module's (${name})`,
      {skip: c.skip},
      () => {
        const r = replay(c.log(), FACTORY_KEYS);
        const del = only(r.commands, x => x[1] === 0xe4, 'DELETE');
        assert.equal(toHex(del), toHex(deleteAid(aid)));
      },
    );
  }

  const opener = capture('gp-install-opener.txt');
  it(
    "INSTALL [for load], the LOAD blocks and the opener's INSTALL are this module's",
    {skip: opener.skip},
    () => {
      const r = replay(opener.log(), FACTORY_KEYS);
      const forLoad = only(
        r.commands,
        x => x[1] === 0xe6 && x[2] === 0x02,
        'INSTALL [for load]',
      );
      assert.equal(toHex(forLoad), toHex(installForLoad(CASHU_PACKAGE_AID)));
      const loads = r.commands.filter(x => x[1] === 0xe8);
      const ours = splitLoad(fromHex(CASHU_LOAD_FILE.hex));
      assert.equal(
        loads.length,
        ours.length,
        "the block count (gp's block size is the card's)",
      );
      loads.forEach((x, i) =>
        assert.equal(toHex(x), toHex(ours[i]), `LOAD ${i}`),
      );
      const inst = only(
        r.commands,
        x => x[1] === 0xe6 && x[2] === 0x0c,
        'INSTALL [for install and make selectable]',
      );
      assert.equal(
        toHex(inst),
        toHex(installAndSelectable(CASHU_PACKAGE_AID, OPENER_AID, OPENER_AID)),
      );
    },
  );

  const creates: [string, number[], number[]][] = [
    ['gp-install-card.txt', CARD_AID, CARD_AID],
    ['gp-install-tag.txt', TAG_CLASS_AID, TAG_AID],
  ];
  for (const [name, module, instance] of creates) {
    const c = capture(name);
    it(
      `INSTALL of ${toHex(instance)} is this module's (${name})`,
      {skip: c.skip},
      () => {
        const r = replay(c.log(), FACTORY_KEYS);
        const inst = only(
          r.commands,
          x => x[1] === 0xe6 && x[2] === 0x0c,
          'INSTALL [for install and make selectable]',
        );
        assert.equal(
          toHex(inst),
          toHex(installAndSelectable(CASHU_PACKAGE_AID, module, instance)),
        );
      },
    );
  }

  const rotations: [string, KeySet, KeySet][] = [
    ['gp-lock-spike.txt', FACTORY_KEYS, SPIKE_KEYS],
    ['gp-unlock-factory.txt', SPIKE_KEYS, FACTORY_KEYS],
  ];
  for (const [name, from, to] of rotations) {
    const c = capture(name);
    it(
      `PUT KEY and its check values are this module's (${name})`,
      {skip: c.skip},
      () => {
        const r = replay(c.log(), from);
        const put = only(r.commands, x => x[1] === 0xd8, 'PUT KEY');
        const kvn = r.handshake.reply.kvn;
        assert.equal(
          toHex(put),
          toHex(putKeys(to, r.session.keys.dek, {p1: put[2], newKvn: put[5]})),
          'the key blocks and KCVs',
        );
        assert.deepEqual(
          [put[2], put[5]],
          [kvn, kvn],
          "replaced in place: P1 and the new version are the active set's",
        );
      },
    );
  }
});
