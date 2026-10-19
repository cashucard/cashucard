/**
 * The designed app's words (docs/PROVISIONER-APP.md), kept apart from
 * copy.ts, which is the bench screen's. The rule the whole file keeps:
 * every stop says what happened, what the card is now, and what to do, in
 * that order; the word "error" appears on no screen.
 */

export const APP_NAME = 'Cashu card provisioner';

export const SIGNIN = {
  tagline: 'Programs blank cards into Cashu cards. Operators only.',
  button: 'SIGN IN',
  failed: (reason: string) => `Sign-in failed: ${reason}. Try again.`,
};

export const SETUP = {
  title: 'NEW BATCH',
  mint: 'Mint',
  pinBatch: 'One PIN for the batch',
  pinPerCard: 'A PIN per card, generated',
  limits: 'Limits',
  daily: 'Daily limit',
  noPin: 'No-PIN limit',
  count: 'Cards in the batch',
  start: 'START BATCH',
  buildLine: (sha8: string) => `Builds the 2.1 card. Load file ${sha8}…`,
};

export const PHASES: Record<string, string> = {
  probe: 'Checking the card',
  selectIsd: 'Opening the card manager',
  auth: 'Logging in',
  sweep: 'Removing the old install',
  installForLoad: 'Starting the write',
  installOpener: 'Installing the opener',
  installCard: 'Installing the card',
  installTag: 'Installing the tag',
  verify: 'Checking the install',
  done: 'Done',
};

export const LOOP = {
  idle: 'Tap a blank card.',
  program: 'PROGRAM CARD',
  done: (shortId: string) => `Done · …${shortId}`,
  demoPin: (pin: string) => `This card's PIN: ${pin}`,
  of: (done: number, count: number) => `${done} of ${count}`,
};

/** What the demo chooser shows; the strings each state carries live in STOP. */
export const DEMO_STATES = [
  {id: 'ok', name: 'A clean card, programmed'},
  {id: 'pulled', name: 'Card lifted mid-write'},
  {id: 'hasValue', name: 'A card that holds value'},
  {id: 'hasOld', name: 'A card with an empty install'},
  {id: 'oldVersion', name: 'A card with old software'},
  {id: 'wrongKeys', name: 'The card manager refuses the keys'},
  {id: 'noSession', name: 'The phone loses the session'},
] as const;

export type DemoStateId = (typeof DEMO_STATES)[number]['id'];

export const STOP: Record<
  string,
  {what: string; card: string; next: string; action?: string; danger?: boolean}
> = {
  pulled: {
    what: 'The card left the phone early.',
    card: 'Nothing is half-installed — the next tap cleans up and continues.',
    next: 'Tap again when the card is still.',
  },
  hasValue: {
    danger: true,
    what: 'This card holds value.',
    card: 'A programmed card, not blank.',
    next: 'It cannot be programmed here. Put it aside.',
    action: 'PUT ASIDE AND CONTINUE',
  },
  hasOld: {
    what: 'This card has a card install already, empty.',
    card: 'Usable again after it is removed.',
    next: 'Remove it and reuse the card?',
    action: 'REMOVE AND PROGRAM',
  },
  oldVersion: {
    what: "This card's software is old.",
    card: 'An older card install, empty.',
    next: 'The tap upgrades it.',
    action: 'UPGRADE AND PROGRAM',
  },
  wrongKeys: {
    danger: true,
    what: 'The card manager refused the keys.',
    card: 'A failed login counts towards a permanent lock.',
    next: 'Put this card aside and tell the bench lead.',
    action: 'PUT ASIDE',
  },
  noSession: {
    what: 'The phone lost the card session.',
    card: 'Nothing reached the card.',
    next: 'Tap again when ready.',
  },
};

export const SUMMARY = {
  end: 'END BATCH',
  title: 'Batch summary',
  recorded: (id: string) => `…${id}`,
  pending: 'record pending',
  share: 'SHARE RECORD',
  pendingNote: 'Some rows have not reached the record and will retry.',
};

export const SETTINGS = {
  title: 'Settings',
  keyEnv: 'Key environment',
  factory: 'Factory/test',
  issued: 'Issued',
  theme: 'Theme',
  themeSystem: 'System',
  themeDark: 'Dark',
  themeLight: 'Light',
  about: 'About',
  version: (v: string) => `Version ${v}`,
  loadSha: (sha8: string) => `Load file ${sha8}…` ,
  demo: 'Demo mode',
  demoOn:
    'Demo mode drives every state against a fake card. Nothing is written, nothing is signed.',
  demoBanner: 'DEMO — no card, no record',
  bench: 'Bench runs (load test)',
};

export const DEMO_BANNER = 'DEMO — no card, no record';
