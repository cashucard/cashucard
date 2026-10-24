/**
 * Gate H0: the owner's GlobalPlatformPro captures of the spare J3R180
 * (gp/test/fixtures/README.md), replayed through this module. Each test skips,
 * saying `pending H0 fixtures`, while its capture is missing, and is required
 * once it lands: the handshake must prove the keys, and every command gp sent
 * under the MAC must be the one this module sends.
 *
 * Until then the parser, the replay and the check of a capture's load are
 * held to logs written in gp's format, and in gp's wire form, from runs
 * against the fake card.
 */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  CARD_AID,
  CASHU_PACKAGE_AID,
  HELLO_AID,
  HELLO_PACKAGE_AID,
  OPENER_AID,
  TAG_AID,
  TAG_CLASS_AID,
} from '../aids';
import {concat, fromHex, toHex} from '../bytes';
import {helloPlan, provision, type Plan} from '../provision';
import {
  FACTORY_KEYS,
  SPIKE_KEYS,
  deleteAid,
  installAndSelectable,
  installForLoad,
  parseCommand,
  parseFreeMemory,
  parseInitializeUpdate,
  parseReply,
  putKeys,
  splitLoad,
  type KeySet,
} from '../scp02';
import {HELLO_LOAD_FILE} from './assets';
import {FakeCard} from '../../testing/fake-card';
import {
  formatGpExchange,
  parseGpLog,
  parseKeyInformation,
  replay,
  type Exchange,
  type Replay,
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

/**
 * A command as gp v25.10.20 puts it on the wire. GPSession.transmit rebuilds
 * every command it has wrapped as new CommandAPDU(cla, ins, p1, p2, data, 256),
 * so each goes out with Le 00 whatever it was built with; what gp sends
 * unwrapped (SELECT, INITIALIZE UPDATE, GET DATA) goes as it was built.
 */
function gpWire(apdu: number[]): number[] {
  if ((apdu[0] & 0x04) === 0) {
    return apdu;
  }
  const c = parseCommand(apdu);
  return concat([c.cla, c.ins, c.p1, c.p2, c.data.length], c.data, [0x00]);
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

/**
 * A run against the fake card, logged as gp -d logs one: lines gp prints that
 * are not APDUs, then every exchange, with the command as gp puts it on the
 * wire.
 */
async function gpRun(plan: Plan): Promise<{card: FakeCard; text: string}> {
  const card = new FakeCard();
  const lines: string[] = [
    'GlobalPlatformPro v25.10.20',
    'Reader: ACS ACR122U PICC Interface',
    '# a line gp prints that is not an APDU',
  ];
  // the log holds what gp would have put on the wire for each command
  const tx = async (apdu: number[]) => {
    const reply = await card.transceive(apdu);
    lines.push(formatGpExchange(gpWire(apdu), reply));
    return reply;
  };
  let t = 0;
  const r = await provision(tx, plan, {
    random: n => randomBytes(n),
    now: () => (t += 1),
  });
  assert.equal(r.ok, true);
  return {card, text: lines.join('\n')};
}

/**
 * The load file step 6 of the fixtures README installs: the 2.1.0 CAP's, as
 * make-assets.py builds it (its LOAD_FILE_SHA256 when these tests were
 * written). The capture is held to the file it carries, never to the
 * provisioner's asset of the day: a new CAP moves make-assets.py's pins and
 * leaves this one, which only a new capture of step 6 moves.
 */
const H0_LOAD_FILE_SHA256 =
  'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee';

/**
 * The load in a replayed gp --install: INSTALL [for load] is this module's,
 * the LOAD blocks gp sent carry the load file `sha256` names, and that file,
 * cut by splitLoad, is gp's blocks byte for byte (gp's block size is the
 * card's).
 */
function assertGpLoad(r: Replay, packageAid: number[], sha256: string): void {
  const forLoad = only(
    r.commands,
    x => x[1] === 0xe6 && x[2] === 0x02,
    'INSTALL [for load]',
  );
  assert.equal(toHex(forLoad), toHex(installForLoad(packageAid)));
  const loads = r.commands.filter(x => x[1] === 0xe8);
  const theirs = loads.flatMap(x => x.slice(5, 5 + x[4]));
  assert.equal(
    createHash('sha256').update(Buffer.from(theirs)).digest('hex'),
    sha256,
    'the load file in the LOAD blocks gp sent',
  );
  const ours = splitLoad(theirs);
  assert.equal(
    loads.length,
    ours.length,
    "the block count (gp's block size is the card's)",
  );
  loads.forEach((x, i) => assert.equal(toHex(x), toHex(ours[i]), `LOAD ${i}`));
}

describe('the gp -d log reader', () => {
  it("reads back a log written in gp's format and wire form, and replays its secure channel", async () => {
    const {card, text} = await gpRun(helloPlan(HELLO_LOAD_FILE));
    const log = parseGpLog(text);
    assert.equal(log.length, card.log.length);
    // so this module sent, byte for byte, what gp sends: Le 00 on every wrapped command
    log.forEach((e, i) =>
      assert.equal(toHex(card.log[i]), toHex(e.command), `APDU ${i}`),
    );
    const session = replay(log, FACTORY_KEYS);
    assert.deepEqual(
      session.commands.map(c => c[1]),
      [0xe4, 0xe4, 0xe6, 0xe8, 0xe8, 0xe6],
    );
    assert.throws(() => replay(log, SPIKE_KEYS), /do not prove|does not prove/);
  });

  it("holds a capture's LOAD blocks to the load file they carry and to splitLoad's cut, whatever file that is", async () => {
    // a load file other than the card's: the check is given the hash it holds
    // the capture to, and reads no asset
    const {text} = await gpRun(helloPlan(HELLO_LOAD_FILE));
    const r = replay(parseGpLog(text), FACTORY_KEYS);
    assertGpLoad(r, HELLO_PACKAGE_AID, HELLO_LOAD_FILE.sha256);
    assert.throws(
      () => assertGpLoad(r, HELLO_PACKAGE_AID, H0_LOAD_FILE_SHA256),
      /the load file in the LOAD blocks gp sent/,
      'a capture of another load file fails at its hash',
    );
    // the same file in blocks of 128: its hash holds, the cut does not
    const recut = await gpRun({...helloPlan(HELLO_LOAD_FILE), blockSize: 128});
    assert.throws(
      () =>
        assertGpLoad(
          replay(parseGpLog(recut.text), FACTORY_KEYS),
          HELLO_PACKAGE_AID,
          HELLO_LOAD_FILE.sha256,
        ),
      /block count/,
      'blocks of another size fail at the count',
    );
  });

  it('reads a key information template as gp -i does: key ID, set version, and each type and length', () => {
    // key set 01 of three DES3 keys of 16 bytes, IDs 1 to 3, as the owner's gp -i -v shows it
    const kit = fromHex('E012C00401018010C00402018010C00403018010');
    assert.deepEqual(parseKeyInformation(kit), [
      {id: 1, kvn: 1, components: [{type: 0x80, length: 16}]},
      {id: 2, kvn: 1, components: [{type: 0x80, length: 16}]},
      {id: 3, kvn: 1, components: [{type: 0x80, length: 16}]},
    ]);
    assert.throws(() => parseKeyInformation(fromHex('6F00')), /not a key/);
    assert.throws(
      () => parseKeyInformation(fromHex('E006C004010180')),
      /runs past/,
    );
    assert.throws(
      () => parseKeyInformation(fromHex('E00AC0080101FF8800100000')),
      /extended/,
    );
  });
});

describe('gate H0: the spare card through gp v25.10.20', () => {
  // gp -i logs in to nothing (GPTool.needsAuthentication does not list it):
  // GPData.dump sends GET DATA only, the key information template among them
  const info = capture('gp-info.txt');
  it(
    'the card holds key set 01: three DES3 keys of 16 bytes (gp -i, GET DATA 00E0)',
    {skip: info.skip},
    () => {
      const e = info
        .log()
        .find(
          x =>
            x.command[1] === 0xca &&
            x.command[2] === 0x00 &&
            x.command[3] === 0xe0 &&
            x.reply !== null &&
            parseReply(x.reply).sw === 0x9000,
        );
      assert.ok(e, 'a GET DATA 00E0 the card answered with 9000');
      assert.deepEqual(
        parseKeyInformation(parseReply(e!.reply!).data),
        [1, 2, 3].map(id => ({
          id,
          kvn: 0x01,
          components: [{type: 0x80, length: 16}],
        })),
      );
    },
  );

  const list = capture('gp-list.txt');
  it(
    'the card opens SCP02 on key set 01 (the INITIALIZE UPDATE of gp --list)',
    {skip: list.skip},
    () => {
      const iu = list.log().find(e => e.command[1] === 0x50 && e.reply);
      assert.ok(iu, 'an INITIALIZE UPDATE');
      const reply = parseInitializeUpdate(parseReply(iu!.reply!));
      assert.equal(reply.scp, 0x02);
      assert.equal(reply.kvn, 0x01);
    },
  );

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

  // what the sweep on a clean card leans on (provision.ts): a DELETE of an AID
  // that is not there answers 6A88, and the login lives on for the next one
  const absent = capture('gp-delete-absent.txt');
  it(
    'DELETE of an AID that is not there answers 6A88, and the secure channel outlives it (gp-delete-absent.txt)',
    {skip: absent.skip},
    () => {
      const r = replay(absent.log(), FACTORY_KEYS);
      const deletes = r.commands.flatMap((command, i) =>
        command[1] === 0xe4 ? [{command, reply: r.replies[i]}] : [],
      );
      assert.deepEqual(
        deletes.map(d => toHex(d.command)),
        [toHex(deleteAid(HELLO_AID)), toHex(deleteAid(HELLO_PACKAGE_AID))],
        "the hello instance, then its package, as this module's DELETE commands",
      );
      deletes.forEach((d, i) => {
        assert.ok(d.reply, `a reply to DELETE ${i + 1}`);
        assert.equal(
          parseReply(d.reply!).sw,
          0x6a88,
          i === 0
            ? 'an AID that is not there is 6A88'
            : 'the second, MACed on from the first, is 6A88 too: the channel stayed open',
        );
      });
    },
  );

  const opener = capture('gp-install-opener.txt');
  it(
    "INSTALL [for load], the LOAD blocks and the opener's INSTALL are this module's",
    {skip: opener.skip},
    () => {
      const r = replay(opener.log(), FACTORY_KEYS);
      assertGpLoad(r, CASHU_PACKAGE_AID, H0_LOAD_FILE_SHA256);
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
