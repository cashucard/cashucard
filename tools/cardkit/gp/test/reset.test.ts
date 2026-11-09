import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {resetOwnedCard, type ResetStage, type ResetOptions} from '../reset';
import {cashuPlan, provision, rotateKeys} from '../provision';
import {FACTORY_KEYS, FACTORY_KVN, SHIPPED_KVN, SPIKE_KEYS} from '../scp02';
import {ISD_AID} from '../aids';
import {fromHex, toHex} from '../bytes';
import {CPLC_09336120, FakeCard, pullAt} from '../../testing/fake-card';
import {CASHU_LOAD_FILE} from './assets';

const authority = {
  chipId: 'cplc-v1:4790d3213041093361205547',
  installationId: '03' + '5a'.repeat(32),
  sourceRef: 'https://issuer.test/escrow/00000000-0000-4000-8000-000000000001',
  intentReceipt: 'service-intent-1',
  eraseOwnerAndProofs: true as const,
  valueHandled: true as const,
};
function options(extra: Partial<ResetOptions> = {}): ResetOptions {
  return {
    authority,
    keys: SPIKE_KEYS,
    stage: 'reviewed',
    persist: async () => {},
    random: n => randomBytes(n),
    now: () => 0,
    ...extra,
  };
}
async function installed(scp: 2 | 3 = 2) {
  const card = new FakeCard({cplc: CPLC_09336120, scp});
  assert.equal(
    (
      await provision(card.transceive, cashuPlan(CASHU_LOAD_FILE), {
        ...options(),
        keys: FACTORY_KEYS,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await rotateKeys(card.transceive, FACTORY_KEYS, SPIKE_KEYS, options())).ok,
    true,
  );
  card.reset();
  card.log.length = 0;
  return card;
}

test('explicit owned-card reset removes only Cashu objects and confirms factory keys', async () => {
  const card = await installed();
  card.setCardState({owner: 1, pin: 1, record: 1});
  const unrelated = 'A000000099';
  card.packages.set(unrelated, {
    aid: unrelated,
    modules: [],
    size: 0,
    instancesMade: 0,
  });
  const saved: ResetStage[] = [];
  const result = await resetOwnedCard(
    card.transceive,
    options({
      persist: async s => {
        saved.push(s);
      },
    }),
  );
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(saved, [
    'delete_intent',
    'deletion_observed',
    'rotation_intent',
    'factory_verified',
  ]);
  assert.equal(card.instances.size, 0);
  assert.equal(card.packages.size, 1);
  assert.equal(card.packages.has(unrelated), true);
  assert.equal(toHex(card.keys.enc), toHex(FACTORY_KEYS.enc));
  assert.equal(card.failedAuths, 0);
  assert.equal(
    card.insLog().includes(0xe8),
    false,
    'reset never loads an applet',
  );
});

test('an owned-card reset on a J3R452 (SCP03) ends on the public default 40..4F at version 01', async () => {
  const card = await installed(3);
  assert.equal(
    toHex(card.keys.enc),
    toHex(SPIKE_KEYS.enc),
    'rotated off the default',
  );
  card.setCardState({owner: 1, pin: 1});
  const saved: ResetStage[] = [];
  const result = await resetOwnedCard(
    card.transceive,
    options({
      persist: async s => {
        saved.push(s);
      },
    }),
  );
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.keyVersion, 0x01);
  assert.deepEqual(saved, [
    'delete_intent',
    'deletion_observed',
    'rotation_intent',
    'factory_verified',
  ]);
  assert.equal(card.instances.size + card.packages.size, 0);
  assert.deepEqual(
    [toHex(card.keys.enc), toHex(card.keys.mac), toHex(card.keys.dek)],
    [toHex(FACTORY_KEYS.enc), toHex(FACTORY_KEYS.mac), toHex(FACTORY_KEYS.dek)],
  );
  assert.equal(card.kvn, 0x01);
  assert.equal(card.failedAuths, 0);
  // the one PUT KEY carried AES keys: 88 entries, Lc 4E with the MAC
  const put = card.log.filter(a => a[1] === 0xd8);
  assert.equal(put.length, 1);
  assert.deepEqual([put[0][4], put[0][6]], [0x4e, 0x88]);
});

test('a reset stops guarded at key version FF, as at 00, with no login, DELETE or PUT KEY: only first contact moves a card off FF', async () => {
  for (const scp of [2, 3] as const) {
    const card = await installed(scp);
    card.kvn = SHIPPED_KVN;
    const saved: ResetStage[] = [];
    const persist = async (s: ResetStage) => {
      saved.push(s);
    };
    const result = await resetOwnedCard(card.transceive, options({persist}));
    const where = `SCP0${scp}`;
    assert.equal(result.ok, false, where);
    assert.equal(result.kind, 'guarded', where);
    // after the saved intent, as the version-00 guard: a retry stops in the same place
    assert.deepEqual(saved, ['delete_intent'], where);
    assert.equal(result.stage, 'delete_intent', where);
    const sent = card.insLog();
    assert.equal(
      sent[sent.length - 1],
      0x50,
      `${where}: INITIALIZE UPDATE last`,
    );
    card.reset();
    const retry = await resetOwnedCard(
      card.transceive,
      options({stage: 'delete_intent', persist}),
    );
    assert.equal(retry.kind, 'guarded', where);
    assert.deepEqual(saved, ['delete_intent'], where);
    assert.equal(
      card.insLog().some(i => [0x82, 0xe4, 0xd8].includes(i)),
      false,
      `${where}: no 82, E4 or D8`,
    );
    assert.equal(card.instances.size, 3, where);
    assert.equal(card.kvn, SHIPPED_KVN, where);
    assert.equal(card.failedAuths, 0, where);
  }
});

test('first contact, then an owned-card reset: a J3R452 that shipped at FF ends on the public default at 01, and installs and rotates again as a J3R180 does', async () => {
  const card = new FakeCard({cplc: CPLC_09336120, scp: 3, kvn: SHIPPED_KVN});
  const install = () =>
    provision(card.transceive, cashuPlan(CASHU_LOAD_FILE), {
      ...options(),
      keys: FACTORY_KEYS,
    });
  assert.equal((await install()).ok, true);
  const first = await rotateKeys(
    card.transceive,
    FACTORY_KEYS,
    SPIKE_KEYS,
    options(),
  );
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.firstContact, true);
  assert.equal(card.kvn, FACTORY_KVN);
  card.reset();
  const reset = await resetOwnedCard(card.transceive, options());
  assert.equal(reset.ok, true, reset.reason);
  assert.equal(reset.keyVersion, FACTORY_KVN);
  assert.equal(card.instances.size + card.packages.size, 0);
  assert.equal(card.kvn, FACTORY_KVN);
  assert.deepEqual(
    [toHex(card.keys.enc), toHex(card.keys.mac), toHex(card.keys.dek)],
    [toHex(FACTORY_KEYS.enc), toHex(FACTORY_KEYS.mac), toHex(FACTORY_KEYS.dek)],
  );
  // first contact's PUT KEY (P1 00), then the reset's, in place at 01
  assert.deepEqual(
    card.log.filter(a => a[1] === 0xd8).map(a => a.slice(0, 5)),
    [
      [0x84, 0xd8, 0x00, 0x81, 0x4e],
      [0x84, 0xd8, 0x01, 0x81, 0x4e],
    ],
  );
  card.reset();
  const at = card.log.length;
  assert.equal((await install()).ok, true);
  const again = await rotateKeys(
    card.transceive,
    FACTORY_KEYS,
    SPIKE_KEYS,
    options(),
  );
  assert.equal(again.ok, true, again.reason);
  assert.equal(again.firstContact, undefined);
  assert.equal(again.keyVersion, FACTORY_KVN);
  assert.deepEqual(
    card.log
      .slice(at)
      .filter(a => a[1] === 0xd8)
      .map(a => a.slice(0, 5)),
    [[0x84, 0xd8, 0x01, 0x81, 0x4e]],
    'in place at 01, as on a J3R180',
  );
  assert.equal(card.failedAuths, 0);
});

