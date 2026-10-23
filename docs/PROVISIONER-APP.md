# The provisioner: the screens, as designed

Build 7 removes the historical demo mode described below. The current app
requires operator sign-in and uses the durable provisioning/recovery flow;
there is no fake-card chooser or sign-in bypass. See [D105](DECISIONS.md#d105).

What each screen is for, what is on it, and its states — the designer's brief
before the screens exist (ENG-739; the pattern is the one
[`FOXY-CARD-SCREENS.md`](FOXY-CARD-SCREENS.md) set for the card wallet: this
text first, the screens second, and where the two differ the app is right after
a review on the phone).

The app programs blank J3R180s into Cashu cards, one tap each, in batches. Its
operator is standing up at a bench or a desk with a pile of cards; the tap is in
the other hand. Everything below is in service of that loop: fast, honest about
what happened, impossible to misread from a glance.

The current delivery gates are in
[`OPS-WORKERS-PLAN.md`](OPS-WORKERS-PLAN.md): operator provisioning first,
durable recovery of interrupted attempts and pending records, then consumer
provisioning after identity and per-card authorization are enforced.
The operator's durable attempt and interrupted-install behavior are defined in
[`PROVISIONER-RECOVERY.md`](PROVISIONER-RECOVERY.md); this contract precedes
enabling the real batch loop.

The numbers the design lives with (from
[`HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md`](HARDWARE_TEST_REPORT_2026-10-18.j3r180-gp-nfc.md)):
an install takes ~9 s on an iPhone and ~13 s on a Pixel from arm to done, of
which the 82 LOAD blocks are ~6–7 s in the middle; the rest is fast. The card
must stay still the whole time. After field loss, the same card must be
inspected against its saved attempt. A complete new installation can be
adopted; an absent, partial or unchanged old installation stops for operator
reconciliation rather than an automatic repair sweep. See
[the recovery contract](PROVISIONER-RECOVERY.md). A failed card-manager login
counts towards a lock that is for good.

## Rules the screens keep to

- **One screen carries the loop.** Arm, hold-still progress, done, next card:
  a batch never leaves it. The operator's eyes are on the cards; the screen's
  job while running is one glanceable figure and a phase line, and its job at
  the ends is a word and a haptic.
- **Progress is honest.** The phase name and, while the load writes, its
  percent (`Writing 57%`) come from LOAD blocks acknowledged by the card,
  never a timer. The card artwork reveals in the same proportion. The bench
  screen keeps raw block counts. A full card image means LOAD finished; the
  screen reports installation, key rotation, and record confirmation
  separately before calling the attempt complete.
- **Batch size is easy to adjust.** The count has step buttons and selects its
  value on focus. Empty or out-of-range input shows the supported range and
  cannot create a batch.
- **The button that commits says what it does** — `PROGRAM CARD`, `START
  BATCH` — and is grey until it can be pressed. A way back is at the top left;
  there is no CANCEL at the bottom except the in-tap Cancel on the loop screen
  while a run is armed.
- **The tap sheet is the platform's.** iOS draws its own NFC sheet; one line of
  it is ours and changes with the phase. Our screen behind it says the same
  thing in the same words.
- **Every stop says three things, in this order:** what happened, what the card
  is now, what to do. The word "error" appears on no screen.
- **The permanent words are short.** Where a wrong-keys lock is in reach the
  screen stops thumbs before the tap: it says locked is for good, in one line,
  and what makes it happen.
- **Done has a haptic and a number.** The counter is the reward and the audit;
  failure pauses the loop, success never does.

## Identity

- The screen name is **Cashu card provisioner** — the repo's neutral name
  (D19); no brand owns it and a brand can skin it.
- The palette is Foxy's, as tokens in `apps/provisioner/src/theme.ts`, both
  themes, following the phone: dark — background `#050505`, card `#1C1C1E`,
  ink `#FFFFFF`; light — background `#FAFAF8`, card `#F7F7F5`, ink `#0B0B0B`.
  Accent green `#3AB54A`, danger `#E5484D` dark / `#D13438` light. The
  success state of the loop screen is the accent; nothing else is.
- Type: Figtree, bundled with the app; numbers in progress in a tabular face
  (`tabular-nums` or the system's mono fallback).
- The approved printed-card artwork is the loop's single figure. Its muted
  state and left-to-right LOAD reveal keep progress legible at arm's length;
  an interrupted run retains its last acknowledged fill on the current screen.
  After a restart, saved installation stages establish only whether LOAD was
  verified, not a partial block count. The accent ring is reserved for a
  recorded installation.

## S1. Sign-in

States: signed out / signing in / failed.

- Signed out: the wordmark `Cashu card provisioner`, one line of what it is
  for (`Programs blank cards into Cashu cards. Operators only.`), and
  `SIGN IN`. Until the ops service lands (Phase 3) the button admits any
  operator build with a wizard word and says so on the next screen's status
  line; the design does not show the stub any other surface.
- Failed: one line under the button — `Sign-in failed: <the service's reason>.
  Try again.` (From the service, never improvised.)

## S2. Batch setup

Reached from sign-in. `NEW BATCH`, then:

- **Mint**: a list of the mints the ops service serves, one per row with its
  URL drawn small. Choosing nothing leaves the row empty and START grey.
- **PIN**: a choice, words in full — `One PIN for the batch` (typed here, 4–8)
  or `A PIN per card, generated` (each shown once, at its success, and written
  to the batch record on the service). No `No PIN` choice in v1 of this app;
  holder apps own ownerless setup.
- **Limits**: the daily limit and the no-PIN limit, amounts typed dollars
  first and sats under, in the wallet apps' own format.
- **Count**: the batch size, adjusted with step buttons or replaced directly
  by typing; 1 to 100,000 cards.
- `START BATCH` at the bottom, grey until the four are set. Under it the load
  set's identity: `Builds the 2.1 card. Load file fe7d8ac3…` — the sha the app
  pins, so an operator can see before the first tap which card software the
  batch makes.

## S3. The loop

The batch screen. One look tells: batch name small at the top, then the number
done of the count (`12 of 200`), then the middle of the screen for the card,
then the one action at the bottom.

Idle (between cards): the card figure in outline and `Tap a blank card.` at
the center; the action reads `PROGRAM CARD` and pressing it arms the run (on
iOS the platform's sheet comes up; its line is ours, see below). Success
auto-rearms: after a done the loop is listening for the next card without a
press, and the counter is the only change (12 of 200 becomes 13 of 200).

Running: the figure fills across the run; under it the phase line, in these
words and only these:

- `Checking the card` (probe)
- `Opening the card manager` (the ISD)
- `Logging in`
- `Removing the old install` (sweep — only on a partial or replaced state)
- `Writing 45%` (acknowledged LOAD blocks divided by this run's block count)
- `Installing the card` (the three instantiations)
- `Checking the install`

…and the same words, first-person-shortened where Apple crowds them, on the
iOS sheet's line. Estimates are never shown; the measured 9–13 s vary with the
phone and the card's history and nobody does arithmetic while holding a card.
An interrupted run keeps the last acknowledged fill while saved work is
reviewed on the current screen. Starting another card resets it to the muted
state.

Done: the figure snaps solid in the accent, the haptic fires, the counter
moves, the line under the counter reads the card's short id (the last bytes
of its applet public key — the evidence a registry row names) — `Done · …9c2f`.
If the batch PIN policy is per-card generated, the done state adds one line,
the card's PIN, kept on screen until the next tap starts (the only place it
ever appears).

Stopped (the run kinds, each with its card-state line and the next action):

- **Pulled** (`The card left the phone early.` → `Nothing is half-installed —
  the next tap cleans up and continues.` → the loop re-arms; this is the
  expected move for a shifted card, so it does not flash danger.)
- **Refused, holds value** — the one screen that stops a thumb cold. Danger
  stripe: `This card holds value.` → `A programmed card, not blank: <n> sats
  visible at <mint>.` → `It cannot be programmed here. Put it aside.
  [PUT ASIDE AND CONTINUE]` Programs nothing, touches nothing.
- **Refused, not blank, empty** (swept 2.1 install present): `This card has a
  card install already, empty.` → `Remove it and reuse the card?` →
  `[REMOVE AND PROGRAM]` / `PUT ASIDE`. (The Replace decision is a per-card
  operator choice, never a batch default.)
- **Old version** (answers `02 00` or below): like refused-empty but the words
  say the card's software is old and the tap upgrades it.
- **Wrong keys**: `The card manager refused the keys.` → `A failed login
  counts towards a permanent lock.` → `Put this card aside and tell the
  bench lead. [PUT ASIDE]`  …and the app will not arm again on any card until
  acknowledged — wrong keys against the next card compound the risk.
- **NFC/session failures** (phone-side): `The phone lost the card: <the
  library's reason>.` → `Nothing is half-installed. Tap again when ready.`

## S4. Batch summary and the record

`END BATCH` from the loop (a pause first: the loop disarms while the summary
is up). The count done, the count stopped and why (one line each), and for
every card the row the service recorded: its short id, the batch, the load
sha, the time. `SHARE RECORD` sends it as text (the share path that surfaced
its own failure after the spike). A card that installed but failed the
registry write carries a `record pending` row here and a retry — that retry
is defined, not improvised: pending rows re-post until the service answers,
and ending a batch with pending rows says so plainly.

## S5. Settings

- **Key environment**: two shown words only ever — `Factory/test` and
  `Issued`. What the screen never allows is both at once, and the loop
  screen's header always shows which the batch is on. (Real keys arrive with
  the ops service: Phase 3's key-issuance contract, and this screen is where
  a signed-in operator's environment is visible.)
- **Theme**: System / Dark / Light.
- **About**: the app's version, the pinned load-file sha256, the spec vectors'
  cardkit version.
- **Demo mode**: a switch, and when on, a persistent banner on every screen so
  a demo is never mistaken for a batch.

## Demo mode

How the design is reviewed on a phone before the service exists: a switch in
Settings → Demo mode. On, every screen runs, and the card side is cardkit's
fake card driving timed fake runs — the success path in the real cadence
(~10 s with the phase line and block counts), and from a chooser, each stop:
pulled, holds-value, refused-empty, old-version, wrong-keys, session failure,
then force-quit with the loop armed. Demo mode writes nothing and signs
nothing; its batches say DEMO on every row.

Design review = walking that chooser on both phones. Sign-off on the device,
not on mockups.

## Not for v1

- Holder/owner flows (the wallet apps own them, per the plan).
- A Foxy skin: the theme layer carries the tokens; skinning is a set of
  values, unbuilt until asked.
- In-app updates of old cards as a batch policy (2.2 exists per the plan's
  Phase 6; the loop treats update-per-card as above until then).
- The service-side screens: key issuance, mint registry, operator management —
  they land with Phase 3 and are theirs to design.
