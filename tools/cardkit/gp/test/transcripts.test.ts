/**
 * Gate H0: the owner's GlobalPlatformPro captures of the spare J3R180, and of
 * the J3R452 test card under SCP03 (gp/test/fixtures/README.md), replayed
 * through this module. Each test skips, saying `pending H0 fixtures`, while
 * its capture is missing, and is required once it lands: the handshake must
 * prove the keys, and every command gp sent under the MAC must be the one
 * this module sends.
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
  ISD_AID,
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
  getKeyInformation,
  installAndSelectable,
  installForLoad,
  parseCommand,
  parseFreeMemory,
  parseInitializeUpdate,
  parseKeyInformation,
  parseReply,
  putKeys,
  splitLoad,
  type KeySet,
} from '../scp02';
import {HELLO_LOAD_FILE} from './assets';
import {FakeCard} from '../../testing/fake-card';
import {nodeScp03Kdf} from '../../testing/node-aes';
import {
  formatGpExchange,
  parseGpLog,
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
    // a length form other than one byte or 81 and one is refused, not read as a short length
    assert.throws(
      () => parseKeyInformation(fromHex(`E082${'00'.repeat(130)}`)),
      /length form/,
    );
    assert.throws(() => parseKeyInformation(fromHex('E080')), /length form/);
    assert.deepEqual(parseKeyInformation(fromHex('E08100')), []);
  });

  it("reads the J3R452 test card's key information before and after first contact: AES keys 01 to 03 at FF, then at 01 (D182)", () => {
    // the owner's gp runs of 2026-11-08 (not in the repository): GET DATA E0 with no secure channel
    const aes = (kvn: number) =>
      [1, 2, 3].map(id => ({
        id,
        kvn,
        components: [{type: 0x88, length: 16}],
      }));
    assert.deepEqual(
      parseKeyInformation(fromHex('E012C00401FF8810C00402FF8810C00403FF8810')),
      aes(0xff),
    );
    assert.deepEqual(
      parseKeyInformation(fromHex('E012C00401018810C00402018810C00403018810')),
      aes(0x01),
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
      // plain, no secure channel: the command first contact reads the key information with (D182)
      assert.deepEqual(e!.command, getKeyInformation());
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
          toHex(putKeys(to, r.session, {p1: put[2], newKvn: put[5]})),
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

/**
 * The J3R452's probe package (fedimintcard's tools/j3r180-probe), which
 * scp03-09 loads and installs and scp03-10 deletes, and the sha256 of the
 * load file its LOAD blocks carry. As with H0_LOAD_FILE_SHA256, only a new
 * capture moves it.
 */
const PROBE_PACKAGE_AID = fromHex('F0464D50524F42');
const PROBE_AID = fromHex('F0464D50524F4201');
const PROBE_LOAD_FILE_SHA256 =
  '32a12d40b6c65392fc4345165d8f7d02300fd715b313113193a505ef96f21fb5';