test('a reset takes the ISD alone: any other sdAid stops it guarded before its first APDU, with nothing saved', async () => {
  // identity and the reset's registry read use the ISD until a security domain other
  // than the ISD is needed (D182); logged in elsewhere, a reset would save
  // delete_intent and never get past the registry
  const other = fromHex('A000000003000000');
  for (const scp of [2, 3] as const) {
    const card = await installed(scp);
    for (const stage of [
      'reviewed',
      'delete_intent',
      'deletion_observed',
      'rotation_intent',
      'factory_verified',
    ] as const) {
      const saved: ResetStage[] = [];
      const result = await resetOwnedCard(
        card.transceive,
        options({
          stage,
          sdAid: other,
          persist: async s => {
            saved.push(s);
          },
        }),
      );
      const where = `SCP0${scp} at ${stage}`;
      assert.equal(result.ok, false, where);
      assert.equal(result.kind, 'guarded', where);
      assert.equal(result.stage, stage, where);
      assert.deepEqual(saved, [], `${where}: nothing saved`);
      assert.deepEqual(card.log, [], `${where}: no APDU`);
    }
    // the ISD's AID, named, is the default
    const result = await resetOwnedCard(
      card.transceive,
      options({sdAid: Array.from(ISD_AID)}),
    );
    assert.equal(result.ok, true, result.reason);
    assert.equal(card.instances.size + card.packages.size, 0);
    assert.equal(card.failedAuths, 0);
  }
});

