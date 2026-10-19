/**
 * The demo card (docs/PROVISIONER-APP.md §Demo mode): a card-side stand-in
 * the app's designed screens run against on a phone, so every state can be
 * reviewed in the hand with no hardware. It speaks enough GlobalPlatform/
 * SCP02 for cardkit's provision() to run end-to-end — the SCP02 handshake
 * is genuine (the cryptograms are computed with cardkit's own DES and key
 * exports), and installs, deletes, probes and reads follow a small installed
 * state. It drives nothing but the demo: production runs go through the NFC
 * session; this transceiver is never offered a real key.
 *
 * Timings model the measured runs in HARDWARE_TEST_REPORT_2026-10-18
 * (iPhone column): ~9.4 s arm-to-done on a clean card.
 */
import {
  CARD_AID,
  FACTORY_KEYS,
  ISD_AID,
  OPENER_AID,
  SPIKE_KEYS,
  TAG_AID,
  TransportError,
  cardCryptogram,
  deriveSessionKeys,
  equal,
  hostCryptogram,
  type KeySet,
  type Transceiver,
} from '../cardkit';

export type Installed = 'none' | 'empty' | 'holdsValue' | 'old';

export interface FakeCardProfile {
  /** What the probe finds at tap time. */
  installed: Installed;
  /** The key set the card answers under; 'spike' makes the host's factory login fail. */
  keys?: 'factory' | 'spike';
  /** During the load, at this block (1-based), the card goes silent. */
  pullAtBlock?: number;
}

const PACKAGE_AID = [0xf0, 0x43, 0x41, 0x53, 0x48, 0x55, 0x43, 0x41, 0x52, 0x44];

const SEQ = [0x00, 0x42];
const CARD_CHALLENGE = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x42];

/** Per-command delays (ms), from the iPhone column of the 2026-10-18 report. */
const DELAYS = {
  plainApdu: 24,
  initUpdate: 50,
  extAuth: 50,
  delete: 325,
  installForLoad: 95,
  loadBlock: 82,
  installOpener: 215,
  installCard: 1280,
  installTag: 230,
  verifyApdu: 25,
};

/** The demo's demo pubkey: 02 ‖ 32 bytes, shape only. */
const DEMO_PUBKEY = [0x02, ...new Array(32).fill(0x11)];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const ok = (data: number[] = []) => [...data, 0x90, 0x00];
// eslint-disable-next-line no-bitwise
const sw = (word: number) => [word >> 8, word & 0xff];

/** True when `aid` appears inside `payload` (INSTALL's payload carries its AIDs length-prefixed). */
function containsAid(payload: number[], aid: readonly number[]): boolean {
  for (let i = 0; i + aid.length <= payload.length; i++) {
    if (aid.every((b, j) => payload[i + j] === b)) {
      return true;
    }
  }
  return false;
}

/**
 * A Transceiver wired to a fake card in `profile`. `speed` scales every
 * delay (0 in tests). The returned `state` reports what the fake believes is
 * on it after the run, for the demo's own assertions and readouts.
 */
