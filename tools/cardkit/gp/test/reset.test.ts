import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {resetOwnedCard, type ResetStage, type ResetOptions} from '../reset';
import {cashuPlan, provision, rotateKeys} from '../provision';
import {FACTORY_KEYS, SPIKE_KEYS} from '../scp02';
import {toHex} from '../bytes';
import {FakeCard, pullAt} from './fake-card';
import {CASHU_LOAD_FILE} from './assets';

const authority = {
  chipId: 'cplc-v1:4790d3213041093363205547',
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
async function installed() {
  const card = new FakeCard();
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
