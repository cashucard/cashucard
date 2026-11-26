/**
 * The designed app's words (docs/PROVISIONER-APP.md), kept apart from
 * copy.ts, which is the bench screen's. The rule the whole file keeps:
 * every stop says what happened, what the card is now, and what to do, in
 * that order; the word "error" appears on no screen.
 */

export const APP_NAME = 'Cashu Card Setup';

export const SPENT_ENTRY_GUIDANCE =
  'Use the holder wallet to check each entry with the mint that issued it, including any test mint. Once all entries have settled, clear them in the wallet and scan the card again.';

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
  /** The last mint cell: opens the write-in field (D180). */
  otherMint: 'Other mint…',
  mintsFailed:
    'The mint list could not be loaded. Retry or enter a batch reference.',
  buildLine: (sha8: string) => `Builds the 3.2 card. Load file ${sha8}…`,
  /** The second line of a discovered mint's cell (D180). */
  mintReviews: (reviews: number, name?: string) =>
    `${reviews} ${reviews === 1 ? 'review' : 'reviews'}${
      name ? ` · ${name}` : ''
    }`,
  checkingMint: 'CHECKING THE MINT…',
  mintProbeFailed:
    'This mint did not pass the check: it must be reachable and issue sats.',
  mintProbeInvalid: 'Enter an https:// mint address with a public host name.',
  mintProbeUnreachable:
    'The mint could not be checked because the service did not answer. Check your connection and retry.',
  retryMintProbe: 'RETRY MINT CHECK',
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

/** The card maker setting (D239). */
export const MAKER_SETTING = {
  title: 'Card maker',
  what: 'The card maker is whoever makes these cards and gives them out.',
  tagWhat:
    'The tag address is the web address a phone opens when it taps one of your cards.',
  published:
    'The card maker publishes this address. Anyone who taps a card can see it, and it is the same on every card you install.',
  scope:
    'Saved on this phone for this ops service. A card keeps the address it was installed with.',
  name: 'Maker name',
  namePlaceholder: 'Your name or company',
  address: 'Tag address',
  addressPlaceholder: 'https://',
  save: 'SAVE CARD MAKER',
  saving: 'SAVING…',
  saved: 'Saved. New cards are installed with this tag address.',
  set: 'SET CARD MAKER',
  notSet: 'Not set',
  fromFile:
    'Filled in from the maker file in this build. No card is installed until you save it on this phone.',
  batchNote:
    'Every card in this batch is installed with this tag address. To change it, open Settings.',
  openBatchNote:
    'Every card in this batch is installed with this tag address. To change it, close this batch first.',
  batchLocked:
    'Close the open batch before you change the tag address. Every card in a batch gets the same tag address.',
  changeTitle: 'Change the card maker?',
  changeNote:
    'Cards you already installed keep their tag address. Cards you install from now on get the new one.',
  change: 'CHANGE CARD MAKER',
  keep: 'KEEP CURRENT MAKER',
};

export const PHYSICAL_READ_BANNER = 'PHYSICAL CARD — read-only';

/** What the install step says when the saved maker's tag address is not the open batch's (D239). */
export const batchMakerDiffers = (batch: {name: string; tagAddress: string}) =>
  `This batch uses another tag address: ${batch.tagAddress} (${batch.name}). No card is installed. Close this batch, or set the card maker back to that address in Settings.`;
