/**
 * One NFC session: an armed IsoDep request, its transceiver and its teardown
 * (after flash-pos src/services/cashuCardNfc.ts). One at a time; cancelled in
 * `finally`, by the Cancel button, and when the screen unmounts.
 *
 * Nothing here watches AppState, as neither reference session does. Android
 * delivers the tag through onNewIntent (nfc-manager's default foreground
 * dispatch), which it brackets with onPause and onResume, so AppState goes
 * 'background' and back to 'active' on every tap; iOS reports 'inactive'
 * while its NFC sheet covers the app. A cancel on either would close the
 * session the tap has just opened. When the app does leave the foreground,
 * iOS invalidates its reader session itself and nfc-manager stops Android's
 * dispatch in onHostPause.
 */
import {Platform} from 'react-native';
import NfcManager, {NfcTech} from 'react-native-nfc-manager';

import type {Transceiver} from './cardkit';

/**
 * Android's IsoDep timeout for one APDU. The default, 618 ms, is shorter than
 * the last LOAD block (about 730 ms on a reader, more at a phone's field
 * strength) and than a mute INSTALL takes to give up (about 7 s), and Android
 * reports it as TagLost, like a card that moved.
 */
export const ANDROID_TIMEOUT_MS = 15000;

/** When the session was armed, when the card connected, when the run ended (ms). */
export interface Stamps {
  arm: number;
  connect?: number;
  done?: number;
}

export interface SessionMeta {
  platform: string;
  os: string;
  /** What Android reports after setTimeout(15000): it may clamp it. Null when it would not say. */
  androidTimeoutMs?: number | null;
  /** Android's largest transceive, in bytes. */
  maxTransceive?: number | null;
}

let inFlight = false;

/** Ends any session; never throws (cancelling nothing rejects, and that is fine). */
export async function cancelCard(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // no session to cancel
  }
}

/** The text in iOS's NFC sheet; fire and forget, a no-op on Android. */
export function setCardMessage(message: string): void {
  if (Platform.OS !== 'ios') {
    return;
  }
  try {
    NfcManager.setAlertMessageIOS(message).catch(() => undefined);
  } catch {
    // the session is gone
  }
}

/**
 * Arms a session, waits for the card, raises Android's timeout, and runs `run`
 * with a transceiver to the card. The session is always torn down.
 */
export async function withCard<T>(
  alertMessage: string,
  run: (tx: Transceiver) => Promise<T>,
  now: () => number = Date.now,
): Promise<{value: T; stamps: Stamps; meta: SessionMeta}> {
  if (inFlight) {
    throw new Error('a run is already going');
  }
  inFlight = true;
  const stamps: Stamps = {arm: now()};
  const meta: SessionMeta = {
    platform: Platform.OS,
    os: String(Platform.Version),
  };
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(NfcTech.IsoDep, {alertMessage});
    stamps.connect = now();
    if (Platform.OS === 'android') {
      try {
        await NfcManager.setTimeout(ANDROID_TIMEOUT_MS);
        meta.androidTimeoutMs = (await NfcManager.getTimeout()) ?? null;
      } catch {
        meta.androidTimeoutMs = null;
      }
      try {
        meta.maxTransceive = await NfcManager.getMaxTransceiveLength();
      } catch {
        meta.maxTransceive = null;
      }
    }
    const tx: Transceiver = async apdu =>
      Array.from(await NfcManager.isoDepHandler.transceive(apdu));
    const value = await run(tx);
    stamps.done = now();
    return {value, stamps, meta};
  } finally {
    await cancelCard();
    inFlight = false;
  }
}
