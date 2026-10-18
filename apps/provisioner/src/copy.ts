/** The words on the screen and in iOS's NFC sheet. */
import {
  CASHU_PLAN,
  mayLeaveGuardedApplet,
  type RunEvent,
  type RunResult,
} from './cardkit';
import {locksOut} from './readout';
import {nfcErrorName} from './session';

export type Action = 'hello' | 'cashu' | 'rotate';

export const HOLD =
  'Hold the card against the back of the phone. Keep still until it finishes.';

export const ACTION_NAMES: Record<Action, string> = {
  hello: 'Smoke test (hello applet)',
  cashu: 'Install Cashu card',
  rotate: 'Rotate keys and back',
};

const PHASE_LABELS: Record<string, string> = {
  probe: 'Checking the card',
  selectIsd: 'Opening the card manager',
  auth: 'Logging in',
  sweep: 'Removing the old install',
  installForLoad: 'Starting the load',
  load: 'Loading',
  installOpener: 'Installing opener',
  installCard: 'Installing card',
  installTag: 'Installing tag',
  verify: 'Checking the install',
  putKey: 'Writing the new keys',
  reopen: 'Logging in with the new keys',
  done: 'Done',
};

/** What to show for an event, or null for one that changes nothing on screen. */
export function labelFor(action: Action, event: RunEvent): string | null {
  if (event.type === 'block') {
    return `Loading ${event.index} of ${event.of}`;
  }
  if (event.type === 'phase') {
    if (action === 'hello' && event.phase === 'installCard') {
      return 'Installing the hello applet';
    }
    return PHASE_LABELS[event.phase] ?? event.phase;
  }
  return null;
}

const INS_NAMES: Record<number, string> = {
  0x01: 'GET_INFO',
  0x10: 'GET_PUBKEY',
  0x50: 'INITIALIZE UPDATE',
  0x82: 'EXTERNAL AUTHENTICATE',
  0xa4: 'SELECT',
  0xca: 'GET DATA',
  0xd8: 'PUT KEY',
  0xe4: 'DELETE',
  0xe6: 'INSTALL',
  0xe8: 'LOAD',
};

const STOPPED = ' The app is stopped: restart it before trying again.';

/**
 * One line for how a run ended. `progress` is the last label shown before it
 * ended; `replace` is whether Replace was on for the run.
 */
export function describeResult(
  action: Action,
  result: RunResult<string>,
  progress: string,
  cancelled = false,
  replace = false,
): string {
  if (result.ok) {
    if (action === 'hello') {
      return 'Smoke test passed: the hello applet loaded, answered HELLO and was removed.';
    }
    if (action === 'cashu') {
      return 'Installed: the card applet answers 02 01, and the tag answers.';
    }
    return 'Keys rotated to the spike set and back to the factory set.';
  }
  const during = progress || 'the run';
  switch (result.kind) {
    case 'pulled': {
      const how = cancelled ? 'Cancelled' : 'Card moved';
      if (action === 'rotate') {
        return `${how} during ${during}. Tap again; the app finds which keys the card is on first.`;
      }
      // once the card applet's INSTALL has gone out, the next run finds it and
      // removes it only with Replace on (it stops `guarded` otherwise)
      const again =
        action === 'cashu' &&
        !replace &&
        mayLeaveGuardedApplet(CASHU_PLAN, result.phase)
          ? 'Turn on Replace (spare card only) and tap again'
          : 'Tap again';
      return `${how} during ${during}. ${again}; the partial install is removed first.`;
    }
    case 'wrongKeys':
      return (
        'The card did not prove the keys. Nothing more was sent.' + STOPPED
      );
    case 'guarded':
      return `Stopped before touching the card: ${result.reason}.`;
    default: {
      const what =
        result.ins !== undefined
          ? INS_NAMES[result.ins] ??
            `INS ${result.ins.toString(16).toUpperCase()}`
          : 'a command';
      const sw =
        result.sw !== undefined
          ? result.sw.toString(16).toUpperCase().padStart(4, '0')
          : 'an error';
      return `The card refused ${what} with ${sw} during ${during}. Nothing more was sent.${
        locksOut(result) ? STOPPED : ''
      }`;
    }
  }
}

/**
 * One line for a session that never reached the card (cancelled, NFC off, not
 * supported, timed out). The NFC library's errors are known by their classes
 * (nfcErrorName), never by constructor.name, which a Release bundle's minifier
 * renames, nor by their message, which iOS's leave empty: 'No card session:
 * Timeout.', not 'No card session: Error.'.
 */
export function describeSessionError(error: unknown): string {
  const name = nfcErrorName(error);
  if (name === 'UserCancel') {
    return 'Cancelled.';
  }
  if (name === 'RadioDisabled') {
    return 'NFC is off: turn it on in Settings.';
  }
  const message =
    name ??
    (error instanceof Error && error.message ? error.message : String(error));
  return `No card session: ${message || 'unknown error'}.`;
}
