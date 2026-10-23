import assert from 'node:assert/strict';
import test from 'node:test';
import {schnorr, secp256k1} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha256';
import {readFileSync} from 'node:fs';
import {
  cleanupSettledEntries,
  readResetReview,
  sealResetPin,
} from '../settled-cleanup';
import {fromHex, toHex} from '../bytes';

const {
  cardSecret,
  compressed,
  hashToCurve,
} = require('../../../cardsim/cashu-crypto.cjs');
const chipId = 'cplc-v1:4790d3213041093363205547';
const secret = '01'.padStart(64, '0');
const installationId = toHex(secp256k1.getPublicKey(secret)).toLowerCase();
const mint = 'https://mint.example.test';
function card(initialSpent = 1) {
  let spent = initialSpent;
  const commands: number[][] = [];
  const raw = [
    2,
    ...fromHex('0059534ce0bfa19a'),
    0,
    0,
    0,
    1,
    ...new Array(32).fill(3),
    ...fromHex(installationId),
    0,
    0,
    0,
    0,
  ];
  const tx = async (a: number[]) => {
    commands.push(a);
    let data: number[] = [];
    if (a[1] === 0xca) {
      data = fromHex(
        '9f7f2a4790d32147000000000030410933632055470000000000000000048c2337323937360000000000000000',
      );
    } else if (a[1] === 0xa4) {
      data = a.slice(5, -1).at(-1) === 1 && a[5] === 0xf0 ? [2, 1] : [];
    } else if (a[1] === 1) {
      data = [
        2,
        1,
        128,
        0,
        spent,
        128 - spent,
        255,
        1,
        4,
        3,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        ...new Array(13).fill(0),
      ];
    } else if (a[1] === 0x10) data = fromHex(installationId);
    else if (a[1] === 0x16) {
      data = new Array(109 + mint.length).fill(0);
      data[0] = 4;
      data[1] = 1;
      data[105] = mint.length;
      Array.from(mint, c => c.charCodeAt(0)).forEach((b, i) => {
        data[106 + i] = b;
      });
    } else if (a[1] === 0x14) data = [spent ? 2 : 0, ...new Array(127).fill(0)];
    else if (a[1] === 0x13) data = raw;
    else if (a[1] === 0x44) {
      const key = fromHex(installationId);
      const digest = sha256(
        Uint8Array.from([
          ...Array.from('CashuCard/pinkey', c => c.charCodeAt(0)),
          ...key,
        ]),
      );
      data = [
        ...new Array(16).fill(7),
        ...key,
        ...schnorr.sign(digest, secret, new Uint8Array(32)),
      ];
    } else if (a[1] === 0x40) assert.equal(a[2], 1);
    else if (a[1] === 0x31) {
      spent = 0;
      data = [1];
    } else assert.fail('unexpected instruction');
    return [...data, 0x90, 0];
  };
  const mintJson = async (
    _origin: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> => {
    if (path === '/v1/keysets')
      return {keysets: [{id: '0059534ce0bfa19a', unit: 'sat'}]};
    const expected = compressed(
      hashToCurve(Buffer.from(cardSecret('03'.repeat(32), installationId))),
    ).toString('hex');
    assert.deepEqual(body, {Ys: [expected]});
    return {states: [{Y: expected, state: 'SPENT'}]};
  };
  return {
    tx,
    commands,
    mintJson,
    setSpent: (n: number) => {
      spent = n;
    },
  };
}

test('review is read-only; cleanup checks the exact proof at the mint, saves intent, seals PIN and verifies zero slots', async () => {
  const c = card();
  const review = await readResetReview(c.tx);
  assert.equal(review.chipId, chipId);
  assert.equal(review.spent, 1);
  assert.ok(c.commands.every(a => ![0x31, 0x40, 0x50, 0x82].includes(a[1]!)));
  let saved = false;
  const result = await cleanupSettledEntries(c.tx, review, {
    pin: '1234',
    random: n => new Array(n).fill(1),
    mintJson: c.mintJson,
    persist: async evidence => {
      assert.equal(c.commands.filter(a => a[1] === 0x40).length, 0);
      assert.equal(evidence.spent, 1);
      saved = true;
    },
  });
  assert.ok(saved);
  assert.equal(result.spent, 0);
  assert.equal(c.commands.filter(a => a[1] === 0x40).length, 1);
  assert.equal(c.commands.filter(a => a[1] === 0x31).length, 1);
});

test('pending settlement, changed card, failed storage and an untrusted PIN key never authenticate or clear', async () => {
  for (const mode of ['pending', 'changed', 'storage', 'pinkey']) {
    const c = card();
    const review = await readResetReview(c.tx);
    let persistCalls = 0;
    const tx = async (a: number[]) => {
      const reply = await c.tx(a);
      if (mode === 'pinkey' && a[1] === 0x44)
        reply[reply.length - 3] = reply[reply.length - 3]! ^ 1;
      return reply;
    };
    await assert.rejects(
      cleanupSettledEntries(
        tx,
        mode === 'changed'
          ? {...review, installationId: '03' + '22'.repeat(32)}
          : review,
        {
          pin: '1234',
          random: n => new Array(n).fill(1),
          mintJson: async (o, p, b) => {
            const v = await c.mintJson(o, p, b);
            return mode === 'pending' && p === '/v1/checkstate'
              ? {
                  states: (v as any).states.map((s: any) => ({
                    ...s,
                    state: 'PENDING',
                  })),
                }
              : v;
          },
          persist: async () => {
            persistCalls++;
            if (mode === 'storage') throw new Error('disk');
          },
        },
      ),
    );
    assert.equal(
      c.commands.filter(a => [0x40, 0x31].includes(a[1]!)).length,
      0,
    );
    if (mode === 'pending' || mode === 'changed') assert.equal(persistCalls, 0);
  }
});

test('a refused PIN is attempted once; no clear command or automatic retry follows', async () => {
  const c = card();
  const review = await readResetReview(c.tx);
  await assert.rejects(
    cleanupSettledEntries(
      async a => (a[1] === 0x40 ? (c.commands.push(a), [0x63, 0xc2]) : c.tx(a)),
      review,
      {
        pin: '1234',
        random: n => new Array(n).fill(1),
        mintJson: c.mintJson,
        persist: async () => {},
      },
    ),
  );
  assert.equal(c.commands.filter(a => a[1] === 0x40).length, 1);
  assert.equal(c.commands.filter(a => a[1] === 0x31).length, 0);
});

test('a lost successful clear reply is recovered by reading zero slots, without another PIN or CLEAR_SPENT', async () => {
  const c = card(),
    review = await readResetReview(c.tx);
  const options = {
    pin: '1234',
    random: (n: number) => new Array(n).fill(1),
    mintJson: c.mintJson,
    persist: async () => {},
  };
  await assert.rejects(
    cleanupSettledEntries(
      async a => {
        const r = await c.tx(a);
        if (a[1] === 0x31) throw new Error('connection lost after commit');
        return r;
      },
      review,
      options,
    ),
  );
  const before = c.commands.length;
  const result = await cleanupSettledEntries(c.tx, review, {
    ...options,
    pin: '',
  });
  assert.equal(result.spent, 0);
  assert.ok(c.commands.slice(before).every(a => ![0x40, 0x31].includes(a[1]!)));
});

test('valid remnants of a saved partial cleanup require a fresh mint audit before clearing', async () => {
  const c = card(2),
    review = await readResetReview(c.tx);
  c.setSpent(1);
  const options = {
    pin: '1234',
    random: (n: number) => new Array(n).fill(1),
    mintJson: c.mintJson,
    persist: async () => {},
  };
  await assert.rejects(cleanupSettledEntries(c.tx, review, options));
  assert.equal(c.commands.filter(a => a[1] === 0x40).length, 0);
  assert.equal(
    (
      await cleanupSettledEntries(c.tx, review, {
        ...options,
        resumePartial: true,
      })
    ).spent,
    0,
  );
});

test('sealed PIN matches the shared applet transcript algorithm without using test secrets on a device', () => {
  const transcript = JSON.parse(
    readFileSync(
      require.resolve('../../../../spec/vectors/transcript.json'),
      'utf8',
    ),
  );
  const pinkey = transcript.find((v: any) => v.kind === 'pinkey');
  assert.ok(pinkey);
  const capturedKey = transcript.find((v: any) => v.kind === 'key').data;
  assert.equal(
    sealResetPin(
      fromHex(pinkey.data),
      capturedKey,
      '5678',
      new Uint8Array(32).fill(1),
    ).length,
    90,
  );
  assert.throws(() =>
    sealResetPin(
      new Array(113).fill(0),
      installationId,
      '1234',
      new Uint8Array(32).fill(1),
    ),
  );
  // The same protocol form used by the wallet: 65-byte public key + 9-byte ciphertext + 16-byte tag.
  const key = fromHex(installationId);
  const digest = sha256(
    Uint8Array.from([
      ...Array.from('CashuCard/pinkey', c => c.charCodeAt(0)),
      ...key,
    ]),
  );
  const nonce = new Array(16).fill(7);
  const body = [
    ...nonce,
    ...key,
    ...schnorr.sign(digest, secret, new Uint8Array(32)),
  ];
  const ephemeral = new Uint8Array(32).fill(1);
  const envelope = sealResetPin(body, installationId, '1234', ephemeral);
  const shared = secp256k1
    .getSharedSecret(secret, Uint8Array.from(envelope.slice(0, 65)))
    .slice(1);
  const head = [...shared, ...envelope.slice(0, 65), ...nonce, 0x40];
  const block = (i: number, more: number[] = []) =>
    sha256(
      Uint8Array.from([
        ...Array.from('CashuCard/seal', c => c.charCodeAt(0)),
        i,
        ...head,
        ...more,
      ]),
    );
  assert.deepEqual(
    envelope.slice(65, 74).map((b, i) => b ^ block(1)[i]!),
    [4, 49, 50, 51, 52, 0, 0, 0, 0],
  );
  assert.deepEqual(
    envelope.slice(74),
    Array.from(block(0, envelope.slice(65, 74)).slice(0, 16)),
  );
});
