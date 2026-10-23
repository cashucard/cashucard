import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {
  readCashuRegistry,
  registryCommand,
  parseRegistryEntries,
} from '../registry';
import {FACTORY_KEYS, parseReply, type Reply} from '../scp02';
import {fromHex, toHex} from '../bytes';
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
