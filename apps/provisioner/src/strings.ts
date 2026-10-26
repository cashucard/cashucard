/**
 * The designed app's words (docs/PROVISIONER-APP.md), kept apart from
 * copy.ts, which is the bench screen's. The rule the whole file keeps:
 * every stop says what happened, what the card is now, and what to do, in
 * that order; the word "error" appears on no screen.
 */

export const APP_NAME = 'Cashu card provisioner';

export const SIGNIN = {
  tagline: 'Programs blank cards into Cashu cards. Operators only.',
  button: 'Sign in',
  signingIn: 'Signing in…',
  failed: (reason: string) =>
    reason === 'bad-credentials'
      ? 'Check your operator name and password, then try again.'
      : reason === 'login-rate-limited'
      ? 'Too many sign-in attempts. Wait a minute, then try again.'
      : reason === 'the record service cannot be reached'
      ? 'The service could not be reached. Check your connection and try again.'
      : 'Sign-in could not be completed. Try again, or ask your administrator for help.',
  unreachable: 'the record service cannot be reached',
  note: 'Use the operator account provided by your administrator.',
  namePlaceholder: 'Operator name',
  passwordPlaceholder: 'Password',
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
  mintsFailed:
    'The mint list could not be loaded. Retry or enter a batch reference.',
  buildLine: (sha8: string) => `Builds the 2.1 card. Load file ${sha8}…`,
};

export const PHASES: Record<string, string> = {
  probe: 'Checking the card',
  selectIsd: 'Opening the card manager',
  auth: 'Verifying card access',
  sweep: 'Removing the old install',
  installForLoad: 'Starting the write',
  load: 'Writing card software',
  putKey: 'Securing the card',
  reopen: 'Checking card security',
  installOpener: 'Installing the opener',
  installCard: 'Installing the card',
  installTag: 'Installing the tag',
  verify: 'Checking the install',
  done: 'Done',
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
  provisioningScope: 'Provisioning scope',
  accountScope: 'Account scope',
  scopeSignedOut: 'Sign in to view',
  scopeHelpLabel: 'What is provisioning scope?',
  scopeAssigned: 'Assigned to your account by your administrator.',
  scopeExplanation:
    'Saved batches and recovery work must match your account’s scope. Continue them with the original account and service. This value does not read or change a card’s keys. Use Check a card for card status.',
  factory: 'Factory',
  issued: 'Issued',
  about: 'About',
  version: (v: string) => `Version ${v}`,
  loadSha: (sha8: string) => `Load file ${sha8}…`,
  capPin: (sha8: string) => `CAP pin ${sha8}…`,
  bench: 'Bench runs (load test)',
  session: 'Session',
  signOut: 'Sign out',
  signOutSub: 'Signs out without deleting saved batches or resets.',
};

export const PHYSICAL_READ_BANNER = 'PHYSICAL CARD — read-only';
