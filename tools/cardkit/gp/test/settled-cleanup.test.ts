import assert from 'node:assert/strict';
import test from 'node:test';
import {schnorr, secp256k1} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha256';
import {readFileSync} from 'node:fs';
import {
  cleanupSettledEntries,
  readResetReview,
  sealResetPin,
  type ResetReview,
} from '../settled-cleanup';
import {fromHex, toHex} from '../bytes';

const {
  cardSecret,
  compressed,
  hashToCurve,
} = require('../../../cardsim/cashu-crypto.cjs');
const chipId = 'cplc-v1:4790d3213041093361205547';
const secret = '01'.padStart(64, '0');
const installationId = toHex(secp256k1.getPublicKey(secret)).toLowerCase();
const mint = 'https://mint.example.test';
/** `owed`: openings of change owed (GET_CHANGE's count on 2.1/2.2, byte 29 on 3.0); `format`: GET_INFO byte 8 and GET_CARD byte 0. */
type Version = readonly [number, number];
const V21: Version = [2, 1],
  V22: Version = [2, 2],
  V30: Version = [3, 0];
const is30 = (v: Version) => v[0] === 3 && v[1] === 0;
function card(
  initialSpent = 1,
  version: Version = V21,
  infoVersion: Version = version,
  {owed = 0, format = 4}: {owed?: number; format?: number} = {},
) {
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
        '9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000',
      );
    } else if (a[1] === 0xa4) {
      data = a.slice(5, -1).at(-1) === 1 && a[5] === 0xf0 ? [...version] : [];
    } else if (a[1] === 1) {
      data = [
        ...infoVersion,
        128,
        0,
        spent,
        128 - spent,
        255,
        1,
        format,
        3,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        ...new Array(12).fill(0),
        is30(infoVersion) && owed ? 1 : 0,
      ];
    } else if (a[1] === 0x10) data = fromHex(installationId);
    else if (a[1] === 0x16) {
      data = new Array(109 + mint.length).fill(0);
      data[0] = format;
      data[1] = 1;
      data[105] = mint.length;
      Array.from(mint, c => c.charCodeAt(0)).forEach((b, i) => {
        data[106 + i] = b;
      });
    } else if (a[1] === 0x14) data = [spent ? 2 : 0, ...new Array(127).fill(0)];
    else if (a[1] === 0x13) data = raw;
    else if (a[1] === 0x19) {
      // GET_CHANGE: a 3.0 card's change owed is read from byte 29, never asked this way
      assert.ok(!is30(version), 'GET_CHANGE sent to a 3.0 card');
      data = [owed, ...new Array(80 * owed).fill(5)];
    } else if (a[1] === 0x44) {
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

test('a 2.2 card (D175) and a 3.0 card are reviewed as a 2.1 card is, and a version this kit does not know stops', async () => {
  for (const version of [V22, V30]) {
    const review = await readResetReview(card(1, version).tx);
    assert.equal(review.chipId, chipId);
    assert.equal(review.spent, 1);
  }
  for (const version of [
    [2, 0],
    [2, 3],
    [2, 4],
    [3, 1],
    [4, 0],
  ] as const) {
    await assert.rejects(() => readResetReview(card(1, version).tx));
  }
});

test('the review says the change owed: GET_INFO byte 29 on a 3.0 card, GET_CHANGE on a 2.1 or 2.2 card', async () => {
  for (const version of [V21, V22, V30]) {
    const name = version.join('.');
    for (const owed of [0, 1]) {
      const c = card(0, version, version, {owed});
      const review = await readResetReview(c.tx);
      assert.equal(review.changeOwed, owed === 1, `${name}, ${owed} owed`);
      assert.equal(review.version, name);
      assert.equal(
        c.commands.some(a => a[1] === 0x19),
        !is30(version),
        'GET_CHANGE is asked only of a 2.1 or 2.2 card',
      );
      assert.ok(c.commands.every(a => ![0x31, 0x40, 0x27].includes(a[1]!)));
    }
  }
});

test("a 3.0 card of two units (format 05) is reviewed; format 05 on a 2.2 card, or a record whose format is not GET_INFO's, stops", async () => {
  const two = await readResetReview(card(0, V30, V30, {format: 5}).tx);
  assert.equal(two.version, '3.0');
  assert.equal(two.unspent, 0);
  await assert.rejects(
    () => readResetReview(card(0, V22, V22, {format: 5}).tx),
    (e: unknown) => (e as {code?: string}).code === 'unsupported-card',
  );
  const c = card(0, V30, V30, {format: 5});
  await assert.rejects(
    () =>
      readResetReview(async a => {
        const r = await c.tx(a);
        if (a[1] === 0x16) r[0] = 4;
        return r;
      }),
    (e: unknown) => (e as {code?: string}).code === 'record-invalid',
  );
});

test('a review saved by cardkit 0.2, with no changeOwed or version, still matches the card it was read from', async () => {
  const c = card();
  const saved: Partial<ResetReview> = await readResetReview(c.tx);
  delete saved.changeOwed;
  delete saved.version;
  const result = await cleanupSettledEntries(c.tx, saved as ResetReview, {
    pin: '1234',
    random: n => new Array(n).fill(1),
    mintJson: c.mintJson,
    persist: async () => {},
  });
  assert.equal(result.spent, 0);
  // a saved review that has them is held to them: a card that now owes change has changed
  const owing = card(1, V22, V22, {owed: 1});
  const before = await readResetReview(card(1, V22, V22).tx);
  assert.equal(before.changeOwed, false);
  await assert.rejects(
    () =>
      cleanupSettledEntries(owing.tx, before, {
        pin: '1234',
        random: n => new Array(n).fill(1),
        mintJson: owing.mintJson,
        persist: async () => {},
      }),
    (e: unknown) => (e as {code?: string}).code === 'card-changed',
  );
  assert.ok(owing.commands.every(a => ![0x31, 0x40].includes(a[1]!)));
});

test("a 3.0 card's spent entries are not cleaned: its secrets name its key for each piece's date, and nothing is sent to the mint or written", async () => {
  const c = card(1, V30);
  const review = await readResetReview(c.tx);
  let asked = false,
    saved = false;
  await assert.rejects(
    () =>
      cleanupSettledEntries(c.tx, review, {
        pin: '1234',
        random: n => new Array(n).fill(1),
        mintJson: async () => {
          asked = true;
          return {};
        },
        persist: async () => {
          saved = true;
        },
      }),
    (e: unknown) => (e as {code?: string}).code === 'unsupported-card',
  );
  assert.ok(!asked && !saved);
  assert.ok(c.commands.every(a => ![0x31, 0x40].includes(a[1]!)));
});

test("GET_INFO's version must be SELECT's, as inspect requires: a 2.1 SELECT with a 2.2 GET_INFO, a 3.0 SELECT with a 2.x GET_INFO, or the reverse of either, stops", async () => {
  for (const [selected, reported] of [
    [V21, V22],
    [V22, V21],
    [V30, [2, 3]],
    [V22, V30],
  ] as const) {
    await assert.rejects(
      () => readResetReview(card(1, selected, reported).tx),
      (e: unknown) => (e as {code?: string}).code === 'unsupported-card',
    );
  }
});

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

test('public review never exports credentials or arbitrary URL suffixes from a card record', async () => {
  const c = card(),
    unsafe = 'https://private-canary@mint.test/?token=private-canary';
  const review = await readResetReview(async a => {
    if (a[1] !== 0x16) return c.tx(a);
    const record = new Array(109 + unsafe.length).fill(0);
    record[0] = 4;
    record[1] = 1;
    record[105] = unsafe.length;
    Array.from(unsafe, c => c.charCodeAt(0)).forEach((b, i) => {
      record[106 + i] = b;
    });
    return [...record, 0x90, 0];
  });
  assert.equal(review.mint, '');
  assert.ok(!JSON.stringify(review).includes('private-canary'));
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
