<a id="the-provisioner-the-screens-as-designed"></a>

# Provisioner screens and operator flow

Cashu Provisioner installs card software and rotates manager keys on compatible
J3R180 cards. Operators sign in to the configured ops-service, create a batch,
install each card and save the result. Holders complete ownership, PIN,
configuration and funding in a compatible wallet.

This guide describes the current source. The original
ENG-739 screen brief is retained in Git history. Its demo mode, generated batch
PINs, automatic rearming and automatic repair text are superseded by
[D44](DECISIONS.md#d44), [D47](DECISIONS.md#d47), [D105](DECISIONS.md#d105)
and the [recovery contract](PROVISIONER-RECOVERY.md).

<a id="s1-sign-in"></a>

## Sign-in

The operator chooses an ops-service, then enters that service's account name
and password. The service button offers saved addresses and a reviewed custom
HTTPS address. Changing services clears the credential fields. Only public
addresses are saved; unreadable preferences pause sign-in until resolved.
Sign In stays visible above the keyboard. Waiting state shows progress and a
Stop action; late responses after cancellation cannot sign the operator in.
Known failures provide a bounded message and an action.

The service assigns the account's provisioning scope. Signing out keeps saved
work, and signing in with another account opens that account's workspace.
The service and original operator binding still govern who can resume an
unfinished attempt.

## Cards home

Cards is the landing page after sign-in. It labels the operator name with
"Signed in as", links the configured service's ops dashboard and shows
saved work. An unfinished batch shows its mint reference and finished
attempt count. Operators can continue it, view a finished batch's results or
start a new batch when permitted.

Check a Card and Reset a Card for Reuse open directly from Cards. Opening
either screen leaves NFC idle until the operator chooses a read. Check remains
available while a batch is saved. A pending batch or reset prevents a second
reset; the saved reset has its own Continue action. Settings remains available
from the gear or account details.

Stop for now returns here while retaining the journal. End batch asks for
confirmation and obtains a service receipt. An active attempt must be resolved
before ending its batch. A finished batch can be closed from Cards.

Card tools return to the screen that opened them. For example, Cards → Check
a Card → Reset returns through the card check to Cards. Tools opened from
Settings return there, and Settings Back returns to Cards. See
[D121](DECISIONS.md#d121).

See [safe exits](PROVISIONER-SAFE-EXITS.md) for each screen's cancellation and
retention behavior.

## Information icons

Tap an information icon to read a routine explanation, then Close or use
Android Back to return to the same screen. Help panels scroll at larger text
sizes and support screen readers. Sign-in, batch setup, installation, card
checks, reset and Settings use this shared control.

Errors, live progress, disabled-action reasons, card-holding instructions,
destructive confirmations and recovery steps remain visible. Cards' account
help lists the actual API connection separately from the dashboard link;
existing saved work keeps its original connection. See [D122](DECISIONS.md#d122).

<a id="s2-batch-setup"></a>

## Batch setup and review

The installation form asks for a mint reference from the service's list and
a card count. The count supports minus/plus buttons and replacement by typing;
the installation batch range is 1 to 500. Invalid input shows the allowed
range and prevents submission.

Cards → New batch opens the editable review. Start & Read First Card creates
the shown batch and starts its first card run. Create Batch Only saves it for
later. Either action takes two presses from Cards with the displayed defaults.
Operators can change the mint and count before confirming.

A fresh form starts at one card and the service's first mint reference. Approved
choices are remembered per service, operator and provisioning scope. A remembered
mint removed from the service list requires a new choice. The full selected mint
and count remain visible above the final actions. Creating the batch assigns
manager keys for its slots. The mint reference is operator metadata;
holder-wallet setup applies the card's mint, PIN and limits.

Cancel Setup leaves an unsubmitted form. Once batch creation starts, Stop and
Keep Saved Work retains the request ID and body so a lost response can be
reconciled against the service.

Stop during creation also prevents a late first-card read. Lost replies and
restarts return to the saved batch; the app waits for a new explicit card action.
See [D124](DECISIONS.md#d124).

<a id="rules-the-screens-keep-to"></a>
<a id="s3-the-loop"></a>

## Card installation

Start & Read First Card starts the first session after batch confirmation.
Install Next Card starts later sessions. The operator holds one card
still until the run ends. On iOS, the native NFC sheet displays the current
phase; the screen behind it shows the same workflow progress.

The card artwork reveals in proportion to LOAD blocks acknowledged by the
card. The percentage represents confirmed writing progress. Installation,
manager-key rotation and service confirmation have their own completion
states. The accent ring marks a recorded installation.

After an interruption, the current screen retains the last acknowledged fill.
After a restart, the durable stage establishes whether LOAD was verified;
partial block counts are transient. Recovery inspects the same chip against
the original attempt and follows the [recovery contract](PROVISIONER-RECOVERY.md).

A wrong-key authentication can contribute to a permanent card-manager lock.
The workflow stops on refusal and requires the prescribed operator action.
An uncertain or partial installation is retained for reconciliation. Starting
another batch does not clear its chip admission fence.

<a id="s4-batch-summary-and-the-record"></a>

## Results and saved work

The installation screen shows finished attempts, installed/stopped counts,
public chip and attempt identifiers, and the service-confirmation status.
Share Batch Results exports the operator result. Share Support Details exports
bounded recovery identifiers while retaining credentials and key material in
their designated storage.

A pending service record keeps its frozen body and original identity.
A record-only retry submits that evidence. It cannot begin another NFC
installation or key rotation. Stop and Keep Saved Work suspends automatic
record retries until the operator resumes.

## Card status and reset

Check a Card reads public card identity and state, then obtains applicable
service guidance. Its result offers next steps based on the available evidence.
Cancellation ends the owned read or service lookup and suppresses late results.

Reset a Card is a separate flow for eligible cards installed by the same
service. It checks the exact chip and installation key, reviews value and
settlement obligations, and obtains the required authorization before a
destructive tap. The [mobile reset contract](OWNED-CARD-MOBILE-RESET.md)
defines the sequence and recovery requirements.

Completed reset receipts remain available as history. Reopening the reset
screen or choosing Check Another Card starts a fresh inspection. Pending
resets continue their original identity and saved boundaries. A new
installation creates a new spending key, followed by holder-wallet setup.

<a id="identity"></a>
<a id="s5-settings"></a>
<a id="demo-mode"></a>
<a id="not-for-v1"></a>

## Settings and identity

Settings provides provisioning scope and its explanation, card tools, version,
pinned load-file identity and the public
ops dashboard URL. Signing out preserves work and asks for confirmation when
durable work exists.

Change Ops Service signs out before opening the service selector and confirms
when saved work exists. Each service uses its own operator accounts and records.
Returning to the original service/account restores its saved work. Changing a
service leaves those journals and their original device/chip bindings intact.
Unconfirmed legacy registry rows must be saved through their original service
before switching. See [D123](DECISIONS.md#d123).

The app uses the approved Cashu cashew icon, bundled Figtree type and the theme
tokens in `apps/provisioner/src/theme.ts`. Every screen uses the approved
forest-green appearance, including when the phone is in light mode. The
installation screen retains the
approved printed-card artwork and confirmed-progress reveal.

Distributed builds require operator sign-in. Bench tools and recovery-drill
controls remain disabled by release configuration. Hardware test evidence is
recorded in the dated reports linked from [Architecture](ARCHITECTURE.md).
