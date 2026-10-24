/** The screen's words for each way a run can end. */
import {NfcError} from 'react-native-nfc-manager';

import {CARD_AID, CASHU_PLAN, provision, toHex} from '../src/cardkit';
import {
  HOLD,
  describeResult,
  describeSessionError,
  describeShareFailure,
  labelFor,
} from '../src/copy';
import {randomBytes} from '../src/random';
import {FakeCard, pullAt} from '@cashu-card/cardkit/testing';

const result = (extra: object) => ({
  ok: false,
  phase: 'load',
  timings: [],
  apdus: [],
  ...extra,
});

test('says to hold the card still', () => {
  expect(HOLD).toBe(
    'Hold the card against the back of the phone. Keep still until it finishes.',
  );
});

test('counts the LOAD blocks and names the phases', () => {
  expect(labelFor('cashu', {type: 'block', index: 37, of: 82})).toBe(
    'Loading 37 of 82',
  );
  expect(labelFor('cashu', {type: 'phase', phase: 'installCard'})).toBe(
    'Installing card',
  );
  expect(labelFor('hello', {type: 'phase', phase: 'installCard'})).toBe(
    'Installing the hello applet',
  );
  expect(
    labelFor('cashu', {
      type: 'apdu',
      record: {phase: 'load', ins: 0xe8, lc: 255, ms: 5},
    }),
  ).toBeNull();
});

test('tells the holder to tap again after the card moved', () => {
  expect(
    describeResult('cashu', result({kind: 'pulled'}), 'Loading 37 of 82'),
  ).toBe(
    'Card moved during Loading 37 of 82. Tap again; the partial install is removed first.',
  );
  expect(
    describeResult(
      'rotate',
      result({kind: 'pulled', phase: 'putKey'}),
      'Writing the new keys',
    ),
  ).toContain('finds which keys the card is on first');
});

test('says to turn on Replace when the card applet may be on the card already, and only then', () => {
  const phases: [string, string][] = [
    ['installCard', 'Installing card'],
    ['installTag', 'Installing tag'],
    ['verify', 'Checking the install'],
  ];
  for (const [phase, progress] of phases) {
    const pulled = result({kind: 'pulled', phase});
    expect(describeResult('cashu', pulled, progress)).toBe(
      `Card moved during ${progress}. Turn on Replace (spare card only) and tap again; the partial install is removed first.`,
    );
    expect(describeResult('cashu', pulled, progress, true)).toBe(
      `Cancelled during ${progress}. Turn on Replace (spare card only) and tap again; the partial install is removed first.`,
    );
    // Replace was on for the run, and stays on: tapping again is all it takes
    expect(describeResult('cashu', pulled, progress, false, true)).toBe(
      `Card moved during ${progress}. Tap again; the partial install is removed first.`,
    );
  }
  // before the card applet's INSTALL nothing needs Replace, nor does the hello
  // applet, which no probe guards
  expect(
    describeResult(
      'cashu',
      result({kind: 'pulled', phase: 'installOpener'}),
      'Installing opener',
    ),
  ).toBe(
    'Card moved during Installing opener. Tap again; the partial install is removed first.',
  );
  expect(
    describeResult(
      'hello',
      result({kind: 'pulled', phase: 'installCard'}),
      'Installing the hello applet',
    ),
  ).toBe(
    'Card moved during Installing the hello applet. Tap again; the partial install is removed first.',
  );
});

test("is right about the next tap when the card applet's INSTALL lands and its reply is lost", async () => {
  let t = 0;
  const options = (replace: boolean) => ({
    random: randomBytes,
    now: () => (t += 3),
    replace,
  });
  // where the card applet's INSTALL falls in a clean run
  const clean = new FakeCard();
  expect(
    (await provision(clean.transceive, CASHU_PLAN, options(false))).ok,
  ).toBe(true);
  const installCard = clean.log.findIndex(
    a =>
      a[1] === 0xe6 &&
      a[2] === 0x0c &&
      toHex(a.slice(17, 28)) === toHex(CARD_AID),
  );
  expect(installCard).toBeGreaterThan(0);
  // the drill: lift at Installing card, after the card took it, Replace off
  const card = new FakeCard();
  const pull = pullAt(card, installCard, 'after');
  const torn = await provision(pull.tx, CASHU_PLAN, options(false));
  expect([torn.kind, torn.phase]).toEqual(['pulled', 'installCard']);
  expect(describeResult('cashu', torn, 'Installing card')).toBe(
    'Card moved during Installing card. Turn on Replace (spare card only) and tap again; the partial install is removed first.',
  );
  // as it says: without Replace the next tap stops, with it the install goes on
  card.reset();
  const off = await provision(card.transceive, CASHU_PLAN, options(false));
  expect(off.kind).toBe('guarded');
  card.reset();
  const on = await provision(card.transceive, CASHU_PLAN, options(true));
  expect(on.ok).toBe(true);
});