export function fakeCard(
  profile: FakeCardProfile,
  {speed = 1}: {speed?: number} = {},
): {tx: Transceiver; installedNow: () => Installed} {
  const active: KeySet = profile.keys === 'spike' ? SPIKE_KEYS : FACTORY_KEYS;
  let installed: Installed = profile.installed;
  let loadStarted = false;
  let blocks = 0;
  let hostChallenge: number[] = [];
  const at = (ms: number) => (speed > 0 ? sleep(ms * speed) : Promise.resolve());

  const versionBytes = () => (installed === 'old' ? [0x02, 0x00] : [0x02, 0x01]);

  const info30 = () => {
    const info = new Array(30).fill(0);
    info[0] = versionBytes()[0];
    info[1] = versionBytes()[1];
    if (installed === 'holdsValue') {
      info[3] = 2; // two unspent pieces: notEmpty() reads it
    }
    return info;
  };

  const freeMemory = () => {
    // FF 21 0A 82 04 <free u32>: 164,024 swept, 109,920 with the set on.
    const free = installed === 'none' || installed === 'old' ? 164024 : 109920;
    /* eslint-disable no-bitwise */
    return [0xff, 0x21, 0x0a, 0x82, 0x04,
      (free >>> 24) & 0xff, (free >>> 16) & 0xff, (free >>> 8) & 0xff,
      free & 0xff];
    /* eslint-enable no-bitwise */
  };

  /** AID from data, session C-MAC stripped when wrapped. */
  const aidFrom = (data: number[], wrapped: boolean) =>
    data.slice(0, wrapped ? data.length - 8 : data.length);

  async function tx(apdu: number[]): Promise<number[]> {
    const ins = apdu[1];
    const wrapped = apdu[0] === 0x84;
    const data = apdu[4] > 0 ? apdu.slice(5, 5 + apdu[4]) : [];

    switch (ins) {
      case 0xa4: { // SELECT (always plain)
        await at(DELAYS.plainApdu);
        const aid = data;
        if (equal(aid, ISD_AID)) {
          return ok();
        }
        if (equal(aid, CARD_AID)) {
          return installed === 'none' ? sw(0x6a82) : ok(versionBytes());
        }
        if (equal(aid, TAG_AID) || equal(aid, OPENER_AID)) {
          return installed === 'none' ? sw(0x6a82) : ok();
        }
        return sw(0x6a82);
      }

      case 0xca: { // GET DATA (FF21): plain, before the session
        await at(DELAYS.plainApdu);
        return ok(freeMemory());
      }

      case 0x01: // the applet's reads, CLA B0: GET_INFO (P1 01), GET_PUBKEY (P1 10)
      case 0x10: {
        await at(DELAYS.plainApdu);
        if (apdu[0] !== 0xb0 || installed === 'none') {
          return sw(0x6d00);
        }
        return ok(apdu[1] === 0x01 ? info30() : DEMO_PUBKEY);
      }

      case 0x50: { // INITIALIZE UPDATE
        await at(DELAYS.initUpdate);
        hostChallenge = data;
        const s = deriveSessionKeys(active, SEQ);
        const crypto = cardCryptogram(s.enc, hostChallenge, SEQ, CARD_CHALLENGE);
        return ok([
          ...new Array(10).fill(0), // diversification data
          0x01, 0x02, // KVN 1, SCP02
          ...SEQ,
          ...CARD_CHALLENGE,
          ...crypto,
        ]);
      }

      case 0x82: { // EXTERNAL AUTHENTICATE (wrapped in its own MAC already)
        await at(DELAYS.extAuth);
        const s = deriveSessionKeys(active, SEQ);
        const host = hostCryptogram(s.enc, SEQ, CARD_CHALLENGE, hostChallenge);
        if (!equal(data.slice(0, 8), host)) {
          return sw(0x6982); // never seen from cardkit: it never sends a guess
        }
        return ok();
      }

      case 0xe4: { // DELETE (in session): newest instance first, then package
        await at(DELAYS.delete);
        const aid = aidFrom(data, wrapped);
        const isOurs =
          equal(aid, TAG_AID) || equal(aid, CARD_AID) ||
          equal(aid, OPENER_AID) || equal(aid, PACKAGE_AID);
        if (!isOurs || installed === 'none') {
          return sw(0x6a88);
        }
        if (equal(aid, PACKAGE_AID)) {
          installed = 'none';
        }
        return ok();
      }

      case 0xe6: { // INSTALL, for-load (P1 02) or and-make-selectable (P1 0C)
        const p1 = apdu[2];
        if (p1 === 0x02) {
          await at(DELAYS.installForLoad);
          loadStarted = true;
          blocks = 0;
          return ok();
        }
        // which instance is arriving decides its cost and the state flips
        const payload = aidFrom(data, wrapped);
        if (containsAid(payload, OPENER_AID)) {
          await at(DELAYS.installOpener);
        } else if (containsAid(payload, TAG_AID)) {
          await at(DELAYS.installTag);
        } else {
          await at(DELAYS.installCard);
        }
        loadStarted = false;
        installed = 'empty';
        return ok();
      }

      case 0xe8: { // LOAD
        blocks += 1;
        if (profile.pullAtBlock === blocks) {
          throw new TransportError('the demo card was lifted away');
        }
        if (!loadStarted) {
          return sw(0x6985);
        }
        await at(DELAYS.loadBlock);
        return ok();
      }

      default:
        await at(DELAYS.plainApdu);
        return sw(0x6d00);
    }
  }

  return {tx, installedNow: () => installed};
}
