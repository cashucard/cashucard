import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {
  RegistryEvidenceError,
  readCashuRegistry,
  readForeignTag,
  registryCommand,
  parseRegistryEntries,
} from '../registry';
import {
  CardError,
  FACTORY_KEYS,
  openSession,
  parseReply,
  type Reply,
} from '../scp02';
import {TAG_AID} from '../aids';
import {fromHex, toHex} from '../bytes';
import {cashuPlan, provision} from '../provision';
import {FakeCard} from '../../testing/fake-card';
import {CASHU_LOAD_FILE} from './assets';
import {parseGpLog, replay} from './transcript';

const fixture = join(__dirname, 'fixtures/gp-list.txt');
const capture = existsSync(fixture)
  ? replay(parseGpLog(readFileSync(fixture, 'utf8')), FACTORY_KEYS)
  : null;
const pending = capture ? false : 'pending H0 fixtures: gp-list.txt';
function captured(p1: number): number[] {
  assert.ok(capture);
  const at = capture.commands.findIndex(c => c[1] === 0xf2 && c[2] === p1);
  assert.notEqual(at, -1);
  return parseReply(capture.replies[at]!).data;
}
const apps = capture ? captured(0x40) : [];
const packages = capture ? captured(0x20) : [];
const ok = (data: number[] = []): Reply => ({data, sw: 0x9000});
function script(replies: Reply[]) {
  const commands: number[][] = [];
  return {
    commands,
    send: async (command: number[]): Promise<Reply> => {
      commands.push(command);
      assert.ok(replies.length, 'unexpected extra command');
      return replies.shift()!;
    },
  };
}

test(
  'registry commands and Cashu object evidence match the existing owner capture',
  {skip: pending},
  async () => {
    assert.ok(capture);
    for (const p1 of [0x40, 0x20]) {
      assert.deepEqual(
        registryCommand(p1 === 0x40 ? 'applications' : 'load-files'),
        capture.commands.find(c => c[1] === 0xf2 && c[2] === p1),
      );
    }
    const {send, commands} = script([ok(apps), ok(packages)]);
    assert.deepEqual(await readCashuRegistry(send), {
      tag: true,
      card: true,
      opener: true,
      package: true,
    });
    assert.deepEqual(
      commands.map(c => c[1]),
      [0xf2, 0xf2],
    );
  },
);

test(
  'continuation assembles split records; absent lists are explicit evidence',
  {skip: pending},
  async () => {
    const {send, commands} = script([
      {data: apps.slice(0, 17), sw: 0x6310},
      ok(apps.slice(17)),
      ok(packages),
    ]);
    assert.equal((await readCashuRegistry(send)).card, true);
    assert.deepEqual(commands[1], registryCommand('applications', true));
    const absent = script([{data: [], sw: 0x6a88}, ok()]);
    assert.deepEqual(await readCashuRegistry(absent.send), {
      tag: false,
      card: false,
      opener: false,
      package: false,
    });
  },
);

test(
  'malformed, duplicate or foreign-owned target entries stop instead of authorizing removal',
  {skip: pending},
  async () => {
    for (const invalid of [
      apps.slice(0, -1),
      [...apps, ...apps],
      [0xe3, 0x80],
      fromHex('E3034F0100'),
    ]) {
      assert.throws(() => parseRegistryEntries(invalid));
    }
    const wrongPackage = apps.slice();
    const pkgAt = toHex(wrongPackage).indexOf('C40AF0434153485543415244') / 2;
    wrongPackage[pkgAt + 11] ^= 1;
    const privileged = apps.slice();
    const privilegesAt = toHex(privileged).indexOf('C503000000') / 2;
    privileged[privilegesAt + 2] = 0x80;
    const wrongDomain = apps.slice();
    const domainAt = toHex(wrongDomain).indexOf('CC08A000000151000000') / 2;
    wrongDomain[domainAt + 9] ^= 1;
    const otherInstance = apps.slice();
    otherInstance[14] ^= 1;
    for (const invalid of [
      wrongPackage,
      privileged,
      wrongDomain,
      otherInstance,
    ]) {
      await assert.rejects(() =>
        readCashuRegistry(script([ok(invalid), ok(packages)]).send),
      );
    }
  },
);