test('says Cancelled, not Card moved, when the Cancel button ended the run', () => {
  expect(
    describeResult('cashu', result({kind: 'pulled'}), 'Installing card', true),
  ).toBe(
    'Cancelled during Installing card. Tap again; the partial install is removed first.',
  );
});

test('stops the app for wrong keys and a refused login, and not for a refused INSTALL', () => {
  expect(
    describeResult(
      'cashu',
      result({kind: 'wrongKeys', phase: 'auth'}),
      'Logging in',
    ),
  ).toContain('restart it');
  expect(
    describeResult(
      'cashu',
      result({kind: 'refused', ins: 0x82, sw: 0x6300, phase: 'auth'}),
      'Logging in',
    ),
  ).toBe(
    'The card refused EXTERNAL AUTHENTICATE with 6300 during Logging in. Nothing more was sent. The app is stopped: restart it before trying again.',
  );
  expect(
    describeResult(
      'cashu',
      result({kind: 'refused', ins: 0xe6, sw: 0x6f00, phase: 'installCard'}),
      'Installing card',
    ),
  ).toBe(
    'The card refused INSTALL with 6F00 during Installing card. Nothing more was sent.',
  );
});

test("passes on a guard's reason, and says what each success means", () => {
  expect(
    describeResult(
      'cashu',
      result({
        kind: 'guarded',
        reason: 'the card applet is installed and it has an owner',
      }),
      '',
    ),
  ).toBe(
    'Stopped before touching the card: the card applet is installed and it has an owner.',
  );
  expect(
    describeResult('hello', {...result({}), ok: true, phase: 'done'}, 'Done'),
  ).toContain('answered HELLO');
  expect(
    describeResult('cashu', {...result({}), ok: true, phase: 'done'}, 'Done'),
  ).toContain('02 01');
});

test("names a session that never reached the card, by the NFC library's own error classes", () => {
  expect(describeSessionError(new NfcError.UserCancel())).toBe('Cancelled.');
  expect(describeSessionError(new NfcError.RadioDisabled())).toBe(
    'NFC is off: turn it on in Settings.',
  );
  expect(describeSessionError(new Error('boom'))).toBe(
    'No card session: boom.',
  );
});

test('names every other NFC error by its class, which is all an iOS error carries', () => {
  // nfc-manager's iOS side throws each Core NFC code as one of these with no
  // message (NfcError.js, buildNfcExceptionIOS): String() of it is "Error"
  expect(String(new NfcError.Timeout())).toBe('Error');
  expect(describeSessionError(new NfcError.Timeout())).toBe(
    'No card session: Timeout.',
  );
  expect(describeSessionError(new NfcError.SecurityViolation())).toBe(
    'No card session: SecurityViolation.',
  );
  expect(describeSessionError(new NfcError.UnsupportedFeature())).toBe(
    'No card session: UnsupportedFeature.',
  );
  expect(describeSessionError(new NfcError.SystemBusy())).toBe(
    'No card session: SystemBusy.',
  );
  // under a Release bundle's names as well
  const Renamed = {o: class extends NfcError.Timeout {}}.o;
  expect(Renamed.name).not.toBe('Timeout');
  expect(describeSessionError(new Renamed())).toBe('No card session: Timeout.');
  // the library's base, which is what Android throws, keeps its message
  expect(
    describeSessionError(new NfcError.NfcErrorBase('no nfc support')),
  ).toBe('No card session: no nfc support.');
});

test('knows those classes under the names a Release bundle gives them, and not by a name alone', () => {
  // Metro's minifier renames classes: the phone throws the library's class
  // under another name
  const Renamed = {e: class extends NfcError.UserCancel {}}.e;
  expect(Renamed.name).not.toBe('UserCancel');
  expect(describeSessionError(new Renamed())).toBe('Cancelled.');
  const RenamedOff = {t: class extends NfcError.RadioDisabled {}}.t;
  expect(RenamedOff.name).not.toBe('RadioDisabled');
  expect(describeSessionError(new RenamedOff())).toBe(
    'NFC is off: turn it on in Settings.',
  );
  // and an error that only shares the name is not the library's
  class UserCancel extends Error {}
  expect(describeSessionError(new UserCancel())).toBe(
    'No card session: Error.',
  );
});

test('a failed Share says so on the status line and names the copy path', () => {
  expect(describeShareFailure(new Error('no activity'))).toBe(
    'Share failed: no activity. Long-press the readout to copy it.',
  );
  expect(describeShareFailure(new Error(''))).toBe(
    'Share failed: unknown error. Long-press the readout to copy it.',
  );
});
