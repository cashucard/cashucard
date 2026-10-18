/**
 * One NFC session: an armed IsoDep request, its transceiver and its teardown
 * (after flash-pos src/services/cashuCardNfc.ts). One at a time; cancelled in
 * `finally`, by the Cancel button, and when the screen unmounts. Its errors
 * are told apart by the NFC library's classes (nfcErrorName): on iOS the class
 * is all an error says.
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
import NfcManager, {NfcError, NfcTech} from 'react-native-nfc-manager';

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

/**
 * The NFC library's error classes by name: every class react-native-nfc-manager
 * 3.17.2 exports but its base. Its iOS side turns each Core NFC code into one
 * of these with no message (src/NfcError.js, buildNfcExceptionIOS), so on iOS
 * the class is all an error says, and String() of it is just "Error". The
 * names are string literals matched with instanceof, because a Release
 * bundle's minifier renames the classes. The base, NfcErrorBase, is what the
 * library throws for everything else, and it carries the native message: every
 * Android error but "cancelled" (UserCancel), and any iOS error string that is
 * not a Core NFC code it knows.
 */
const NFC_ERRORS = [
  [NfcError.UnsupportedFeature, 'UnsupportedFeature'],
  [NfcError.SecurityViolation, 'SecurityViolation'],
  [NfcError.InvalidParameter, 'InvalidParameter'],
  [NfcError.InvalidParameterLength, 'InvalidParameterLength'],
  [NfcError.ParameterOutOfBound, 'ParameterOutOfBound'],
  [NfcError.RadioDisabled, 'RadioDisabled'],
  // a transceive's
  [NfcError.TagConnectionLost, 'TagConnectionLost'],
  [NfcError.RetryExceeded, 'RetryExceeded'],
  [NfcError.TagResponseError, 'TagResponseError'],
  [NfcError.SessionInvalidated, 'SessionInvalidated'],
  [NfcError.TagNotConnected, 'TagNotConnected'],
  [NfcError.PacketTooLong, 'PacketTooLong'],
  // the reader session's
  [NfcError.UserCancel, 'UserCancel'],
  [NfcError.Timeout, 'Timeout'],
  [NfcError.Unexpected, 'Unexpected'],
  [NfcError.SystemBusy, 'SystemBusy'],
  [NfcError.FirstNdefInvalid, 'FirstNdefInvalid'],
  // a tag command's configuration, and the NDEF reader's
  [NfcError.InvalidConfiguration, 'InvalidConfiguration'],
  [NfcError.TagNotWritable, 'TagNotWritable'],
  [NfcError.TagUpdateFailure, 'TagUpdateFailure'],
  [NfcError.TagSizeTooSmall, 'TagSizeTooSmall'],
  [NfcError.ZeroLengthMessage, 'ZeroLengthMessage'],
] as const;

export type NfcErrorName = (typeof NFC_ERRORS)[number][1];

/** The NFC library's name for `error`, or undefined when it is none of the library's classes. */
export function nfcErrorName(error: unknown): NfcErrorName | undefined {
  for (const [type, name] of NFC_ERRORS) {
    if (error instanceof type) {
      return name;
    }
  }
  return undefined;
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
    // cardkit gives a failed transceive's message as the reason the run
    // stopped (TransportError, the readout's `why`). An iOS error has no
    // message, only its class, so it is rethrown under the library's name for
    // it; any other error (Android's carry their messages) is rethrown as is.
    const tx: Transceiver = async apdu => {
      try {
        return Array.from(await NfcManager.isoDepHandler.transceive(apdu));
      } catch (e) {
        const name = nfcErrorName(e);
        throw name ? new Error(name) : e;
      }
    };
    const value = await run(tx);
    stamps.done = now();
    return {value, stamps, meta};
  } finally {
    await cancelCard();
    inFlight = false;
  }
}