test('lost DELETE or PUT KEY reply resumes from observed state, without a failed login', async () => {
  const baseline = await installed();
  assert.equal((await resetOwnedCard(baseline.transceive, options())).ok, true);
  const cuts = baseline.log.flatMap((a, index) =>
    [0xe4, 0xd8].includes(a[1]) ? [index] : [],
  );
  assert.equal(cuts.length, 5);
  for (const at of cuts)
    for (const when of ['before', 'after'] as const) {
      const card = await installed();
      let stage: ResetStage = 'reviewed';
      const persist = async (s: ResetStage) => {
        stage = s;
      };
      const pulled = pullAt(card, at, when);
      const first = await resetOwnedCard(pulled.tx, options({persist}));
      assert.equal(first.ok, false);
      assert.equal(pulled.state.late, 0);
      const deletesBefore = card.log.filter(a => a[1] === 0xe4).length;
      card.reset();
      const again = await resetOwnedCard(
        card.transceive,
        options({stage, persist}),
      );
      assert.equal(again.ok, true, again.reason);
      assert.equal(card.instances.size, 0);
      assert.equal(card.packages.size, 0);
      assert.equal(card.failedAuths, 0);
      assert.equal(
        card.log.filter(a => a[1] === 0xe4).length,
        4,
        'only still-present objects are deleted',
      );
      assert.ok(deletesBefore <= 4);
      assert.equal(
        card.log.filter(a => a[1] === 0xd8).length,
        1,
        'a committed rotation is adopted',
      );
    }
});

test('wrong card, changed applet, proof slots, missing consent and storage failure prevent mutation', async () => {
  for (const variant of [
    'chip',
    'installation',
    'proofs',
    'consent',
    'storage',
    'manager',
    'version',
  ] as const) {
    const card = await installed();
    const config = options();
    if (variant === 'chip')
      config.authority = {
        ...authority,
        chipId: authority.chipId.replace('5547', '5548'),
      };
    if (variant === 'installation')
      config.authority = {...authority, installationId: '02' + '5a'.repeat(32)};
    if (variant === 'proofs') card.setCardState({unspent: 1});
    if (variant === 'consent')
      config.authority = {...authority, intentReceipt: ''};
    if (variant === 'storage')
      config.persist = async () => {
        throw new Error('disk unavailable');
      };
    if (variant === 'manager')
      card.keys = {
        enc: Array.from(FACTORY_KEYS.enc),
        mac: Array.from(FACTORY_KEYS.mac),
        dek: Array.from(FACTORY_KEYS.dek),
      };
    if (variant === 'version') card.kvn = 0;
    assert.equal((await resetOwnedCard(card.transceive, config)).ok, false);
    assert.equal(
      card.insLog().some(i => [0xe4, 0xd8, 0x82].includes(i)),
      false,
    );
  }
});

test('storage loss at every acknowledgement boundary retains a recoverable intent', async () => {
  for (const failing of [
    'deletion_observed',
    'rotation_intent',
    'factory_verified',
  ] as const) {
    const card = await installed();
    let saved: ResetStage = 'reviewed';
    const first = await resetOwnedCard(
      card.transceive,
      options({
        persist: async stage => {
          if (stage === failing) throw new Error('disk unavailable');
          saved = stage;
        },
      }),
    );
    assert.equal(first.kind, 'storage');
    card.reset();
    assert.equal(
      (await resetOwnedCard(card.transceive, options({stage: saved}))).ok,
      true,
    );
    assert.equal(card.log.filter(a => a[1] === 0xd8).length, 1);
    assert.equal(card.failedAuths, 0);
  }
});