test(
  'the Cashu objects must be in the security domain named, the ISD by default',
  {skip: pending},
  async () => {
    const isd = await readCashuRegistry(
      script([ok(apps), ok(packages)]).send,
      fromHex('A000000151000000'),
    );
    assert.deepEqual(isd, {tag: true, card: true, opener: true, package: true});
    await assert.rejects(
      readCashuRegistry(
        script([ok(apps), ok(packages)]).send,
        fromHex('A000000003000000'),
      ),
      RegistryEvidenceError,
    );
  },
);

/**
 * The J3R452 test card as it came (`gp --list` under the public default,
 * scp03-07): the seller's four applets, the NDEF tag among them at
 * D2760000850101, made from D276000085.
 */
const j3r452Fixture = join(
  __dirname,
  'fixtures/scp03-07-list-default-keyver1.txt',
);
const j3r452 = existsSync(j3r452Fixture)
  ? replay(parseGpLog(readFileSync(j3r452Fixture, 'utf8')), FACTORY_KEYS)
  : null;
const j3r452Pending = j3r452
  ? false
  : 'pending H0 fixtures: scp03-07-list-default-keyver1.txt';
/** The seller's NDEF tag's entry in the J3R452's GET STATUS of the applications. */
const SELLER_TAG = fromHex(
  'E3234F07D27600008501019F700107C503000000C405D276000085CC08A000000151000000',
);

/** Answers each command with the J3R452's reply to gp's same command, in the order gp sent them. */
function fromJ3r452(
  edit: (command: number[], reply: Reply) => Reply = (_, r) => r,
) {
  assert.ok(j3r452);
  const used = new Set<number>();
  const commands: number[][] = [];
  return {
    commands,
    send: async (command: number[]): Promise<Reply> => {
      commands.push(command);
      const at = j3r452.commands.findIndex(
        (c, i) => !used.has(i) && toHex(c) === toHex(command),
      );
      assert.notEqual(at, -1, `gp sent no ${toHex(command)}`);
      used.add(at);
      return edit(command, parseReply(j3r452.replies[at]!));
    },
  };
}

test(
  "the J3R452 as it came (scp03-07): the seller's NDEF tag at D2760000850101 is no Cashu tag, so nothing is vouched for",
  {skip: j3r452Pending},
  async () => {
    const card = fromJ3r452();
    await assert.rejects(readCashuRegistry(card.send), RegistryEvidenceError);
    // gp's own GET STATUS, the load files in two pages (6310, then 9000)
    assert.deepEqual(card.commands, [
      registryCommand('applications'),
      registryCommand('load-files'),
      registryCommand('load-files', true),
    ]);
    // without that one entry, the seller's other applets and the JCOP packages are no Cashu object
    const without = fromJ3r452((command, reply) => {
      if (command[2] !== 0x40) {
        return reply;
      }
      const at = toHex(reply.data).indexOf(toHex(SELLER_TAG)) / 2;
      assert.ok(at >= 0, "the seller's tag is in the capture");
      const data = reply.data.slice();
      data.splice(at, SELLER_TAG.length);
      return {...reply, data};
    });
    assert.deepEqual(await readCashuRegistry(without.send), {
      tag: false,
      card: false,
      opener: false,
      package: false,
    });
  },
);

test(
  "the fake card's seller layout answers GET STATUS of the applications with the J3R452's own bytes",
  {skip: j3r452Pending},
  async () => {
    const card = new FakeCard({scp: 3, sellerApplets: true});
    const session = await openSession(card.transceive, FACTORY_KEYS, n =>
      randomBytes(n),
    );
    const command = registryCommand('applications');
    assert.deepEqual(
      await session.send(card.transceive, command),
      await fromJ3r452().send(command),
    );
    await assert.rejects(
      readCashuRegistry(c => session.send(card.transceive, c)),
      RegistryEvidenceError,
    );
  },
);

