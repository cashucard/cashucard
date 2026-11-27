import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {
  CPLC_09336320,
  FakeCard,
  type FakeCardOptions,
} from '../../testing/fake-card';
import {fromHex} from '../bytes';
import {parseCplc} from '../identity';
import {requireBlankJ3R180Registry} from '../registry';
import {cashuPlan, provision} from '../provision';
import {SPIKE_KEYS} from '../scp02';
import {CASHU_LOAD_FILE, TEST_TAG_ADDRESS} from './assets';

const rom = [
  ['A0000001515350', 'FFFF'],
  ['A0000000620204', '0100'],
  ['A0000000620202', '0103'],
] as const;
const doc = ['A00000016443446F634C697465', '0100'] as const;
const chipId = parseCplc(fromHex(CPLC_09336320)).id;
const plan = cashuPlan(CASHU_LOAD_FILE, {tagAddress: TEST_TAG_ADDRESS});
const changes = (card: FakeCard) =>
  card.insLog().filter(ins => [0xe4, 0xe6, 0xe8, 0xd8].includes(ins));
function fixture(options: FakeCardOptions = {}) {
  const card = new FakeCard({platformPackages: rom, ...options});
  let commits = 0;
  const run = (
    afterIntent: () => void = () => {},
    expectedChip = chipId,
    version = 1,
  ) =>
    provision(card.transceive, plan, {
      random: randomBytes,
      now: Date.now,
      blankRetry: {
        chipId: expectedChip,
        factoryKeyVersion: version,
        persistIntent: async () => {
          assert.deepEqual(changes(card), []);
          commits++;
          afterIntent();
        },
      },
    });
  return {card, run, commits: () => commits};
}
for (const platformPackages of [rom, [...rom, doc]]) {
  test(
    'verified factory inventory with ' +
      platformPackages.length +
      ' ROM packages authorizes exactly one clean install',
    async () => {
      const f = fixture({platformPackages});
      assert.equal((await f.run()).ok, true);
      assert.equal(f.commits(), 1);
      assert.equal(f.card.insLog().filter(i => i === 0x82).length, 1);
      assert.equal(f.card.insLog().filter(i => i === 0xf2).length, 4);
      assert.equal(f.card.insLog().includes(0xe4), false);
      assert.equal(changes(f.card)[0], 0xe6);
    },
  );
}
test('unknown app, partial package, unknown load file, missing ROM and wrong ROM version refuse before intent', async () => {
  const partial = fixture();
  partial.card.partial.set('F0434153485543415244', 1);
  for (const f of [
    partial,
    fixture({sellerApplets: true}),
    fixture({platformPackages: []}),
    fixture({platformPackages: [...rom, ['F0434153485543415244', '0301']]}),
    fixture({platformPackages: [rom[0], rom[1], [rom[2][0], '0102']]}),
  ]) {
    assert.equal((await f.run()).ok, false);
    assert.equal(f.commits(), 0);
    assert.deepEqual(changes(f.card), []);
  }
});
test('changed chip, wrong remote key proof, key template version or protocol cannot authenticate', async () => {
  const substituted = fixture();
  await assert.rejects(
    () => substituted.run(undefined, chipId.replace(/.$/, '8')),
    {name: 'ChipIdentityMismatch'},
  );
  assert.ok(!substituted.card.insLog().includes(0x50));
  for (const f of [
    fixture({kvn: 2}),
    fixture({
      keys: {
        enc: Array.from(SPIKE_KEYS.enc),
        mac: Array.from(SPIKE_KEYS.mac),
        dek: Array.from(SPIKE_KEYS.dek),
      },
    }),
    fixture({scp: 3}),
  ]) {
    assert.equal((await f.run()).ok, false);
    assert.equal(f.commits(), 0);
    assert.ok(!f.card.insLog().includes(0x82));
    assert.deepEqual(changes(f.card), []);
  }
});
test('missing server or journal confirmation, lost field, or registry change after persistence sends no install', async () => {
  const save = fixture();
  await assert.rejects(
    () =>
      save.run(() => {
        throw new Error('persistence refused');
      }),
    /persistence refused/,
  );
  assert.deepEqual(changes(save.card), []);
  const loss = fixture();
  assert.equal(
    (
      await loss.run(() => {
        loss.card.mute = true;
      })
    ).kind,
    'pulled',
  );
  assert.deepEqual(changes(loss.card), []);
  const changed = fixture();
  const aid = 'F0434153485543415244';
  assert.equal(
    (await changed.run(() => changed.card.partial.set(aid, 1))).kind,
    'guarded',
  );
  assert.deepEqual(changes(changed.card), []);
});

test('the authenticated baseline rejects additional fields, duplicate files and incomplete continuation', async () => {
  const response = (pkg: readonly [string, string], extra: number[] = []) => {
    const [aid, version] = pkg;
    const bytes = [
      0x4f,
      aid.length / 2,
      ...fromHex(aid),
      ...fromHex('9F700101CE02' + version + 'CC08A000000151000000'),
      ...extra,
    ];
    return [0xe3, bytes.length, ...bytes];
  };
  for (const packages of [
    [
      ...response(rom[0], [0xc5, 1, 0]),
      ...response(rom[1]),
      ...response(rom[2]),
    ],
    [...rom.flatMap(x => response(x)), ...response(rom[0])],
  ]) {
    await assert.rejects(() =>
      requireBlankJ3R180Registry(async cmd => ({
        sw: 0x9000,
        data: cmd[2] === 0x40 ? [] : packages,
      })),
    );
  }
  await assert.rejects(() =>
    requireBlankJ3R180Registry(async cmd => ({
      sw: cmd[2] === 0x40 ? 0x6a88 : cmd[3] === 0x02 ? 0x6310 : 0x6982,
      data: cmd[2] === 0x20 && cmd[3] === 0x02 ? response(rom[0]) : [],
    })),
  );
});