describe('SCP03: the J3R452 test card through gp v25.10.20, under the public default 40..4F', () => {
  // gp --list's GET STATUS: the ISD, the applications, then the load files
  // with their modules and the load files alone, each in pages (P2 02, then 03)
  const GET_STATUS = [
    '80F28002',
    '80F24002',
    '80F21002',
    '80F21003',
    '80F21003',
    '80F22002',
    '80F22003',
  ];
  // the four logins, in the order they were made, INITIALIZE UPDATE's P1 (07
  // names key version 01 with `--key-ver 1`, the rest let the card choose),
  // and what gp sent under the MAC after the first seven GET STATUS
  const logins: [string, number, string[]][] = [
    ['scp03-07-list-default-keyver1.txt', 0x01, []],
    ['scp03-08-list-default-auto.txt', 0x00, []],
    [
      'scp03-09-install-probe-default-key.txt',
      0x00,
      [
        '80E60200',
        ...[0, 1, 2, 3, 4, 5].map(i => '80E800' + toHex([i])),
        '80E88006',
        ...GET_STATUS,
        '80E60C00',
      ],
    ],
    ['scp03-10-delete-probe-default-key.txt', 0x00, ['80E40080']],
  ];
  const captures = logins.map(([name]) => capture(name));
  const anyMissing = captures.find(c => c.skip)?.skip ?? false;

  for (const [index, [name]] of logins.entries()) {
    const c = captures[index];
    it(
      `every session key, both cryptograms and every C-MAC of ${name} are this module's`,
      {skip: c.skip},
      () => {
        const log = c.log();
        const r = replay(log, FACTORY_KEYS);
        const {hostChallenge, reply} = r.handshake;
        assert.equal(reply.scp, 0x03);
        // the session keys, by node:crypto's KDF, which shares no code with scp03.ts
        const context = concat(hostChallenge, reply.cardChallenge);
        const sMac = nodeScp03Kdf(FACTORY_KEYS.mac, 0x06, 128, context);
        assert.deepEqual(r.session.keys, {
          enc: nodeScp03Kdf(FACTORY_KEYS.enc, 0x04, 128, context),
          mac: sMac,
          dek: Array.from(FACTORY_KEYS.dek),
        });
        // the card's challenge and cryptogram, which the replay has already held to the keys
        assert.deepEqual(
          reply.cardChallenge,
          nodeScp03Kdf(FACTORY_KEYS.enc, 0x02, 64, concat(reply.seq, ISD_AID)),
        );
        assert.deepEqual(
          reply.cardCryptogram,
          nodeScp03Kdf(sMac, 0x00, 64, context),
        );
        // the host cryptogram gp sent in EXTERNAL AUTHENTICATE
        const ea = log.find(e => e.command[1] === 0x82)!;
        assert.deepEqual(ea.command.slice(5, 13), r.hostCryptogram);
        assert.deepEqual(
          r.hostCryptogram,
          nodeScp03Kdf(sMac, 0x01, 64, context),
        );
        // and every command gp sent under the MAC was re-wrapped to its bytes
        const wrapped = log.filter(e => e.command[0] === 0x84);
        assert.equal(r.commands.length, wrapped.length - 1);
      },
    );
  }

  it(
    "the four logins hold 49 commands under the C-MAC, every one of them this module's",
    {skip: anyMissing},
    () => {
      const total = captures
        .map(c => replay(c.log(), FACTORY_KEYS))
        .reduce((n, r) => n + 1 + r.commands.length, 0);
      assert.equal(total, 49, 'four EXTERNAL AUTHENTICATE and 45 more');
    },
  );

  const install = captures[2];
  it(
    "scp03-09's INSTALL [for load], LOAD blocks and INSTALL [for install and make selectable] are this module's",
    {skip: install.skip},
    () => {
      const r = replay(install.log(), FACTORY_KEYS);
      assertGpLoad(r, PROBE_PACKAGE_AID, PROBE_LOAD_FILE_SHA256);
      const inst = only(
        r.commands,
        x => x[1] === 0xe6 && x[2] === 0x0c,
        'INSTALL [for install and make selectable]',
      );
      assert.equal(
        toHex(inst),
        toHex(installAndSelectable(PROBE_PACKAGE_AID, PROBE_AID, PROBE_AID)),
      );
    },
  );

  it(
    'the shape of each login: SELECT of the ISD, a 32-byte INITIALIZE UPDATE reply (version 01, SCP03, i=10, the counter one up each time), EXTERNAL AUTHENTICATE answered with no data, seven GET STATUS, then the command gp was asked for',
    {skip: anyMissing},
    () => {
      let counter = -1;
      for (const [index, [name, p1, then]] of logins.entries()) {
        const log = captures[index].log();
        const [select, iu, ea, ...rest] = log;
        // the card's default selection is the ISD, under the AID the challenge is made over
        assert.equal(toHex(select.command), '00A4040000', name);
        assert.ok(
          toHex(select.reply!).includes('84' + '08' + toHex(ISD_AID)),
          `${name}: the FCI names the ISD`,
        );
        assert.deepEqual(
          iu.command.slice(0, 5),
          [0x80, 0x50, p1, 0x00, 0x08],
          name,
        );
        const reply = parseReply(iu.reply!);
        assert.equal(reply.sw, 0x9000);
        assert.equal(reply.data.length, 32, name);
        assert.deepEqual(reply.data.slice(10, 13), [0x01, 0x03, 0x10], name);
        const seq =
          (reply.data[29] << 16) | (reply.data[30] << 8) | reply.data[31];
        assert.ok(
          counter < 0 || seq === counter + 1,
          `${name}: counter ${seq}`,
        );
        counter = seq;
        assert.deepEqual(
          ea.command.slice(0, 5),
          [0x84, 0x82, 0x01, 0x00, 0x10],
          name,
        );
        assert.equal(ea.command.length, 22, `${name}: Le 00 after the MAC`);
        assert.deepEqual(
          ea.reply,
          [0x90, 0x00],
          `${name}: no R-MAC at level 01`,
        );
        // then GET STATUS, and what gp was asked for, each CLA 84 with the MAC and Le 00
        assert.deepEqual(
          rest.map(e => toHex(e.command.slice(0, 4)).replace(/^84/, '80')),
          [...GET_STATUS, ...then],
          name,
        );
        for (const e of rest) {
          const c = parseCommand(e.command);
          assert.equal(c.cla, 0x84, name);
          assert.equal(c.le, 0x00, name);
          assert.ok(c.data.length >= 8, name);
        }
        assert.ok(
          rest
            .slice(0, 7)
            .every(
              e => toHex(parseCommand(e.command).data.slice(0, 2)) === '4F00',
            ),
          `${name}: each GET STATUS asks for 4F 00`,
        );
      }
    },
  );
});