test('unexpected status and non-progressing pagination stop without retry', async () => {
  for (const replies of [
    [{data: [], sw: 0x6982}],
    [{data: [], sw: 0x6310}],
    Array.from({length: 16}, () => ({data: [0], sw: 0x6310})),
  ]) {
    const {send, commands} = script(replies.slice());
    await assert.rejects(() => readCashuRegistry(send));
    assert.equal(commands.length, replies.length);
  }
});

/** The seller's tag's entry, with one field's bytes (hex) replaced, its E3 length set again. */
function sellerTag(edit?: readonly [string, string]): number[] {
  let fields = toHex(SELLER_TAG.slice(2));
  if (edit) {
    assert.ok(fields.includes(edit[0]), edit[0]);
    fields = fields.replace(edit[0], edit[1]);
  }
  const bytes = fromHex(fields);
  return [0xe3, bytes.length, ...bytes];
}

test(
  "readForeignTag finds the seller's NDEF tag on the J3R452 as it came (scp03-07), from GET STATUS of the applications alone",
  {skip: j3r452Pending},
  async () => {
    const card = fromJ3r452();
    assert.equal(await readForeignTag(card.send), true);
    assert.deepEqual(card.commands, [registryCommand('applications')]);
  },
);

test(
  'readForeignTag finds none where the Cashu card is installed (gp-list)',
  {skip: pending},
  async () => {
    const {send, commands} = script([ok(apps)]);
    assert.equal(await readForeignTag(send), false);
    assert.deepEqual(commands, [registryCommand('applications')]);
  },
);

test('readForeignTag finds none on a blank card, nor on a J3R452 the Cashu card is installed on', async () => {
  const blank = script([{data: [], sw: 0x6a88}]);
  assert.equal(await readForeignTag(blank.send), false);
  assert.deepEqual(blank.commands, [registryCommand('applications')]);
  const card = new FakeCard({scp: 3});
  const installed = await provision(
    card.transceive,
    cashuPlan(CASHU_LOAD_FILE),
    {
      random: n => randomBytes(n),
      now: () => 0,
    },
  );
  assert.equal(installed.ok, true, installed.reason);
  assert.ok(card.instanceAids().includes(toHex(TAG_AID)), 'our tag is there');
  card.reset();
  const session = await openSession(card.transceive, FACTORY_KEYS, n =>
    randomBytes(n),
  );
  assert.equal(
    await readForeignTag(c => session.send(card.transceive, c)),
    false,
  );
});

test("readForeignTag holds the instance at D2760000850101 to the seller's shape, its own load file in the security domain named, selectable, with no privileges: anything else is RegistryEvidenceError", async () => {
  assert.equal(await readForeignTag(script([ok(sellerTag())]).send), true);
  for (const [name, edit] of [
    [
      'another security domain',
      ['CC08A000000151000000', 'CC08A000000003000000'],
    ],
    ['locked (life cycle 83)', ['9F700107', '9F700183']],
    ['installed, not selectable (life cycle 03)', ['9F700107', '9F700103']],
    ['a privilege (security domain)', ['C503000000', 'C503800000']],
    ['no privileges listed', ['C503000000', '']],
    ['no load file', ['C405D276000085', '']],
  ] as const) {
    // a well-formed entry, so it is the shape that is refused
    assert.equal(parseRegistryEntries(sellerTag(edit)).length, 1, name);
    await assert.rejects(
      readForeignTag(script([ok(sellerTag(edit))]).send),
      RegistryEvidenceError,
      name,
    );
  }
  // the seller's own bytes, held to another security domain than theirs
  await assert.rejects(
    readForeignTag(script([ok(sellerTag())]).send, fromHex('A000000003000000')),
    RegistryEvidenceError,
  );
  // a reply that does not parse is no evidence, and a refusal is the card's
  await assert.rejects(
    readForeignTag(script([ok(sellerTag().slice(0, -1))]).send),
    RegistryEvidenceError,
  );
  await assert.rejects(
    readForeignTag(script([{data: [], sw: 0x6982}]).send),
    CardError,
  );
});
