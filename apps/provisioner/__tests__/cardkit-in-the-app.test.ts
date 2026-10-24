/**
 * cardkit as the app ships it: compiled by this app's Babel (the RN preset,
 * as Metro compiles it for the phone) rather than by tsx, and run end to end
 * against the fake card from tools/cardkit's tests, with this app's random
 * source and its plans.
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
import {FakeCard} from '@cashu-card/cardkit/testing';

let t = 0;
const options = () => ({random: randomBytes, now: () => (t += 3)});

test('the smoke test installs the hello applet, hears HELLO and removes it', async () => {
  const card = new FakeCard();
  const r = await provision(card.transceive, HELLO_PLAN, options());
  expect(r.ok).toBe(true);
  expect(card.instances.size + card.packages.size).toBe(0);
});

test('the Cashu card installs in 82 blocks, and a second run without Replace is guarded', async () => {
  const card = new FakeCard();
  const r = await provision(card.transceive, CASHU_PLAN, options());
  expect(r.ok).toBe(true);
  expect(r.blocks).toEqual({at: 82, of: 82});
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
