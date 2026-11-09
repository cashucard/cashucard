/**
 * cardkit as the app ships it: compiled by this app's Babel (the RN preset,
 * as Metro compiles it for the phone) rather than by tsx, and run end to end
 * against the fake card from tools/cardkit's tests, with this app's random
 * source and its plans: as a J3R180 (SCP02) and as a J3R452 (SCP03), whose
 * AES comes from @noble/ciphers through the same compile, blank and as the
 * test card came, with the seller's NDEF tag at the tag's AID.
 */
import {
  CASHU_PLAN,
  FACTORY_KEYS,
  HELLO_PLAN,
  SPIKE_KEYS,
  provision,
  rotateKeys,
} from '../src/cardkit';
import {randomBytes} from '../src/random';
import {FakeCard, SELLER_APPLETS} from '@cashu-card/cardkit/testing';

let t = 0;
const options = () => ({random: randomBytes, now: () => (t += 3)});

test('the smoke test installs the hello applet, hears HELLO and removes it', async () => {
  const card = new FakeCard();
  const r = await provision(card.transceive, HELLO_PLAN, options());
  expect(r.ok).toBe(true);
  expect(card.instances.size + card.packages.size).toBe(0);
});

test('the Cashu card installs in 88 blocks, and a second run without Replace is guarded', async () => {
  const card = new FakeCard();
  const r = await provision(card.transceive, CASHU_PLAN, options());
  expect(r.ok).toBe(true);
  expect(r.blocks).toEqual({at: 88, of: 88});
  expect(card.instanceAids()).toEqual([
    'F04341534855434152444D',
    'F043415348554341524401',
    'D2760000850101',
  ]);
  card.reset();
  const again = await provision(card.transceive, CASHU_PLAN, options());
  expect(again.kind).toBe('guarded');
});

test('the keys go to the spike set and back', async () => {
  const card = new FakeCard();
  expect(
    (await rotateKeys(card.transceive, FACTORY_KEYS, SPIKE_KEYS, options())).ok,
  ).toBe(true);
  expect(
    (await rotateKeys(card.transceive, SPIKE_KEYS, FACTORY_KEYS, options())).ok,
  ).toBe(true);
  expect(card.failedAuths).toBe(0);
});

test('a blank J3R452 that opens SCP03 installs in 88 blocks and rotates to the spike set and back', async () => {
  const card = new FakeCard({scp: 3});
  const r = await provision(card.transceive, CASHU_PLAN, options());
  expect(r.ok).toBe(true);
  expect(r.blocks).toEqual({at: 88, of: 88});
  // the card answered SCP03's 32-byte INITIALIZE UPDATE, not SCP02's 28
  expect(r.apdus.find(a => a.ins === 0x50)?.rlen).toBe(32);
  card.reset();
  const there = await rotateKeys(
    card.transceive,
    FACTORY_KEYS,
    SPIKE_KEYS,
    options(),
  );
  expect(there.ok).toBe(true);
  // AES keys: 88 11 10 entries, 70 bytes of data and the 8-byte C-MAC
  expect(there.apdus.find(a => a.ins === 0xd8)?.lc).toBe(70 + 8);
  card.reset();
  expect(
    (await rotateKeys(card.transceive, SPIKE_KEYS, FACTORY_KEYS, options())).ok,
  ).toBe(true);
  expect(card.failedAuths).toBe(0);
});

test("a J3R452 as the test card came, with the seller's NDEF tag at D2760000850101, stops guarded before any DELETE, as the tap's install runs it", async () => {
  const card = new FakeCard({scp: 3, sellerApplets: true});
  const seller = SELLER_APPLETS.map(a => a.instance);
  expect(card.instanceAids()).toEqual(seller);
  // provisioningTap's install: the factory set, Replace off
  const r = await provision(card.transceive, CASHU_PLAN, {
    ...options(),
    keys: FACTORY_KEYS,
    replace: false,
  });
  expect(r.ok).toBe(false);
  expect(r.kind).toBe('guarded');
  expect(r.phase).toBe('sweep');
  expect(r.reason).toMatch(/D2760000850101/);
  // logged in and read the registry (GET STATUS twice), then nothing more
  expect(r.apdus.map(a => a.ins)).toEqual([
    0xa4, 0xa4, 0xca, 0x50, 0x82, 0xf2, 0xf2,
  ]);
  expect(card.insLog()).not.toContain(0xe4);
  expect(card.instanceAids()).toEqual(seller);
  expect(card.failedAuths).toBe(0);
});
