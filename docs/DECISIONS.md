# Design decisions

Each entry records a call that was made, what was rejected, and why. If you are
about to change one of these, read the entry and its alternatives first.

Decision anchors (`#d1`, `#d2`, and later entries) are stable; other docs link
to them. D15 and D16 are superseded by the 2.0 merge ([D18](#d18)) and kept for
the record.

---

## <a id="d1"></a>D1: Cashu ecash payment model

**Rejected:** NTAG 424 DNA + AES-128 CMAC, per **FIP-04 (Implemented)**.

A BoltCard authenticates *who is tapping* against a server-side balance. It
cannot work offline, because the terminal must reach the server to learn whether
the balance exists.

Cashu proofs are bearer tokens: valid because they carry the mint's blind
signature, verifiable by arithmetic rather than by asking a server. That is what
buys offline payment, and offline payment is the requirement that started the
project ([`VISION.md`](VISION.md)).

**Cost accepted:** a far more demanding chip (secp256k1 rather than AES), higher
unit cost (~$5 vs ~$1), and the offline double-spend exposure in
[`SECURITY-MODEL.md`](SECURITY-MODEL.md). `btcpayserver-flash-plugin` is being
decommissioned as a result (ENG-176).

---

## <a id="d2"></a>D2: Bearer-card identity model

**Rejected:** name, card number, PIN-on-spend by default, remote freeze, recovery.

The original bearer profile excluded these account-management features to
keep payment authority with the physical card. Adding them would introduce
identity, recovery and custody obligations.

This is why the physical card says **"BEARER CARD"** rather than leaving the
name field blank: it describes the bearer model
([`flash-card-assets`](https://github.com/lnflash/flash-card-assets)).

**Consequence to accept:** lost card = lost funds, and the card says so in plain
language on the back. That copy is deliberate and is not to be softened without
sign-off.

---

## <a id="d3"></a>D3: Host-side BDHKE (historical)

**Rejected:** blinding/unblinding on-card.

JavaCard has no big integers, no `long`, and no garbage collector. Implementing
blinding on-card would multiply applet size and attack surface to protect
something that is not secret, and the host must know the blinding factor `r`
anyway in order to unblind.

The card holds the one thing that genuinely cannot live elsewhere: a private key
that has never existed outside the secure element. Everything else belongs on
the host.

---

## <a id="d4"></a>D4: Proofs are P2PK-locked to the card key (NUT-11)

Without this, reading a card's memory would be equivalent to stealing its
balance: the proofs would be spendable by whoever copied them.

With [NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md), a proof is
locked to a public key whose private half exists only inside the chip. A
passive dump yields proofs that cannot be redeemed.

P2PK binds redemption to the card spending key. It is also why the provisioning
host must know the card's public key *before* minting: the lock is applied at
issuance.

---

## <a id="d5"></a>D5: On-chip spending-key custody

**Rejected:** BIP-39 seed derivation for the card key.

A recoverable card is a card whose funds exist somewhere other than the card,
which contradicts D2. It also means the recovery secret becomes the real
credential and the chip stops being the security boundary.

**Alternative considered:**
[PR #4](https://github.com/cashucard/javacard/pull/4) proposed using NUT-11's
existing `refund` + `locktime` tags so a lost card's proofs can be swept to a
recovery key after a timeout while retaining the on-chip spending key. It was
closed unmerged on 2026-10-02, because it was written before v0.2.0 and no
longer applies, and because of a specific flaw: in NUT-11, once locktime passes
the *card's own key stops being valid*, so a short locktime silently converts
the card into a brick; and the card cannot enforce a timeout because JavaCard
has no clock, so a merchant would accept a tap that the mint later refuses.

Since 0.3, a card whose PIN is blocked strands its balance too
([SECURITY-MODEL](SECURITY-MODEL.md) #14), so a refund path would rescue a
blocked card as well as a lost one.

If you want to solve recovery, start from that PR and that objection.

---

## <a id="d6"></a>D6: JavaCard 3.0.5 is a hard floor

The Schnorr signer computes `k·G` using
`KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY`. That constant **was introduced in
JavaCard 3.0.5 and does not exist in 3.0.4**, verified by inspecting the SDK
jars directly.

This invalidated the project's own prior documentation, which named Feitian
3.0.4 as the primary target and JCOP4 as a fallback. Every external
documentation contribution repeated that error, because the README told them to.

**Practical effect:** JCOP3, J3H145 and Feitian 3.0.4 parts cannot run this
applet at all. Confirm the platform version in writing before buying a tray.

---

## <a id="d7"></a>D7: The client refuses locally rather than letting the mint refuse

`meltProofs` and `swapProofs` validate a proof's NUT-11 witness **before**
submitting, and return an error rather than forwarding a request the mint would
reject.

This looks like belt-and-braces. It is not. The ordering is asymmetric:

```
SPEND_PROOF  → card marks the slot SPENT, returns the signature   ← irreversible
meltProofs   → mint accepts or rejects                            ← too late
```

By the time a terminal is assembling a melt, **the card has already burned its
slot**. A mint-side rejection after the burn can strand the proof. Failing locally
leaves it intact.

The same reasoning drives `selectProofsForMelt` returning `null` rather than a
short selection, and the local witness check honouring `sigflag` and `n_sigs`:
**a check looser than the mint's passes locally and still burns the slot.**

---

## <a id="d8"></a>D8: Melt and swap are not idempotent, and the API says so

There is no request-id or retry token. Inputs are consumed the moment the mint
accepts them, so a lost response is genuinely ambiguous.

The library does not paper over this. It documents that after a lost response
the correct move is `getMeltQuoteState` or `checkProofStates`, **never a
retry**, because a retry against a `PENDING` quote is how the same invoice gets
paid twice.

Related: `allProofsUnspent` returns `"UNSPENT" | "NOT_UNSPENT" | CashuMintError`
rather than a boolean. A boolean union fails open: `CashuMintError` is a truthy
object, so `if (await allProofsUnspent(...))` would read a mint timeout as
"safe to accept", inverting the double-spend check. This was a real bug, caught
in review.

---

## <a id="d9"></a>D9: BIP-340 *default* signing, with auxiliary randomness

**Rejected:** a deterministic nonce derived purely from `(d, msg)`.

Deterministic nonces are attractive because they are testable against fixed
vectors. On a bearer card they are dangerous: a nonce that is a pure function of
key and message hands a fault-injection attacker two signatures over the same
`k`, and `d = (s₁−s₂)/(e₁−e₂)` falls straight out.

The signer therefore folds fresh aux randomness into the nonce, exactly as
BIP-340 specifies for default signing. **Signatures over the same message are
deliberately not reproducible**, which is why `cardctl selftest` checks that two
signatures over one message differ, and why the BIP-340 signing vectors cannot
be replayed against the card.

---

## <a id="d10"></a>D10: Every buffer is allocated once, at install time

JavaCard Classic allocates `new` in **persistent EEPROM** and never collects it.
An allocation on the signing path is a permanent leak.

The original signer allocated 288 bytes per `sign()` call. A card would have run
out of persistent memory after a few hundred taps and been **permanently dead
for spending**, recoverable only by deleting the applet instance, which
destroys the stored proofs.

jCardSim cannot surface this: it runs on the JVM, with a heap and a garbage
collector. The suite was green. **A source-level scan now enforces the rule**,
because the runtime cannot.

The general lesson, which applies to every change in `applet/`: *a passing
simulator suite is not evidence about silicon.*

**One exception, since software 1.20 ([D17](#d17)):** the 12,288 bytes that hold
the mint's proofs are reserved by the first `SET_CARD` because
the chip will not install an applet whose constructor asks for that much more.
The scan lets through that one statement and nothing beside it: it is guarded so
that it happens once in a card's life (`if (dleq == null)`), and a request the
card refuses allocates nothing, so it cannot leak a few dozen bytes a tap, which
is what the rule is for. A second allocation next to it, an unguarded one, and
the same statement in any other method are each still refused.

---

## <a id="d11"></a>D11: DLEQ is verified client-side, and unlinkability is not assumed

A mint could sign one user's outputs with a key unique to them and recognise
those proofs on redemption, breaking the unlinkability that is the point of
ecash. [NUT-12](https://github.com/cashubtc/nuts/blob/main/12.md) DLEQ proves
the signature used the *published* key.

It is verified in `cashu-client`, in local arithmetic, with no mint contact,
which is what lets an **offline terminal** check a tap on arithmetic rather than
on faith.

The mint is trusted for solvency. It is explicitly *not* trusted for
unlinkability.

Since software 1.20 the card carries the proof with each piece ([D17](#d17)) so
that the check can be made on a piece read from the card. The card still checks
nothing: the verification is the reader's, as above.

---

## <a id="d12"></a>D12: No PIN on spending, in the base profile (SUPERSEDED by D13)

`SPEND_PROOF` requires no authentication. `LOAD_PROOF`, `CLEAR_SPENT` and
`LOCK_CARD` are PIN-gated; spending is not.

That is bearer semantics: possession authorises payment, as with a banknote. It
permits **a hostile reader in range to drain a
card**, and the spec's Profile B+ (PIN-gated spending) is written but not
implemented.

This was a genuine open product decision, tracked against the same fraud
finding that covers the current Flashcard's re-link gap (ENG-209).
**Resolved by [`D13`](#d13): spending is PIN-gated when a PIN is set.**

---

## <a id="d13"></a>D13: PIN-gated spending on personalised cards (supersedes D12)

`SPEND_PROOF` and `SIGN_ARBITRARY` are PIN-gated **when a PIN is set**;
`VERIFY_PIN` in the same NFC session authorises both. `LOAD_PROOF`,
`CLEAR_SPENT` and `LOCK_CARD` keep their existing gate. Cards provisioned
without a PIN keep the D12 tap-and-go behaviour.

This resolves the open decision D12 deferred (Profile B+; ENG-209): the pilot
chose authorization by possession **and** knowledge because a hostile reader in
the D12 model could drain a card it was presented, and because POS cards now
ship PIN-set by default.

Why `SIGN_ARBITRARY` is gated with it: the signature is a spend authorisation
under the card's key (it is the recovery path's witness material), so an
unverified session must be refused before it can obtain that signature.

Burn ordering is unaffected: the gate is the first statement of the spend
handler, so a wrong or missing PIN throws `6982` **before** the slot burn.
A failed authorization preserves the proof.

**Lockout semantics (pilot):** `PIN_MAX_TRIES` (3) exhausted → `6983`, the
card's PIN-verified operations are dead, and there is **no unblock path** in
this profile. A blocked card is replaced at re-provisioning. An
`UNBLOCK_PIN` command gated by a provisioning PUK is the designated follow-up
**before volume issuance**; do not ship consumer cards at scale without it.

**Resolved by [`D16`](#d16): `UNBLOCK_PIN` gated by a provisioning PUK, applet 0.6.**
A card personalised with a PUK is no longer replaced when its PIN is blocked;
one without a PUK still is, and the lockout paragraph above describes it.

*Correction (ENG-615, after v0.2.0):* "dead" was not what the applet did. The
gate checked `pinState == 1`, and a blocked card has `pinState == 2`, so
exhausting the tries **removed** the gate: every PIN-gated command opened up
to whoever held the card, while `VERIFY_PIN` and `GET_INFO` kept reporting it
blocked. `CHANGE_PIN` had a related bug: its failed checks decremented the
counter without ever setting `pinState`, leaving a card that reported "set"
but could never verify. And no failed check ended the session, so a session
that had verified stayed verified through later wrong PINs, including the
ones that blocked the card. All three are fixed in applet 0.3: the gate fires
whenever a PIN exists in any state; one helper owns the blocked transition for
every PIN check; and a failed check ends the session's verification, as
`OwnerPIN.check` does for its own validated flag. That last rule also means
`CHANGE_PIN` can no longer exhaust the counter: it needs a verified session,
and the `VERIFY_PIN` that opens one resets the counter.

The fix changes wire behaviour, so the applet version moved to 0.3. Every 0.1
and 0.2 build has the same `pinState == 1` gate on `LOAD_PROOF`, `CLEAR_SPENT`
and `LOCK_CARD`, and 0.1 builds from before D13 gate no spend at all, so a card
whose `SELECT` answers anything below `00 03` (`00 01` or `00 02`) needs the
CAP reinstalled. There is no proof-preserving upgrade, so sweep first: the
reinstall regenerates the card key. [D14](#d14) later moved that floor to
`00 04`.

"Dead" also means **stranded**. Nothing but the card key can sign for the
card's P2PK-locked proofs, so a blocked card's balance is unrecoverable, and
`VERIFY_PIN` is unauthenticated: any reader in range can block a card with
three APDUs ([`SECURITY-MODEL.md`](SECURITY-MODEL.md) #14). That loss is what
`UNBLOCK_PIN` + PUK (ENG-617) had to remove, and [D16](#d16) does, for every
card that was given a PUK at personalisation.

Provisioning: POS cards are personalised with a PIN by default
(`cardctl set-pin` during personalisation; `fund-card --pin` when the funding
tool gains it). The merchant terminal prompts for the PIN only when
`GET_INFO.pinState` reports `set`, and refuses a card reporting `locked` (2)
outright: nothing can spend from it. Since applet 0.5 a holder can take the
PIN off again ([D15](#d15)), so the terminal reads `pinState` on every tap.

---

## <a id="d14"></a>D14: A slot's status byte is its commit, written last

A proof slot is `status ‖ keyset ‖ amount ‖ nonce ‖ C`, and every reader trusts
the status byte: `GET_BALANCE` sums the UNSPENT slots and `SPEND_PROOF` signs
for them. So every write to a slot changes its data first and its status byte
last, as a single byte, which the JCRE writes atomically. A card that leaves
the field mid-write leaves the slot with its old status, never a new status
over old bytes:

- `LOAD_PROOF` copies the proof (`Util.arrayCopy`, atomic into persistent
  memory), then sets UNSPENT. Torn before the commit, the slot is still EMPTY:
  no command reads it, and the next `LOAD_PROOF` overwrites it.
- `CLEAR_SPENT` zeroes a spent slot's data, then sets EMPTY. Torn mid-fill (the
  fill is not atomic), the slot is still SPENT: never counted or signed for, and
  the next `CLEAR_SPENT` finishes it. Until then `GET_PROOF` still returns it,
  with some fields zeroed, and its data is not a proof: see
  [`spec/APDU.md`](../spec/APDU.md#clear_spent-0x31) for what a reader
  checks. An EMPTY slot never holds a spent proof's bytes.
- `SPEND_PROOF` writes only the status byte ([D7](#d7)).

**Rejected:** a `JCSystem` transaction around each write. The order alone gives
the guarantee, and a transaction around the old handlers would not have given
it: the old `CLEAR_SPENT` filled the whole slot, status byte included, with
`Util.arrayFillNonAtomic`, which does not use the transaction facility even
while a transaction is in progress. Torn inside a transaction as outside one,
that fill could leave an EMPTY status over a spent proof's bytes, the state
ENG-620's resurrection starts from. A transactional clear needs `Util.arrayFill`
(JC 3.0.5) in its place. Nor does the order keep `LOAD_PROOF` off the commit
buffer: its `Util.arrayCopy` is atomic into persistent memory and subject to the
same commit capacity a transaction uses (it can throw `TransactionException`).
The order does not rely on that atomicity, since a torn copy leaves the slot
EMPTY whatever its bytes hold, so `Util.arrayCopyNonAtomic` would be as safe
there.

*Found after v0.2.0 (ENG-620):* `LOAD_PROOF` set UNSPENT before it copied the
proof, and `CLEAR_SPENT` zero-filled from the status byte. A tear between
`LOAD_PROOF`'s two writes left an UNSPENT slot over the slot's old bytes:
usually zeros, a phantom proof of amount 0 that `CLEAR_SPENT` would not free
(it frees only SPENT slots) until a `SPEND_PROOF` burned it; after a torn
`CLEAR_SPENT` of the same slot, a spent proof's keyset, amount and C, which
`GET_BALANCE` counted and an offline terminal could accept and never settle.

jCardSim cannot tear a write, so `SlotWriteOrderTest` scans the source for the
order, as D10's allocation rule is scanned, and sets the torn states directly to
show what every command then does.

Outside a torn write nothing a reader sends or receives changes, but the applet
version moved to 0.4 anyway. No release carries the one 0.3 build with the old
order (`958a8baa…`), but it was `main`'s tracked CAP from `f889934` until this
fix, and whether a card was installed from it in that window could not be
confirmed. `SELECT`'s version is the only thing an installed card reports about
its build, so the 0.3 builds cannot be told apart: a card answering `00 03` may
run the old order. Keeping 0.3 and telling builds apart by the tracked CAP's
sha256 was rejected for that reason: the hash says which CAP to install, not
which one a card already runs. A card whose `SELECT` answers anything below
`00 04` needs the CAP reinstalled (sweep it first), and `cardctl selftest`
fails it ([`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md#install)).

---

## <a id="d15"></a>D15: A holder can take the PIN off a personalised card (qualifies D13; SUPERSEDED by D18)

> **Superseded in 2.0 ([D18](#d18)).** `CLEAR_PIN` is gone with the 0.x wire.
> On the shared protocol the owner key is the authority above the PIN: the
> owner's proof changes or removes it. The entry below is the 0.5 record.

`CLEAR_PIN` (`0x43`, applet 0.5) removes the PIN from a card that has one.
The card goes back to where `SET_PIN` found it: `pinState` 0, a fresh try
counter, every gated command open with no PIN, `VERIFY_PIN` answering `6984`,
and `SET_PIN` allowed again. D13 stays the default: POS cards still ship
PIN-set, and nothing but this command, sent by someone who has verified the
PIN in the same session and presents it again, takes a PIN off. This adds an
explicit, PIN-authenticated way out; it does not reopen D12.

Why a holder wants it: the card is cash ([D2](#d2)), and the PIN is the
holder's choice of how much that cash should behave like a banknote. A card
handed to someone else, a small-balance card for a tap-and-go merchant, a
card whose holder decides the D13 prompt costs more than the D12 exposure
it closes, each is the holder's call, on their own money, and before 0.5
the only route was a reinstall, which regenerates the card key and strands
the balance ([D5](#d5)). An owner who can set a PIN and cannot remove it is
holding a card with a feature they cannot turn off.

**Rejected:**

- *`SET_PIN` re-callable, or `CHANGE_PIN` with an empty new PIN.* Both
  overload a command that means something else; a reader that sends one
  expects a PIN to exist afterwards. Clearing is its own instruction, with
  its own capability bit (byte 6 bit 3), so a reader can tell from `GET_INFO`
  whether the card answers it or `6D00`.
- *Clearing on the verified session alone, without the PIN in the data
  field.* The session flag is the card's own, but the command that removes
  the one gate on the money asks for the PIN again, as `CHANGE_PIN` does
  before it replaces it. A wrong PIN here costs a try through the same
  helper (`failPinCheck`), so `CLEAR_PIN` is no cheaper to guess against than
  `VERIFY_PIN`, and like `CHANGE_PIN` it cannot be the try that blocks the
  card: the failure ends the session, and the `VERIFY_PIN` that reopens one
  resets the counter.
- *Clearing a blocked PIN.* This is the ENG-615 lesson, and the line this
  command must not cross. State 2 is reached by three unauthenticated APDUs
  from any reader in range; a `CLEAR_PIN` that took a blocked card to state
  0 would be the unblock path D13 says does not exist, handed to whoever
  blocked it, three wrong PINs, then a clear, then a spend. The gate is
  `requirePinVerified`, which a blocked card can never pass, so state 2
  answers `6982` with the right PIN, in this session and the next. The test
  for it sends exactly that sequence. The stranded-balance problem ([D13](#d13),
  [SECURITY-MODEL #14](SECURITY-MODEL.md)) was `UNBLOCK_PIN` + PUK's
  (ENG-617) to solve; [D16](#d16) records that solution.

The write is one byte: `pinState` to 0, after the check, the byte `SET_PIN`
writes last, the other way. The JCRE writes a byte atomically, so a card pulled
mid-command is PIN-set or it is not; there is no state between. The try
counter needs no write of its own: `OwnerPIN.check`'s contract is that a
match sets the validated flag and resets the tries remaining, so the
successful check `CLEAR_PIN` runs just before the write has already left
the counter at its limit, and the card leaves as `SET_PIN` found it with
`pinState` the only persistent byte the command touches.

*Corrected before merge:* the first draft followed the byte with
`OwnerPIN.resetAndUnblock()` inside a `JCSystem` transaction and described
the order of the two as load-bearing, as [D14](#d14)'s is. It was not. The
reset re-filled a counter the check had already filled, so neither tear it
guarded against, state 0 over a stale counter, state 1 over a fresh one,
could happen; the "fresh counter" is one the holder had already earned by
verifying. A write order documented as a guarantee when it is not is worse
than none, since the next change protects the wrong thing, so both calls
went and `ClearPinTest` now scans for the opposite: the check precedes the
write, and the state byte is the only persistent write. The test still sets
`pinState` 0 over a partly spent counter and shows nothing reads it
(`VERIFY_PIN` stops at `6984`; the next `SET_PIN`'s `OwnerPIN.update`
starts its PIN at the full count), as a property of state 0 the applet must
keep. `CLEAR_PIN` must preserve that property.

Readers: `pinState` 1 is no longer a one-way state, so a terminal reads
`GET_INFO` byte 7 on every tap rather than remembering a card as PIN-set.
`cardctl clear-pin --pin` drives it (`VERIFY_PIN`, then `CLEAR_PIN`); `info`
names the capability. flash-mobile's card screen is the follow-up: a
"Remove PIN" action behind the PIN prompt, offered only when byte 6 bit 3 is
set.

The applet version moved to 0.5: a new instruction and a new capability bit
are wire-visible, and a 0.4 card answers `0x43` with `6D00`. A 0.4 card is
not vulnerable and need not be reinstalled; it lacks the feature. 0.5 is a
fresh install (delete + install, sweep first), as every applet version is.
There is no in-place upgrade.

---

## <a id="d16"></a>D16: A provisioning PUK unblocks the PIN (resolves D13's lockout; SUPERSEDED by D18)

> **Superseded in 2.0 ([D18](#d18)).** The PUK is gone with the 0.x wire. A
> blocked card is unblocked by the owner's proof (`CHANGE_PIN`, which needs no
> old PIN), from the holder's phone. The entry below is the 0.6 record.

`SET_PUK` (`0x44`) gives a card a PUK, once, at personalisation. `UNBLOCK_PIN`
(`0x45`) replaces the PIN, blocked or forgotten, on presentation of that
PUK, with no session and without consuming it. Applet 0.6, capability bit 4,
GET_INFO byte 8 for the PUK state (0 unset, 1 set, 2 exhausted). This is the
follow-up D13 named before volume issuance: three unauthenticated APDUs no
longer destroy a card's balance, provided the card was given a PUK and the
PUK was recorded.

**The ENG-615 line holds.** A blocked PIN gates every command until
`UNBLOCK_PIN` succeeds, and `UNBLOCK_PIN` is the only path out of state 2.
`CLEAR_PIN` still refuses it ([D15](#d15)), `SET_PIN` still refuses it, and
a wrong PUK leaves it exactly as blocked. State 1 goes to 1 and state 2 to
1: to the holder a forgotten PIN and a blocked one are the same problem, so
the card does not tell them apart either.

**Custody is off the card, and not the applet's question.** The card never
reveals the PUK, so the personaliser generates it and records it at the
moment `SET_PUK` succeeds; the backend card registry (ENG-618) is its
designated home, releasing it to the card's owning account after
authentication. The applet assumes nothing about where the PUK lives, only
that `UNBLOCK_PIN` is answered by whoever presents it. That is the trade:
the PUK is a PIN bypass for that one card ([SECURITY-MODEL #16](SECURITY-MODEL.md)),
so the card's recovery is exactly as safe as the registry's custody, and a
PUK recorded nowhere is a card that is still a 0.5 card.

**Who may set it.** `SET_PUK` is free on a card with no PIN (the
personalisation order: `SET_PUK`, then `SET_PIN`), needs the holder's
verified session on a card with one (`SET_PIN`, `VERIFY_PIN`, `SET_PUK`),
and is refused on a blocked card in every session, because the session gate
is one a blocked card never passes. Without that, a reader in range could
attach a PUK of its own to a personalised card, block the PIN with three
guesses, and unblock it with the PUK it chose; or block first and attach
second. A PUK is assigned once for the lifetime of that applet installation.

**Ten tries, then terminal.** The PUK is 8–12 digits, longer than the PIN
because it is the credential that replaces the PIN, and it has ten tries
because a registry tool supplies it. A guess still has at most ten attempts
at 10^8 or more
([SECURITY-MODEL #15](SECURITY-MODEL.md)). A wrong PUK answers `63 CX` with
the PUK tries left; the exhausting try answers `63 C0` (not `6983`, so a
reader counting down sees zero) and sets byte 8 to 2, after which
`UNBLOCK_PIN` is `6983` for good and `SET_PUK` is `6A89`. Exhaustion disables
the PUK recovery path while retaining the balance: a card whose PUK was guessed at ten
times is a 0.5 card, stranded only if its PIN is then blocked. The
alternative, `SET_PUK` allowed again after exhaustion, in a verified
session, was rejected because the card cannot tell the holder re-arming
their own card from the thief who exhausted the PUK and then guessed the
PIN; a terminal state at least tells the holder, through byte 8, that this
card should be swept and replaced.

**Why state 0 is refused.** `UNBLOCK_PIN` on a card with no PIN answers
`6984`. There is nothing to unblock, `SET_PIN` is the way to a PIN there, and
letting the PUK set a first PIN would make `UNBLOCK_PIN` a second `SET_PIN`
with a different gate. One command per transition.

**Rejected:**

- *A PUK the holder chooses, or one the card shows once.* Either puts the
  PUK where the PIN is, on the holder, and a credential the holder loses
  with the PIN is no recovery. Generated by the personaliser, recorded by
  the registry.
- *Unblocking on the verified session, or `CHANGE_PIN` from a blocked
  state.* A blocked card grants no session; that is D13 and ENG-615. The
  PUK is a second credential precisely because the first is gone.
- *`UNBLOCK_PIN` opening a session.* It proves possession of the PUK. The new PIN still requires its own verification. The
  holder's first `VERIFY_PIN` with the new PIN is the first time that PIN is
  known to work, and a terminal that got a session from the registry's
  credential rather than the holder's would be spending on the registry's
  authority.
- *`pin.resetAndUnblock()` before `pin.update()`.* `OwnerPIN.update` resets
  the try counter itself, the contract `SET_PIN` after `CLEAR_PIN` already
  rests on, so the reset would re-fill a counter the next call re-fills, and
  [D15](#d15) records why a redundant counter write is worse than none.
  `PukTest` scans for its absence.
- *A `JCSystem` transaction around the PIN write and the state byte.* The
  state byte is the commit ([D14](#d14)): `VERIFY_PIN` now refuses state 2 on
  its own as well as an empty counter, so a card torn between the two is
  state 2 over a fresh PIN, gated everywhere, and finished by the next
  `UNBLOCK_PIN`. The order gives the guarantee; a transaction would give the
  same one at the cost of commit-buffer space on every unblock.

**The write orders.** `SET_PUK`: PUK value, then byte 8 = 1. A tear leaves a
PUK nothing reads (`UNBLOCK_PIN` stops at state 0), overwritten by the next
`SET_PUK`. `UNBLOCK_PIN`: PUK check, then the new PIN with its full counter,
then byte 7 = 1. A tear leaves state 2 over the new PIN, refused by
`VERIFY_PIN` on the state byte, finished by the same PUK. `failPukCheck`:
the counter (decremented inside `OwnerPIN.check`), then byte 8 = 2. A tear
leaves state 1 over an empty counter, which the next `UNBLOCK_PIN` turns
into `63 C0` and the 2, never a recovered try. `PukTest` scans the three
orders in the source and sets the three torn states directly.

Readers: byte 8 is read with byte 7 on every tap. A terminal shows a card
reporting `2 / 1` as recoverable and `2 / 0` or `2 / 2` as stranded.
`cardctl set-puk --puk [--pin]` and `cardctl unblock-pin --puk --new-pin`
drive the two commands; `info` names the capability and the PUK state;
`selftest` names `unblock-pin` on a blocked card whose PUK is set. The
follow-ups are the registry (ENG-618) and flash-mobile's unblock screen,
offered when byte 6 bit 4 is set and byte 8 is 1.

The applet version moved to 0.6: two new instructions, a capability bit and
a ninth GET_INFO byte are wire-visible, and a 0.5 card answers `0x44` and
`0x45` with `6D00`. A 0.5 card is not vulnerable and need not be reinstalled;
it lacks the feature, and so lacks the recovery. 0.6 is a fresh install
(delete + install, sweep first), as every applet version is. There is no
in-place upgrade, and so no way to add a PUK to a card in the field without
regenerating its key.

---


## <a id="d17"></a>D17: The mint's proof is kept with each piece, reserved after install, one piece a command

**Decided:** from software 1.20 the card keeps, for each piece, the mint's NUT-12
proof as a later holder needs it: `e`, `s` and the blinding factor `r`, 96 bytes
(`GET_DLEQ`, `LOAD_PROOF` with `P1 = 1`: [`FOXY-CARD-SPEC.md`](FOXY-CARD-SPEC.md) 5.9).
The card does not check the proof and never uses it.

**Why the card carries it.** Without it a phone that reads the card can ask the
mint whether a piece is spent and cannot tell whether it is real: a made-up `C`
looks like any other until the mint is asked to take it. With it the phone checks
the piece itself, with the mint's keys, before it pays with the piece or takes it
in. The proof is made once, when the mint signs the piece, and the card is the one
place that can keep it with the piece.

**Why the card does not check it** ([D3](#d3), [D11](#d11)). The check needs the
mint's public key for the amount, which changes with every keyset, and the card
has no mint's keys and no room to keep a mint's directory. And a card that checked
would be one more thing to believe: a card that said yes is a card that could say
yes to anything. The reader that checks is the one that needs to know. So the card
stores the 96 bytes and gives them back, and a record of zeros means "no proof".

**Why after install and not in the constructor** ([D10](#d10)). The chip refused to
install a build whose constructor asked for 12,288 bytes more than 1.19's, and
installed one that asked for 300 more
([`FOXY-CARD-HARDWARE.md`](FOXY-CARD-HARDWARE.md)). The same bytes asked for by a
command after the install were given. No simulator has the limit, which is why it
is pinned by tests that read the source and look at the card (null after install,
reserved by the first `SET_CARD`). The reservation is guarded, so it happens once;
it is outside any transaction, so nothing can undo it; and if the card refuses it
the `SET_CARD` goes on and the card works as a card with no room for proofs. So
every use of the store is safe while it is null.

**Why one piece to a command.** A piece with its proof is 177 bytes, and a short
APDU carries 255. Two would not fit, and extended length is not something every
reader and phone will carry (the same reason a plain batch stops at three pieces
of 81 bytes). `LOAD_PROOF` with `P1 = 1` is one piece and its proof, and any
other P1 is the plain form it always was. A command to each piece is slower than
a batch of three (a batch took 0.19 s on the chip: [`FOXY-CARD-HARDWARE.md`](FOXY-CARD-HARDWARE.md));
the one-piece form has not been timed there.

**Why zeros are refused as a proof.** A record of zeros is how the card says "no
proof". If a load could store zeros and answer "kept", the answer would be false.
A proof of 96 zero bytes is `6A80`, as a `C` that is no point is.

**Why a piece's record is written first.** The rule is that a place that is
unspent holds its own proof or zeros and never another piece's. A freed place
keeps the record it had (`CLEAR_SPENT` and the payment commands write nothing to
the store: no write was added to a payment), so the next piece into it must write
its own record, or zeros, before anything else of the place, with the status byte
still last ([D14](#d14)). A tear then leaves an empty place with a record beside
it, which nothing serves.

**Why `GET_DLEQ` has no PIN, and gives nothing for a spent piece.** It gives what
the mint made for a piece that is already on the card for any reader to read
(`GET_PIECES` has the rest of the piece with no PIN). It gives the proof of an
unspent piece only: a spent piece's proof is of no use to anyone and is not given.

**Cost accepted:** `r` is in the proof, so a reader that hands the proof to the mint
lets the mint tie the piece to the request that made it, as with any NUT-12 token;
and the card gives `r` to any reader with no PIN
([`SECURITY-MODEL.md`](SECURITY-MODEL.md) #16). 12,288 bytes of the card's storage,
which the chip has.

---

## <a id="d18"></a>D18: One card protocol with Foxy: their 1.20 is the base of 2.0

**Decided (ENG-673):** the applet in this repository is the Foxy wallet
project's fork ([getfoxy/card](https://github.com/getfoxy/card) at `88840aa`,
software 1.20), merged back with a real `git merge` so their history and
authorship stay in `git log`. Flash and Foxy speak one wire from here, called
**2.0**. The fork's applet, its tests, `spec/vectors/` and its documents
(`docs/FOXY-CARD-*.md`, `docs/FOR-LNFLASH.md`, `FORK.md`) came in as they were;
our `tools/cardsim` bridge and `tools/cardctl` were kept and ported to 2.0.

**Credit.** The fork's review of applet 0.4 (`docs/FOR-LNFLASH.md` section 3)
found the two weaknesses that mattered most here: `SPEND_PROOF` signed a hash
the reader chose, and `SIGN_ARBITRARY` signed anything without burning a slot,
so the card's SPENT flag protected nothing. Their applet fixes both (the card
builds and hashes each piece's secret itself; `AUTH` proves the card over a
tagged hash), adds an owner key, a daily limit with a clock taken from Bitcoin
block headers, NUT-11 SIG_ALL payments with change, and the mint's NUT-12 proof
kept with each piece. The design is theirs; the changes we made on top are D19
to D24.

**Superseded.** Our 0.5 `CLEAR_PIN` ([D15](#d15)) and 0.6 PUK ([D16](#d16)).
The owner key is the authority above the PIN: its proof changes the PIN with no
old PIN and unblocks a blocked card, from the holder's phone. A PUK in a
registry was a second bearer secret for the same job. Their suites are
ported to 2.0 under names for what they now test: `ClearPinTest` is
`OwnerPinRemovalTest` and `PukTest` is `OwnerUnblockTest` (D15 and D16 name
them as they were), and the cardsim's `VersionMaskTest` is `OldCardTest`.

**Rejected:** keeping 0.x and adding Foxy's fixes one by one. Two wires for one
kind of card, from two teams, would have stayed two; and the fixes are not
separable from the slot layout and the payment commands they change.

**Cost accepted.** 0.x cards cannot be updated in place: a card is reinstalled,
which makes a new key, so its balance is swept first (`HARDWARE_DEPLOYMENT.md`).
Both apps drop 0.x and say "This card needs an update" to a 0.x card.

**The hardware e2e tools stay 0.x.** The architect's decision 5 was to take
Foxy's `tools/e2e-melt.cjs` and `tools/e2e-redeem.cjs` as "already on their
wire" and delete ours. They are not on it: at `88840aa` both are byte-identical
to ours at `7a96102`, and both drive the 0.x applet's `SPEND_PROOF` through
cardctl's `spend`, which 2.0 removed. Neither tree has a 2.0 version. So they
are kept as 0.x tools for the one job left for them, the sweep of the funded
0.x field card before it is reinstalled (`HARDWARE_DEPLOYMENT.md`). Each
refuses to run unless `CARDCTL` points at a 0.x `cardctl.py`. The 2.0 e2e is
`tools/cardsim/e2e-swap.test.cjs`: one `SIG_ALL` signature and a swap at a real
mint, in CI. A 2.0 hardware e2e (melt and redeem over `SPEND_ALL_*`) is not in
this PR. It comes when a 2.0 card is on the bench.

---

## <a id="d19"></a>D19: A neutral identity: AID F0 CASHUCARD, labels CashuCard/, version 2.0

**Decided (ENG-673):** the package AID is `F0 43 41 53 48 55 43 41 52 44`
("CASHUCARD" after the proprietary RID byte `F0`). Every instance AID derives
from it as Foxy's derived from `F0 FOXYCARD`: the opener `…4D`, the card's
applet `…01`, the tag's class `…54` (the tag is still instantiated under the
NFC Forum's own `D2 76 00 00 85 01 01`, which phones select). Every label and
tag that went into a hash or an owner's proof as `FoxyCard/…` is `CashuCard/…`:
`auth`, `seal`, `pinkey`, and the owner's `change-pin`, `set-limit`,
`set-owner`, `set-card`, `load`, `lock`, `reset` and `tag`. `SELECT` and
`GET_INFO` answer version `02 00`.

**Why a new AID and not either old one.** Our 0.x AID `D2 76 00 00 85 01 02`
sits under the NFC Forum's RID, which is not ours to allocate under; Foxy's
names one wallet. A proprietary `F0` AID that names the protocol belongs to
neither. And a new AID is what makes the change safe on the wire: a 0.x or 1.x
card does not answer it (`6A82` from a card's runtime), which is the signal both
apps read as "this card needs an update", rather than a card that answers and
then misreads every command.

**Why the labels change with it.** An owner's proof under `FoxyCard/set-limit`
is a proof for Foxy's cards; one protocol has one set of labels. The labels and
the AID change in one commit so that no build ever has one without the other.

**Why 2.0.** Our cards said 0.x and Foxy's 1.x. A major of 2 separates the
shared wire from both, for a reader that checks the version after the AID.

**The copy that fails silently.** `Tag.java` keeps its own copy of the card
applet's AID for `JCSystem.getAppletShareableInterfaceObject`. Left at the old
AID, the tag finds no card, takes itself to be on, and the owner's switch does
nothing. `TagLookupTest` holds the copy to `applet/build.xml`, and
`AidVersionTest` checks the build, the source and the old AIDs.

**Cost accepted.** The AID is one byte longer, which moves the CAP's size; the
size check (`tools/refcheck.py`) says whether the J3R180 has taken that size
before. The tag still carries Foxy's address (`https://getfoxy.io/card`); which
page a 2.0 card's tag opens is a product decision left open.

---

## <a id="d20"></a>D20: The clock walk is bounded: a rollover budget, REFRESH, an armed allowance, an anchored owner

*Amended by [D200](#d200) (3.0): the anchor of the owner's reset or hand-over of an empty card
sets the clock even where it is older than the card's. Amended by [D201](#d201) (3.0): `REFRESH`
(and a claim's anchor) brings back a clock a weak header set, and the owner's `REFRESH` back form
any clock; at a weak clock no day ends.*

*Amended by [D26](#d26) (2.1): only a payment that moves value rolls the day, and
a `SET_LIMIT` without the budget's byte leaves the budget as it is. The text
below is 2.0's.*

*Amended by [D186](#d186) (3.0): the no-PIN allowance has a window of its own,
counts whole pieces, and is armed by a `VERIFY_PIN` only in a time in the field
that signs no payment; the rollover budget is unchanged.*

**Found (Foxy's reply, question 3; our shelved 0.7 plan, its decision 9),
fixed (ENG-673, fix 4a).** In 1.20 the day's window rolls whenever a payment
finds the card's clock a day past the window's start, and the clock is any block
header with the work. The network makes a real header every ten minutes, for
free. So a terminal that has been handed the PIN, and keeps the card, takes a
day's limit for every day of headers it brings, and a reader with no PIN at all
takes the no-PIN allowance each day. The daily limit bounds value within a day;
a visit can cross several days. And a card whose owner was set before any header
ran at `now = 0` and spent its first day on trust.

**Decided:**

- **A rollover budget.** The window rolls only while the rolls since the
  owner's last `REFRESH` are fewer than the budget; past it, the window stays
  where it is and what was signed for in it still counts. Default 7, 1 to 30,
  set by a thirteenth byte on the owner's `SET_LIMIT` (`34`); a form without
  it (4, 8 or 12 bytes, and the PIN form `33`) sets the budget back to 7, as
  the architect's decision 2 (ENG-673) has it (2.0; since 2.1 it leaves the
  budget as it is, [D26](#d26)). The first window a card begins (a limit or an
  allowance set before any header, or an allowance set alone) is a beginning,
  not a roll. A terminal with the PIN that walks the clock now gets the found
  day and the budget's days, and no more until the owner's phone has seen the
  card: with a budget of 2, three limits along ten real headers
  (`ClockWalkTest`), where 1.20 gave eleven.
- **REFRESH (`53`).** The owner's proof, under `CashuCard/refresh`, over a
  block header; the header is held to every check `SET_HEADER` makes, taken as
  `SET_HEADER` takes it (an older one moves nothing), and the rolls go to 0, in
  one transaction. The owner's phone sends it with the tip whenever it is
  online. No PIN; any funds; a locked card too, since a locked card still pays.
  `53` was free at `88840aa`; Foxy signs off on the number in the PR.
- **The allowance renews only when armed.** At a roll the no-PIN count goes to
  nothing only if a PIN (`VERIFY_PIN`) or an owner's proof has been given since
  it last did, and the roll spends the arming. A reader with no PIN gets one
  allowance per arming.
- **The anchor.** `SET_OWNER` may carry a block header after the key (65 + 80
  bytes). It is checked before anything is written (`6A93` refuses the owner
  as well) and taken in the owner's transaction, with the rolls at 0. A card
  set up so never runs at `now = 0`, never spends a first day on trust, and its
  clock never goes back past its owner's header. Without the header
  `SET_OWNER` is 1.20's: the wire Foxy's wallet already writes.

**Where it is kept.** Three bytes of the 29 the record left as zeros after the
last header's hash (`CARD_ROLLS_OFFSET` 156, `CARD_BUDGET_OFFSET` 157,
`CARD_ARMED_OFFSET` 158), so the constructor asks for nothing more (the chip's
install limit, [D17](#d17)), `RESET_CARD` clears them with the rest, a card's
transactions cover them, and `GET_CARD` shows them to any reader as its bytes
76, 77 and 78 (a budget of 0 there is the default, 7). `GET_INFO` is unchanged.

**Rejected:** counting rolls against the clock's own movement (a terminal
moves the clock); a roll per owner's proof of any kind (a proof for the load
grant is given at a till's top-up, which is not the owner looking at the card);
leaving the budget as it is when the byte is absent. That was this PR's first
version, so that a wallet that does not send the byte would not undo the
owner's choice; the architect's decision 2 had already settled "absent means
7", and both apps code to it. Under it every `SET_LIMIT` says what the budget
is afterwards, and the cost is the one below.

**Cost accepted.** A holder who is offline for longer than the budget, and
pays every day, finds the day's limit stops renewing; the app tells them to
open it online and tap the card. `REFRESH` and the anchor need the phone to
have a recent header (both apps: mempool.space, then blockstream.info; neither
reachable, no header and the card keeps its clock). A 1.x wallet never
sends a `SET_LIMIT` to a 2.0 card, because it does not find the 2.0 AID
([D19](#d19)). The wallet this rule reaches is one moved to the CashuCard AID
and labels that does not send the budget byte yet, which is the state Foxy's
wallet passes through on its way to 2.0. Each 4-, 8- or 12-byte `SET_LIMIT`
it sends puts the budget back to 7, in both directions:

- an owner's budget of 1 to 6 is loosened to 7, so a terminal with the PIN
  gets more days' limits out of a walk until a phone that sends the byte sets
  it again (2.0's `ClockWalkTest.aFormWithoutTheByteSetsTheBudgetBackToSeven`;
  2.1 holds the opposite, `aFormWithoutTheByteLeavesABudgetOfTwo`, [D26](#d26));
- an owner's budget of 8 to 30 is tightened to 7, so a holder the owner gave
  a longer budget because they are offline for weeks finds the day's limit
  stops renewing after a week despite the intended month, and has to come online and tap
  the card sooner (2.0's `ClockWalkTest.aFormWithoutTheByteTightensABudgetOfThirtyToSeven`;
  2.1: `aFormWithoutTheByteLeavesABudgetOfThirty`).

The second takes spending away from a holder. Foxy reviews both in the PR.

**And a new way to strand funds.** In 1.20 a holder who had lost the owner
key could still spend the card down, one daily limit a day; our reply to
Foxy (question 3, "Losing the owner's words") relied on that. In 2.0 only
the owner's proof refills the budget (`REFRESH`, or an anchored `SET_OWNER`,
which also needs the old owner's proof), and nothing else lifts the limit
(the owner's `SET_LIMIT`) or empties the card (`RESET_CARD`). So on a card
with a daily limit and no owner key, the window stops rolling after the
budget's rolls and stays where it is: what can still be paid is about
(budget + 1) daily limits after the owner's last proof, and anything above
that is stuck for good (`ClockWalkTest.aPinScriptGetsTheBudgetAndNoMore`
shows the stop: 3 of 12 pieces with a budget of 2). A card with no daily
limit is not affected. The architect's decision 14 falls back to a random
per-card owner key kept only in the phone's Keychain when a user has no
backed-up seed, so a lost or wiped phone is enough to cause this.
flash-mobile's "This card's owner key lives only on this phone" copy has to
say so, and an owner who cannot back the key up should be steered to no
daily limit or a small balance (SECURITY-MODEL #14, #17).

---

## <a id="d21"></a>D21: The field multiply does the same work for every input

**Decided (ENG-673):** `SchnorrHW.mul256x256` and `mulByDelta` have no branch
and no loop whose length depends on a byte of an operand. The `if (ai == 0)
continue;` that skipped a row of zeros is gone from both, and so is the
`while (carry != 0 …)` that carried a row's overflow upward: the carry is
written into its column, which no earlier row has touched (rows run from the
low byte up; row `i` of the full product writes columns `i+1 … i+32`, and of
the product by DELTA columns `i+16 … i+32`), so the carry, at most 255, is the
whole of that column. The result is the same number; `SchnorrHWMathTest` holds
both products to `BigInteger` on operands full of zero bytes, and scans the two
bodies for `continue`, `if`, `while`, `break`, `return` and `?`.

**Why it matters here.** The operands of these products are the signing nonce
and the card key. A row skipped for a zero byte makes a signature measurably
faster for some nonces, and leaked nonce bytes are how ECDSA and Schnorr keys
are recovered with lattices. `AUTH` signs for any reader, with no PIN, as often
as it is asked: an unlimited supply of timed signatures. The 0.x applet had
the same early exit; it was never measured on silicon (SECURITY-MODEL, open
item 5).

**Cost accepted.** A zero row now costs what any row costs, about one row in
256 on random input; the carry write is cheaper than the loop it replaces.
Re-measure `cardctl --timing` on the J3R180 before release (`AUTH`, measured
under ENG-681: 833 to 854 ms a signature on an ACR122U, against 814 ms for 0.4,
about 3% more; [D25](#d25)). What this did not
reach at first: the modular reductions on the same signing path, which
branched on values derived from the key and the nonce (`reduce512toModN` over
e·d, `addModN` over k + e·d, `reduceModN` over k, the `sub32` and `cmp32` they
called, and `mulSmallByDelta`'s overflow check). Since 3.0 those run the same
instructions for every value too (SECURITY-MODEL item 5), and
`SchnorrHWMathTest` scans their bodies as it scans the multiplies. What this
does not reach: the chip's own `KeyAgreement` and RSA engines, which do the
point multiply and the field exponentiations, and whose timing is NXP's; and
the JavaCard VM's own timing of a multiply or an array access, which is not
specified constant. Nothing is measured on silicon yet.

---

## <a id="d22"></a>D22: The PIN's state byte is its commit: a torn CHANGE_PIN stays blocked

**Found (reply notes to Foxy), verified in 1.20, fixed (ENG-673, fix 4c).**
`CHANGE_PIN` writes the new PIN (`OwnerPIN.update`, which also refills the
tries) and then `pinState = 1`. On a blocked card, a tear between the two left
`pinState` 2 over a new PIN with three tries. `VERIFY_PIN` keyed on the counter
alone, so the new PIN verified; the payment gate keyed on the verified flag and
opened, while the load gate keyed on `pinState == 1` and refused. A card that
`GET_INFO` called blocked paid, and could not be loaded.

**Decided:** `pinState` is the PIN's commit byte, as a slot's status byte is
the slot's ([D14](#d14)). It is written last, and every PIN gate reads it:
`VERIFY_PIN` answers `6983` for state 2 before it checks anything (costing no
try), `requirePinIfSet` refuses state 2 even under a verified flag, and a
blocked card has no no-PIN allowance (`needsAllowance`). A card torn there is
blocked until the owner's `CHANGE_PIN` is sent again, which is what the owner's
phone does for a card that answers blocked. `SET_PIN` keeps the same order, for
an open card torn while being unblocked.

**And a transaction around both writes.** Java Card 3.0.5 does not say that
`OwnerPIN.update` takes part in a transaction (its try counter and validated
flag are specified not to), so the transaction may roll back only the state
byte. Nothing relies on it: the commit byte is the fix, and the transaction is
for a chip whose `OwnerPIN` does take part.

**The same rule, the other tear.** A failed check whose counter decrement
landed and whose `pinState = 2` did not (`failPinCheck` torn) leaves state 1
over no tries. `VERIFY_PIN` already answered `6983` on the counter; the
allowance now refuses it too, so a card blocked by its counter pays nothing
without the PIN. (Found in the tear review, [D23](#d23).)

**Tested** by setting the torn states directly (`ChangePinTearTest`, the
ExposedRuntime pattern of `SlotWriteOrderTest`) and by source scans of the
order; jCardSim cannot tear a write and its transactions do not roll back.

---

## <a id="d23"></a>D23: The tear review of 2.0: every write outside a transaction, site by site

**Decided (ENG-673, fix 4d):** every persistent write in `CashuApplet` that is
not inside a `JCSystem` transaction was listed and reviewed against the
[D14](#d14) rule: a multi-field write commits a single byte last, or is one
transaction. The list is pinned by `SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed`,
which counts such writes per method and fails on any method that gains one
until it is reviewed here. One violation was found, and fixed in
[D22](#d22); the rest hold, for these reasons:

| Site | Writes outside | Why a tear there is safe |
|---|---|---|
| `loadOne` | the proof record, the hex text, the data, the status byte, then `changeDue` | Status byte last ([D14](#d14), [D17](#d17)): a tear leaves an EMPTY place, which nothing serves. `changeDue` is cleared after the commit: a tear leaves the change grant standing for one more tap, which opens loading only, never a payment (tested). |
| `freeSpent` | the data zeroed, then the status byte | D14: a tear leaves a SPENT place, never counted or signed for; the next `CLEAR_SPENT` finishes it. |
| `processSpendAllSign` | `burnList` | Written before the payment's transaction and read only while `burnPending` is set, which that transaction sets. A tear before it has burned nothing. |
| `finishBurn` | each place's status byte | After the payment's commit: idempotent (a byte written twice is the same byte), redone from the top at the next command, and `burnPending` is cleared in a transaction of its own after them. |
| `processSpendAllChange`, `blindChange` | an EMPTY opening's amount, keyset, date, nonce and `r`, then `openState` DRAFT | The state byte is the opening's commit: a torn opening stays EMPTY, which `GET_CHANGE` never serves, and the next change writes it whole (tested). |
| `processSpendAllBegin`, `processGetChange`, `clearOpening` | one state byte per opening | Single bytes, each atomic; a draft let go or a pending opening released is the same state at the next pass. |
| `failPinCheck` | `pinState` 2 | One byte, after the JCRE's own decrement of the counter. Torn between them, the card is state 1 over no tries: `VERIFY_PIN` and, since D22, the allowance read that as blocked. |
| `processSetPin` | the allowance and its count zeroed | On a card with no PIN, before the PIN's transaction: each copy atomic, and a card with no PIN has no allowance to lose. |
| `processResetCard` | the bulk wipes and the new keys | Then who the card is, in one transaction, last (Foxy's design): torn before it, the card is still its owner's, empty, and the owner resets it again. The wipe takes the rollover bytes ([D20](#d20)) with it. |
| `processLockCard`, `processSetTag`, `armAllowance` | one byte | Atomic. |
| `writeHeader`, `logEntry` | several | Helpers: every caller holds a transaction around them (pinned in `CashuAppletTest`). |
| `initCardKeypair`, `initPinKey` | the key pairs | Install time: no card exists until `install` returns. |

**What a scan cannot see.** The review is of the source. jCardSim cannot tear a
write, and no 2.0 card has been pulled away mid-command on purpose; the states
a tear leaves are set by hand in the tests and shown harmless, as in D14.

---

## <a id="d24"></a>D24: FLOOR_BITS is a quarter of the work of the newest header in the vectors

**Decided (ENG-673):** `FLOOR_BITS`, the least work any block header must
show before a card that has taken none believes it, is four times the target
(a quarter of the work) of the newest mainnet header in
`spec/vectors/headers.json`. For 2.0 that header is height 971,100 (bits
`0x17021EF0`), and the floor is `0x17087BC0`: the same as Foxy's 1.15 value,
because the network's difficulty had not moved by a retarget's worth between
the two. `FloorBitsTest` works the floor out from the vectors and holds the
applet to it.

**The procedure, at each release** (v2.0.0 included): add the tip's header to
`spec/vectors/headers.json` (taken from a block explorer and checked: its hash
is the double SHA-256 of its 80 bytes), run `FloorBitsTest`, and set
`FLOOR_BITS` to what it asks for. A floor from the release's own time means a
card set up years later starts from its own era, and the ratchet (a quarter of
the hardest header taken) carries it from there.

**Why a quarter, and not the network's own target.** A header at the tip's
difficulty must always pass, and the difficulty moves by up to four times a
retarget; a quarter of the work leaves room for the network to fall and still
costs a forger a quarter of a block's work (about 2^77 hashes) per day it buys.

---

## <a id="d25"></a>D25: Readers select the card's applet by its whole AID

**Decided (ENG-681):** a reader selects the card's applet by its whole instance
AID, `F0 43 41 53 48 55 43 41 52 44 01` (`00 A4 04 00 0B F0 43 41 53 48 55 43 41
52 44 01`), and answers `02 00` there. The package AID `F0 43 41 53 48 55 43 41 52
44` ([D19](#d19)) is not the SELECT AID. A reader may fall back to it after a
`6A82`, but takes a `90 00` that carries no version as no answer. `cardctl`, the
cardsim client, `spec/APDU.md`, `spec/NUT-XX.md` and
[`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md) say so.

**Why.** A SELECT by the package AID is a partial name: three of the package's
AIDs begin with it, the opener's (`…44 4D`), the card's applet's (`…44 01`) and the
tag's class (`…44 54`). The chip gives a partial name to the first instance it
made whose AID begins with the name, and the opener is made first, because the
J3R180 will not take the card's applet as the package's first instance
([FOXY-CARD-HARDWARE.md](FOXY-CARD-HARDWARE.md)). So on a chip the package AID
reaches the opener, which answers its SELECT with `90 00` and nothing else, and
`6D 00` to every command after. The suites run in jCardSim, where the package
AID reached the card's applet: jCardSim keeps its applets sorted by AID and gives
a partial name to the lowest that matches, and `…44 01` sorts before `…44 4D`.
So every suite passed a SELECT that the chip answers with the opener.

**The hardware evidence (2026-10-13).** v2.0.0-rc.1 (the tracked CAP, sha256
`59f66673…`) installed on the J3R180 per [`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md):
the opener `F0 CASHUCARD 4D` first, then the card's applet `F0 CASHUCARD 01`, then
the tag. It installed at 20,057 bytes as the install counted the load file (20,060 by
`tools/refcheck.py`'s measure, which had it as a size not yet tried; it is now in
refcheck's table as one that installs). A SELECT of `F0434153485543415244` answered
`9000` with no body, and the next command `6D00`; a SELECT of
`F043415348554341524401` answered `0200 9000`. `cardctl selftest`, which selected
the package AID first, failed; with the whole AID selected first it passed 12 of
12, `AUTH` taking 833 to 854 ms a signature on an ACR122U (0.4 took 814 ms: the
constant-time multiply of [D21](#d21) costs about 3%). Foxy's wallet already
selects by a whole AID only: today its 1.x card's ten bytes `F0 FOXYCARD 01`
(`00 A4 04 00 0A F0 46 4F 58 59 43 41 52 44 01 00`), never a package prefix; on
2.0 the whole AID is the eleven bytes above.

**Rejected: instantiate the card's applet first, or give the opener an AID that
the package AID does not begin.** The first is what the chip refuses (the reason
the opener exists). The second changes the CAP the 2.0 release candidate ships,
for a reader that has no reason to use a partial name: Foxy's wallet already
selects by a whole AID only. **Rejected: keep the package AID first and fall through on
a bare `90 00`.** It costs a SELECT on every tap of every 2.0 card, and leaves a
reader that does not know the rule on the opener.

**The simulator follows the chip.** `tools/cardsim` installs the opener first and
resolves a partial name itself, to the first instance installed whose AID begins
with it (`SimCard.resolveSelect`), so an app's e2e run against the bridge meets
the opener where a chip would put it. The applet's own suites install the card's
applet alone, where either SELECT reaches it.

---

## <a id="d26"></a>D26: Only a payment that moves value turns the day; a SET_LIMIT without the budget's byte leaves it (amends D20)

*Amended by [D186](#d186) (3.0): the no-PIN allowance counts whole pieces in a window of
its own, which only an arming renews, and a `VERIFY_PIN` arms it only in a time in the field
that signs no payment. The text below is 2.1's.*

**Found (Mike Greff's review of 2.0, ENG-699), fixed in 2.1.** Each finding was
first written as a test that failed on 2.0; the names are `ClockWalkTest`'s.

1. **A payment of nothing spent a roll.** In 2.0 `SPEND_ALL_SIGN` rolled the day
   whenever the day was over and the budget lasted, whatever the payment came
   to. A payment whose change (`SPEND_ALL_CHANGE`) is the whole of its pieces
   leaves the card nothing poorer (`allNet` is 0), so it is within any
   allowance: on a card with a PIN and an allowance a reader with no PIN signs
   it, and on a card with no PIN anyone does. Seven taps of it along seven real
   headers spent the default budget of 7, and the owner then had one day's
   limit until the next `REFRESH`. Failing on 2.0:
   `aPaymentThatMovesNoValueRollsNothing` (a roll on the first day),
   `onACardWithNoPinAPaymentOfNothingRollsNothing` (two rolls of a budget of 2),
   `aPaymentOfNothingBeginsNoWindow` (it began the first window). One part of
   the finding does not hold: a card with a PIN and no allowance refuses such a
   payment from a reader with no PIN (`6A94`), as it refuses every payment
   without the PIN, so on that card it never rolled
   (`withNoAllowanceAReaderWithNoPinPaysNothingAtAll`, passing on 2.0 and 2.1).
2. **A form without the budget's byte reset the budget.** D20 had every
   4-, 8- or 12-byte `SET_LIMIT` (and the PIN's form) set it back to 7. Failing
   on 2.0: `aFormWithoutTheByteLeavesTheBudget`,
   `aFormWithoutTheByteLeavesABudgetOfTwo`, `aFormWithoutTheByteLeavesABudgetOfThirty`.
3. **A budget set under the rolls already spent.** It stops the day at once and
   until `REFRESH`, which empties the rolls. 2.0 already did this (`windowRolls`
   compares the rolls to the budget as it is now); the finding is held by a
   test that passes on both, `aBudgetUnderTheRollsSpentStopsTheDay`.

**Decided:**

- **What spends a roll.** A `SPEND_ALL_SIGN` that signs and commits, whose
  `allNet` (the pieces named at `SPEND_ALL_BEGIN` less the card's own change)
  is above 0, on a card with a daily limit or an allowance, that finds the day
  over (`now` at least 86,400 seconds past the window's start) and its rolls
  under the budget. A window not yet begun is begun by the same payment, and
  that is no roll. Nothing else spends one: `SET_HEADER`, `REFRESH` and the
  anchored `SET_OWNER` move the clock, `TELL_TIME` is a note, every `GET_*`
  only reads, `VERIFY_PIN` and an owner's proof arm the allowance, and a
  payment refused (`6A94`, `6A8F`, or given up before its signature) throws
  before its transaction (`nothingButAPaymentRolls`). A payment of nothing is
  signed as before and counted, as nothing, in the window as it stands.
- **One test, read three times.** The value check is in `windowRolls`, which
  the day's limit (`requireUnderLimits`), the allowance
  (`requireAllowanceOrPin`) and the commit all read. Were they to disagree, a
  payment would have been judged against a new day and written into the old
  one, and the day's count would have gone to nothing with no roll. The roll,
  the day's count and the burn stay in the payment's one transaction
  ([D23](#d23)); no write moved, and `SlotWriteOrderTest` holds the list.
- **The budget's byte, absent, leaves the budget.** A wallet that sets a limit
  and does not know the byte neither loosens nor tightens what the owner
  chose. The rolls are not touched by any `SET_LIMIT`.

**What still rolls with no PIN.** A payment of value within the allowance: one
sat a day from a reader with no PIN rolls the day as any payment does
(`aPaymentOfOneSatWithNoPinStillRolls`: seven rolls for seven sats). That walk
costs the reader a sat a roll from an allowance that does not begin again until
a PIN or the owner's proof arms it, so it is bounded by the allowance in sats;
the card's log has every one of them, and `REFRESH` ends it. **Rejected:** a
payment with no PIN rolls only when the allowance is armed. It closes this as
well, and it costs the holder: a payment with the PIN spends the arming at its
roll, so the next day's first payment with no PIN would be judged against the
day before's count, and refused for the daily limit after a full day. An owner
who sets an allowance accepts the sat-a-roll walk until that is decided.

**The version is 2.1.** `CashuApplet`'s rule: the version moves with every
wire-visible change of behaviour. Two answers change for the same commands
(`GET_CARD`'s byte 76 after a payment of nothing, its byte 77 after a short
`SET_LIMIT`), and v2.0.0 was released with the old ones. Nothing on the wire
is added or moved: no instruction, length or byte of `GET_INFO` or `GET_CARD`
has a new meaning. No card is in a holder's hands (the owner's statement), so
there is nothing to migrate; the minor is how a reader, and `cardctl
selftest`, tell a bench card left on v2.0.0 from the fixed build. flash-pos,
flash-mobile and Foxy's wallet check the major alone, and take `02 01` as they
took `02 00`. `cardctl selftest` passes 2.1 and later 2.x, and a 2.0 card is
swept and reinstalled. The CAP is `cashu-javacard-2.1.0.cap`.

**The size.** The load file is 20,068 bytes by refcheck's measure (100 past a
multiple of 256), 8 more than 2.0's 20,060. Refcheck accepts it: no size near
it has failed. It has not been tried on the J3R180; it is, with the opener
first, before a 2.1 card is handed out, and the answer goes into refcheck's
table. If the chip refuses it, `sizeTheFile` moves the build to a size that
installs.

**The vectors.** `spec/vectors/transcript.json` is recorded again. It selected
the package AID, which on a chip reaches the opener ([D25](#d25)); every
`SELECT` in it is now by the whole AID `F0 43 41 53 48 55 43 41 52 44 01`, and
it answers `02 01`. It ends with the rollover on the wire: an anchored
`SET_OWNER` (145 bytes, refused first for an anchor without the work), budgets
of 0 and 31 refused, the thirteen-byte `SET_LIMIT` with a budget of 1, the
four-byte form leaving it, a payment of nothing that rolls nothing, a roll
that spends the budget, a day that then stands (`6A8F`), `REFRESH` by the old
owner's key refused and by the owner's taken, and the day rolling again.
`owner.json` gains the thirteen-byte limit, `CashuCard/refresh` over a header
and the anchored `SET_OWNER`'s 145 bytes. `secret.json` and `headers.json` do
not depend on the AID or the rollover and are as they were.

**Cost accepted.** A `SET_LIMIT` says what the budget is afterwards only when
it carries the byte, which the architect's decision 2 had wanted of every one.
flash-mobile, Foxy's wallet, `cardctl --budget` and the bridge's fixtures send
the byte every time; a wallet that does not sends the limits it means and
leaves the budget to the owner.

---

## <a id="d27"></a>D27: The phone installs over SCP02, with a DES of its own

**Decided (ENG-738):** the phone-side provisioner talks to the card manager over
GlobalPlatform SCP02, now, with a table-driven DES vendored in `tools/cardkit/gp/des.ts`:
plain TypeScript, no dependency, the same code on Hermes and in Node. It is held to
FIPS 81's vectors and the NIST SP 800-67 example, to node:crypto on random keys and
data, and, at gate H0, to the owner's `gp -d` captures of the spare
(`tools/cardkit/gp/test/fixtures/README.md`).

**Why SCP02.** It is all the J3R180 offers. The owner's `gp -i -v` of the spare (CPLC
serial 09336320, 2026-10-17): `Supports SCP02 i=15 i=35 i=55 i=75`, card data
`GP SCP02 (i=55)`, key set version 01 with three DES3 keys of 16 bytes (IDs 1 to 3),
sequence counter 0009, and no SCP03 and no AES set.

**How.** C-MAC only (EXTERNAL AUTHENTICATE P1 `01`), three keys, no R-MAC, the ICV
encrypted from the second command on, and the card's pseudo-random challenge taken as
it comes. The host cannot read i from INITIALIZE UPDATE, which reports the protocol
alone, so nothing depends on it. The C-MAC covers the header as sent (CLA `|04`,
Lc + 8): GlobalPlatformPro v25.10.20, the gp both J3R180 hardware reports ran, does
that for every SCP02 i (its `SCP02Wrapper.setVariant` sets `macModifiedAPDU` and `icvEnc`
whatever it is given), although a reading of the specification's bit b2 says the
other header for i=15 and 55. The option is kept (`macOverModifiedApdu`), and the H0
transcript test decides it on the card's own answers. The commands are gp's byte for
byte as gp puts them on the wire, and there every command under the C-MAC carries
Le `00`, outside the MAC: gp's `GPSession.transmit` rebuilds each command it has
wrapped with Le `00`, whatever it was built with. So EXTERNAL AUTHENTICATE, INSTALL
[for load] to the ISD with no hash and an empty token, LOAD in blocks of 247,
INSTALL [for install and make selectable] with privileges `00` and parameters
`C9 00`, DELETE `80 E4 00 00`, and PUT KEY in place (P1 and the new version both
`01`, each key under S-DEK with its check value, as `gp --lock` does on a card whose
set is version 01) all end in `00`.

**What binds it.** A failed login counts towards a lock that is for good
([`FORK.md`](../FORK.md)). So the card cryptogram is checked on the phone before
EXTERNAL AUTHENTICATE is sent, and wrong keys send nothing more; nothing is retried
(a repeat also breaks the MAC chain); after wrong keys or a refused login the app does
nothing until it is restarted; and a key rotation finds the card's set from one
INITIALIZE UPDATE checked against both sets, so a PUT KEY whose reply was lost costs
no failed login. DELETE names six AIDs (the card's three instances and package, the
hello applet and its package) and never the ISD. A card applet is removed only with
Replace on and `GET_INFO` empty: no unspent or spent piece, no owner, no PIN, no
record. A card that holds anything is never swept. The load file's sha256 is checked
before the first APDU.

**Rejected.** des.js (last released in May 2023) and crypto-js (no longer
maintained, by its own README): a cipher that guards the card manager, from a
package nobody is looking after, when the cipher is a page of tables a test suite can
hold to the published vectors. A native crypto module (iOS CommonCrypto, Android
`javax.crypto` through a bridge): a native build on both platforms for one cipher,
and code the fake card in `gp/test` cannot run. SCP03 now: the chip has no AES key
set, and making one is a PUT KEY of a new key type on the spare, a risk with nothing
in it for the spike. Revisit if a later chip ships a factory AES set.

**Not decided here.** Production key custody, diversification and a journal of
rotations (Phase 4); rotating a field card; a resumable load. The spike's pass bar is
the owner's (iOS arm to done in 45 s or less in 5 of 5 installs, no Android TagLost
in 5 of 5, every drill recoverable), and which fallback is funded if iOS misses waits
for the result. The spare ends as it began: factory keys `40` to `4F`, the 2.1 applet
installed.

---

Small changes: open a PR and reference the decision id (e.g. "revisits D5").

Changes that alter the product's shape, recovery, identity, custody, the
trust boundaries in [`ARCHITECTURE.md`](ARCHITECTURE.md), warrant a **Flash
Improvement Proposal**. That process exists precisely for "large-scale or
cross-team changes", and this project does not yet have one of its own: the
closest is FIP-04, which describes the design being replaced. *(The FIP
repository is internal to Flash.)*

## <a id="d28"></a>D28: 2.1 holds; the 1.21 gaps are kept, with triggers

*Superseded in part by 3.0 ([D183](#d183) to [D190](#d190)): gaps 1 and 6 are
closed by [D185](#d185), gaps 2 and 3 by [D183](#d183), gap 4 by [D186](#d186)
and gap 5 by [D187](#d187). The text below is 2.1's.*

**Decided (ENG-737, 2026-10-19):** the card stays at 2.1. The six gaps Foxy's 1.21
(`06a9ea7` + `6e0b619`, 2026-10-17) closed and 2.1 has not are **kept on purpose**
and recorded here with the triggers that reopen them. No port is scheduled now.

**The gaps kept** (from the 10-17 comparison of getfoxy/card 1.21 against this
repo's 2.1; their line numbers are theirs):

1. **PIN before money:** 1.21 refuses `LOAD_PROOF`, `CLEAR_SPENT`, `LOAD_CHANGE`,
   the owner commands and the INS `22`–`26` family on a PIN-less card with
   `6A97`, and every load wants the PIN verified in the tap; 2.1 lets a PIN-less
   card take loads from any reader, and the next tap after any payment opens the
   gate again (the hole getfoxy/card's `SECURITY-MODEL` #17 names; this
   repo's threat table has no row for it).
2. **Change bound to the mint's key, unblinded on the card:** 1.21's
   `LOAD_CHANGE` (`53`) and 80-byte change record keep the blinding factor off
   the wire; 2.1's `GET_CHANGE` hands every reader the `r`, so "anybody who saw
   the mint's answer could finish the piece".
3. **Reset and record-change gate while change is owed:** `SET_CARD`/`RESET_CARD`
   answer `6A8D` until the change is taken; 2.1 lets both move the refund key
   and the mint from under change still to come.
4. **The allowance counts whole pieces and refills on the PIN:**
   a no-PIN reader cannot burn the allowance "for the price of a few sats".
5. **The owner is claimed in a separate tap:** a till handed the PIN cannot
   make itself owner mid-payment.
6. **The holder's numbers are PIN-protected until an owner exists** (the
   `SET_LIMIT` field flip; small).

**Why hold.** (a) The program's critical path is phone-side provisioning
(cardkit, the ops service, the consumer install flows); a 1.21 port is a
~18-file hand merge with an INS collision (`53` is `REFRESH` here and
`LOAD_CHANGE` there), status-word overlaps (`6A97`/`6A98`) with Foxy's unbuilt
keysets design, a `SET_LIMIT` field flip, and a chip-size trial (~21.4 KB),
weeks of applet work off the critical path. (b) Every 2.1 card so far is an
operator's or a test card; none is in a holder's hand, so the window the gaps
open has no public money in it. (c) 2.2 is tentatively the piece-numbering
freeze (getfoxy/iOS#2) and must also carry the owner-settable tag URL: a full
1.21 port inside the same revision would make the freeze three programs wide
and its silicon re-verification once-only in name only. (d) The gaps' two
security items are exactly what Foxy will want settled before keysets work,
so they belong on the 2.2 scope agenda for agreement with the partner.

**Triggers (any one reopens the decision, in this order of likelihood):**

- Foxy answers on `INS 53` (whose `LOAD_CHANGE`/`REFRESH` reading wins) and on
  the `6A97`/`6A98`/`SET_LIMIT` overlaps, at the 2.2 scope conversation.
- 1.21 (or its rebased form) runs on a J3R180: its chip behaviour stops being
  a draft.
- A card design reaches holder hands while still 2.1: the PIN-less load gate
  (gap 1) requires review before that distribution.
- The keysets design (`b334797`) starts building: its status words must not
  collide with whatever 2.2 decides.

**Rejected.** Porting 1.21 into 2.2 now (the why above; the merge is not a
merge, both sides changed 18 files since `88840aa`). Porting only the
no-new-INS rows (6, 8, 9): cheap, but it defers exactly the two security wins
and leaves `r` on the wire, while still spending applet and review time
off the critical path. Asking Foxy to rebase 1.21 onto 2.1 unilaterally: it
puts a large ask on the partner in the same breath as the freeze talk; the
scope conversation decides the direction first, and the work follows the
decision.

---

## <a id="d29"></a>D29: Key derivation and atomic service escrow

**Decided (ENG-740, 2026-10-19):** the per-card card-manager keys are issued by
one lnflash-operated service (`ops/`), backed by one SQLite DB, built in the
cashu-card tree but extractable with its own lockfile from day one. Keys derive
deterministically from a runtime-injected master (`OPS_MASTER_KEY`) by
HKDF-SHA256, salt is the batch's ordinal salt, info is `"gp-enc"|"gp-mac"|
"gp-dek"` plus the card's ordinal, and the derive-and-escrow is one
transaction, so a lost response re-issues byte-identical sets and no
issued-but-unescrowed state can exist. Key sets are never resident on a phone
beyond the run that fetched them; the phone is the transport (D27), the service
is the vault.

**Original hosting proposal (superseded by [D30](#d30), partner sign-off pending):** a dedicated droplet, never
co-located with the forge mint. The escrow DB holds fleet-wide card-manager keys
and keeps its own perimeter (its own backups, its own alerting). See
[`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md); that document's sign-off gates
Phase 5b. The operator release proceeds separately under D30.

**The retry contract:** the provisioner's registry re-POST is idempotent. An
identical body re-posted returns the stored row; a changed body for an existing
short id is a 409. This is the contract original
[`PROVISIONER-APP.md`](PROVISIONER-APP.md) screen brief named and the outbox
freezes the first body, so a partial field change between retries cannot become
a 409 the bench cannot resolve.

**Why one service, one DB.** The alternative, derive keys on the phone at
rotation time, puts a fleet-wide master (or a per-card KMS round-trip) inside
every consumer app on both platforms; the alternative, escrow on write,
separately from issuance, leaves a window where a card exists whose keys are
nowhere but the phone that just lost the tap. One deterministic derivation and
one transactional write close both, at the cost the threat model states:
whoever holds the escrow holds every card in it.

**Why deterministic derivation rather than random keys.** Random per-card keys
need their own durable storage *before* they reach the card, a lost response
after PUT KEY but before the reply is the exact case that broke the 2026-10-18
drills' model, and HKDF's 32-byte output is what the 16-byte key sets want
anyway. The cost is that the ordinal space is load-bearing: a batch restarted
or programmed out of order can write the wrong ordinal into a card's history,
which the registry cross-checks in tests
([`OPS-THREAT-MODEL.md`](OPS-THREAT-MODEL.md) #5's residual risks).

**Cross-links:** the threat model is
[`OPS-THREAT-MODEL.md`](OPS-THREAT-MODEL.md); the partner conversation is
[`OPS-GOVERNANCE.md`](OPS-GOVERNANCE.md). Master key custody is a config seam
(`ops/src/master.ts`). The KMS/HSM choice remains open behind that seam.

## <a id="d30"></a>D30: Workers hosting and operator provisioning before consumer access

**Decided (ENG-740 Workers port review, 2026-10-20):** target one Cloudflare
Worker forwarding to one SQLite-backed Durable Object. Keep D29's derivation,
atomic escrow and service custody. The Node SQLite adapter remains for local
development and recovery tooling. Partner agreement remains pending; this
amends the engineering plan. Foxy's governance sign-off remains separate.

Ship operator provisioning first. Disable the unauthenticated holder stub on
the deployed service; consumer provisioning in flash-mobile and Foxy's wallet
requires verified identity, authorization for the specific card or attempt,
durable replay rules and interrupted-install recovery. Public identifiers and
factory keys do not authorize retrieval of existing private manager keys.

Deployment requires controlled operator bootstrap, corrected platform adapters
and CI, and a tested complete encrypted recovery export with an independent
copy. The app must preserve attempt identity and pending registry records
across termination without persisting manager keys or PINs. The implementation
order and acceptance checks are in
[`OPS-WORKERS-PLAN.md`](OPS-WORKERS-PLAN.md).

**Why:** the Durable Object preserves the single-writer transaction model
without maintaining a VM. D1 or distributed services introduce another storage
model without demonstrated workload pressure. Retain a VM as the alternative
if custody requirements exclude Cloudflare. Deferring authorization because no
consumer UI calls the stub was rejected: the endpoint itself grants access.
Platform PITR alone was rejected as recovery because it shares the account's
failure boundary. Tests stay focused on business invariants and runtime
differences rather than duplicating every route across both backends.

## <a id="d31"></a>D31: Provisioning identity and recovery belong to a durable attempt

**Decided (ENG-741 contract, 2026-10-20):** use a server-reserved attempt and a
durable local journal to bind one operator/device, batch and ordinal to an
installation. Preserve that identity across lost replies and app termination.
Use composite J3R180 CPLC fields as the pre-install substitution guard, subject
to hardware verification; public CPLC is not ownership authentication. Use the
full applet public key for installation identity and keep the two-byte suffix
for display only. Intentional reinstall creates a new attempt and history.

Commit install/rotation intent before invoking cardkit, because progress
callbacks are not awaited. Keep the inspected pre-install key and replacement
consent separate from the new installation key, so a crash before DELETE cannot
mislabel the untouched old applet as a completed replacement. After rotation
intent, recovery never reinstalls:
refetch the same assigned manager set, match chip and saved applet key, and use
cardkit's offline cryptogram matching to recover PUT KEY uncertainty without
trial logins. Authentication failures quarantine across restart. Completion is
idempotent by attempt, with a frozen record committed before POST.
Recognize identical retries before rejecting stale revisions. Acknowledged
terminal quarantine consumes the ordinal and frees the device for another safe
card while preserving the unresolved chip's block and installation history.

**Rejected:** using a display suffix or changing applet key to identify blank
silicon; treating NFC UID, CPLC or diversification data as authorization;
allocating another ordinal after a timeout; automatically sweeping an installed
applet on resume; persisting manager keys, PINs or tokens to simplify restart;
equating installation/rotation with complete PIN/mint/owner personalization.

The [contract](PROVISIONER-RECOVERY.md) defines proposed service routes, journal
stages, migration and acceptance checks. It records existing code/capture
evidence separately from the pending phone verification and personalization
contract. Those features and hardware checks remain separate delivery gates; the
real batch loop remains gated on them.

## <a id="d32"></a>D32: Reservation scoped HTTP access and paused provisioning after restore

**Decided (ENG-741 service implementation, 2026-10-20):** expose idempotent,
PIN-free provisioning batches and operator/device-bound attempts. Reserve one
active attempt per device, consume ordinals monotonically, bind chip identity,
and retain immutable full-key installation and terminal disposition receipts.
Recognize an authorized identical retry before testing its submitted revision.
Terminal completion requires confirmed rotation and still says
`ready_for_holder: false`; installation alone remains an active recovery stage.

`/keys/issue` requires a known owned attempt and device; numeric batch/ordinal
IDs alone never authorize lookup. Retire the old batch/card POST endpoints with
410 so they cannot bypass reservation and identity checks. Keep legacy reads
operator-scoped and PIN-free. Login supplies stable operator identity; bodies
cannot override the session principal or key environment.

Export version 2 carries provisioning request identities, bindings, revisions,
consumed ordinals, blocked chips and receipts alongside escrow. Version 1 stays
legacy. Every restore pauses provisioning mutations and key reads, permitting
inspection only until reconciliation. An older snapshot cannot distinguish a
genuinely new creation UUID from a retry whose first write was lost. No HTTP
unlock exists; a reviewed recovery admission/client fencing procedure is still
required before reopening the restored service.

**Rejected:** accepting numeric lookup as a compatibility fallback; leaving old
write routes as a bypass; marking an installed-only attempt terminal before it
can retrieve its assigned rotation keys; restoring escrow without workflow
identity; automatically reopening issuance after restoring an older snapshot.
The app journal, personalization and device verification remain separate gates.

## <a id="d33"></a>D33: One awaited nonsecret journal snapshot for phone recovery

**Decided (ENG-741 journal foundation, 2026-10-20):** use one versioned JSON
value in AsyncStorage, with a single coordinator owning its writer. Each
transition awaits replacement of the whole value before its dependent action.
The attempt journal and frozen completion body therefore cannot be committed
independently. Pin AsyncStorage 2.2.0 for the existing React Native 0.77 app.
Its installed Android implementation uses a SQLite transaction; iOS writes
values and the manifest atomically. This source inspection does not prove
power-loss durability on either phone; operator termination drills remain a
release gate. Pods, native builds and device runs remain operator work.

Any failed commit latches the writer until storage is reopened: a rejected
promise may still have committed. Malformed/foreign-scope state cannot be
silently replaced. No journal deletion, account-specific hidden copy or
clear-on-sign-out is provided. Frozen records have an exact PIN-free schema;
quarantine stores controlled reason codes rather than exception transcripts.

**Rejected:** independent writes for stage and completion body; using progress
callbacks as commit barriers; regenerating an attempt after storage failure;
storing bearer tokens or manager keys to simplify restart. The first module
implements one already-reserved attempt. Durable batch creation/progression,
reservation reconciliation, terminal archival, app wiring and physical-card
verification are still required before enabling the real loop.

## <a id="d34"></a>D34: Persist batch creation and reservation before service calls

**Decided (ENG-741 coordinator, 2026-10-20):** the phone's schema 2 snapshot
holds its stable device UUID, scoped PIN-free batch request, pending reservation,
active attempt journal and acknowledged history together under D33's storage
key. The coordinator serializes service calls and journal transitions. Persist
each creation UUID before its POST. After a lost response, repeat that exact
request; once acknowledged, inspect the attempt instead of recreating it. A
missing acknowledged attempt or changed scope stops for reconciliation.

A server reservation consumes an ordinal but does not advance local batch
progress. Save the matching terminal receipt, then archive the attempt and
advance the batch in one replacement. Completion of installation/rotation is
still not personalization. Quarantined/abandoned server states stop this first
coordinator; explicit disposition acknowledgement remains to be implemented.

**Amends D33's no-deletion rule:** an explicit completed-batch close may discard
local acknowledged history only after all ordinals have terminal completion
receipts, no active attempt remains, and the service recognizes the complete
batch. Keep device identity and the service's installation history. Closing or
switching an unfinished batch, automatic sign-out clearing and silent recovery
from corrupt storage remain forbidden. A restored service's admission pause
also prevents closing away the phone's newer evidence.

**Rejected:** two local storage keys for batch progression and attempt state;
creating a new UUID on timeout; treating the service's consumed ordinal as
completed progress; trusting username as operator identity; silently upgrading
an old standalone attempt snapshot without its missing batch evidence. Such
schema 1 evidence is retained and stops for reconciliation. The coordinator,
transport and storage adapter are still not wired into the real screen/NFC
loop; native termination checks and personalization remain release gates.

## <a id="d35"></a>D35: Resume only verified installations and acknowledge quarantine explicitly

**Decided (ENG-741 orchestration, 2026-10-20):** expose injected-session
orchestration without enabling the real screen. Prefetch only the reserved
manager set before arming NFC. Read/match CPLC, then acknowledge service binding
before install intent and authentication. Persist the verified pre-install
inspection state separately from the new installation key. Existing cards require consent naming
the inspected full key, plus the empty-card guards. Never persist manager keys
or APDU transcripts in the workflow snapshot.

Read-only inspection checks the exact 2.1 applet version, 30-byte GET_INFO,
compressed-key framing and tag selection. Service registry acceptance retains
full curve-point validation. An interrupted install is adoptable only when its
full key is new relative to the saved pre-install state and inspection is
complete. An absent, incomplete or untouched old installation quarantines in
this first orchestrator; a partial-install repair helper remains unimplemented.
This deliberately chooses the contract's safe stop instead of an automatic
DELETE/LOAD recovery sweep.

After rotation intent, use the existing factory/assigned offline cryptogram
matcher and never reinstall. A durable rotated state permits assigned-key
confirmation only, without PUT KEY. Persist the GP key version actually
observed during successful authentication and require the frozen record to
match it. Earlier draft rotated snapshots without that evidence stop for
reconciliation; never default them to version 01. Lost record acknowledgements
are resolved by scoped inspection or an exact frozen-body retry without NFC.

Quarantine remains latched across restart. An explicit operator disposition
persists its kind/reason/revision before POST. Save the matching receipt before
atomically archiving the attempt and consuming its ordinal. Retain the chip
binding/history; the service keeps an unresolved chip blocked. D34's completed
batch close may include acknowledged dispositions, without implying every card
succeeded or is ready for a holder.

**Rejected:** retrying authentication after refusal; reloading a card merely
because an install result was lost; reapplying PUT KEY to a durably rotated
card; guessing GP version; automatically advancing past an unacknowledged
quarantine. Screen wiring, native termination drills, cross-phone CPLC evidence
and personalization remain release gates. No hardware actions are authorized
by this implementation decision.

## <a id="d36"></a>D36: Scoped recovery screens with installation disabled until device validation

**Decided (ENG-741 screens, 2026-10-20):** route real operator work through the
single durable workflow, separate from demo batches and the legacy memory outbox.
Load saved evidence before allowing batch creation. A failed native module/load
or poisoned write pauses real work and offers reload, without resetting storage.
Load the native storage/session adapters lazily so an older binary can still
reach sign-in and demo. Keep one workflow writer and operation queue per storage
adapter across React remounts.

Bind visible recovery controls and replay to operator ID, environment and service
origin. Sign-out and demo mode retain evidence. Foreign scopes hide card/batch
metadata and cannot issue recovery requests. An actor change invalidates pending
card work, cancels an armed session and guards subsequent APDUs; an in-flight
command may already have reached the card, so its durable intent remains.
Cancellation during key prefetch prevents a later NFC session from opening.

Retry a frozen record after reauthentication, foregrounding or the retry timer,
without fetching manager keys or opening NFC. Quarantine and disposition remain
explicit actions; progress counts only acknowledged attempts. Summaries and
sharing certify installation/rotation stages only, with no PIN display or
holder-readiness claim. Replacement consent and partial-install repair have no
screen implementation; an existing installation stops for operator review.

The production installation release constant remains false. Batch creation and
card programming both enforce it in their handlers, independently of disabled
buttons. Record recovery and explicit disposition remain available. Enable only
after the approved device CPLC/install/rotation and termination evidence is
recorded; personalization requires its own contract before holder readiness.
No hardware actions are authorized by this decision.

**Rejected:** connecting the existing demo success loop to real NFC; a new batch
when saved storage cannot be read; clearing evidence on sign-out; allowing a
pending session to arm after switching actors; treating rotation receipts as
personalized cards. Software tests do not establish native power-loss durability.

## <a id="d37"></a>D37: Explicit read-only phone identity check with session-owned cancellation

**Decided (ENG-741 validation tooling, 2026-10-20):** add Settings → Read physical
card identity for the approved owner-run phone checks. Opening the screen does
not arm NFC. Only its explicit read action selects the ISD and requests CPLC,
through the existing strict reader. It does not authenticate, reserve an attempt,
fetch keys, change provisioning state or enable the installation release gate.
The action says it reads a physical card even when reached through demo mode.
Display only the resulting public identity and platform/OS; a failed reread
clears the earlier result, with no automatic retry or raw error/transcript.

A diagnostic session has its own cancellation handle. Its cleanup cannot cancel
another screen's session, including when acquisition was refused because NFC
was busy. Cancellation latches before native startup completes and guards
subsequent commands; it cannot retract a command already in flight. Keep the
existing global single-session exclusion and legacy `withCard` API. Disable the
diagnostic entry and handler while the real workflow is busy, and cancel the
probe on unmount without displaying a late reply.

**Rejected:** using a programming reservation as a read-only identity probe;
automatically arming NFC on entry; allowing diagnostic cleanup to cancel an
unrelated session; treating public CPLC as ownership authentication, global
uniqueness evidence or permission to enable installation. This decision ships
software only; native builds and device actions remain the owner's under an
approved device plan. Deterministic interruption tooling remains outstanding.

## <a id="d38"></a>D38: One-shot validation pauses around durable recovery boundaries

**Decided (ENG-741 recovery drills, 2026-10-20):** expose optional awaited
checkpoints after saved install intent, verified installation before its result
save, saved installation, saved rotation intent, verified rotation before its
result save, saved rotation, and the frozen record after the NFC session closes
but before POST. Hooks receive only a boundary name, without keys or transcripts.
Verification-before-save pauses deliberately retain the prior intent as the
durable stage. A checkpoint does not fabricate a successful result or repair
state. Failed commits never reach the subsequent saved-state checkpoint.

The production `RECOVERY_DRILLS_ENABLED` constant stays false independently of
`CARD_INSTALLATION_VALIDATED`. Only an isolated owner-built validation binary
may enable them under the approved plan; iOS validation may use a Release build,
so this is an explicit source build gate rather than an implicit `__DEV__` gate.
Neither gate has a remote or operator UI override. Existing injected test seams
remain software-only. The pause panel is absent by default.

A selected boundary pauses once, showing its name and the actual saved stage.
Keep the workflow operation busy so background record retries and other workflow
actions cannot pass it. Continue deliberately releases the waiter. Stop, actor
change or unmount rejects it and retains evidence; command guards prevent later
card commands. The frozen-record pause is outside NFC. Normal record recovery
can resume after a stopped run, so terminate while paused to exercise process
loss before POST. Pause selection/waiters are memory-only and never survive a
process restart or enter the PIN-free recovery snapshot.

**Rejected:** time-based force-quits as proof of a specific commit boundary;
pauses enabled in distributed production builds; persisting drill configuration
in recovery evidence; a pause that silently enables installation or skips
verification. These hooks do not simulate mid-APDU failure, a lost PUT KEY reply,
or a torn LOAD on silicon. Such drills still need separately bounded hardware
actions/evidence. No native build or physical device action is authorized here.

## <a id="d39"></a>D39: Native safe areas and truthful physical diagnostic framing

**Decided (ENG-741 phone UI follow-up, 2026-10-20):** use a single root
`react-native-safe-area-context` provider and its native SafeAreaView for shared
screens. React Native 0.77's built-in SafeAreaView is a plain View on Android;
the Pixel's edge-to-edge window placed the demo banner under its status bar.
Pin the new native dependency at 5.10.1, update the iOS lockfile and require a
native rebuild before serving this bundle. Apply measured safe areas across
platforms rather than device-specific offsets. Keep the title in normal flex
layout so a long or enlarged heading wraps within its available width while
Back and other controls retain their space. Set status-bar icon contrast from
the active theme now that content no longer supplies a colored backdrop.

The CPLC diagnostic declares itself a physical read-only screen. Its banner
uses a physical-card read-only label even when reached through the historical demo entry.
Ordinary demo screens retain their existing demo banner. Diagnostic content is
scrollable so safe-area padding and larger text do not hide its controls or
identity result. This changes layout/copy only: no automatic NFC request,
service call, authentication, journal transition or installation-gate change.

**Rejected:** keeping “no card” on a screen that reads a real card; positioning
an unconstrained title above Back; hardcoded Pixel/status-bar offsets. The
2026-10-20 CPLC report remains evidence for its original source commit. UI-only
checks of this revision do not count as additional card reads or recovery drills.
D38 records the separate recovery-drill decision.

## <a id="d40"></a>D40: Identity-bound read-only preflight before the first write drill

**Decided (ENG-741, 2026-10-20):** inspect the named card through an explicit
six-command allowlist before proposing installation. Match strict CPLC identity
before selecting the applet; accept only the known 2.1 framing and report public
installation state. Select exactly one named reader, connect once, leave the card
powered state unchanged on disconnect, and never authenticate or retry. Keep
the transport injectable so CI checks command order and stop conditions without
PC/SC. The CLI validates the expected identity before native reader access.

The first-write plan is conditional on this inspection and independent operator
confirmation of disposability and manager-key provenance. Earlier hardware
reports for another serial cannot establish those properties. A present applet
stops this drill because the current UI has no replacement-consent flow.

**Rejected:** broad selftest/info commands for this bounded check, trying keys
to discover their provenance, and interpreting an absent applet as a blank card.
The tool and plan do not themselves authorize physical execution.

## <a id="d41"></a>D41: Replacement review belongs to one inspected installation

**Decided (ENG-741, 2026-10-20):** the real flow may offer replacement only
after its read-only inspection finds a complete, empty installation and the
NFC session has closed. Show the full public chip and installation identities,
explain the identity change, and require an explicit replacement action. Keep
the review in memory, scoped to the reserved attempt, bound chip and current
actor generation. Consume it for one program invocation. Sign-out, service or
demo changes, other workflow operations, ordinary programming and process loss
clear the review; dismissal keeps the existing installation and reservation.

On confirmation, request a new tap. Existing chip binding, exact installation
key comparison and complete/empty-state inspection must pass again before
install intent, factory authentication or mutation. Consent is durably recorded
with the preinstall identity only through the existing install-intent journal.
Interrupted installation keeps its existing recovery rules; the UI cannot
authorize a recovery sweep or bypass the hardware release gate.

**Rejected:** a batch-wide Replace switch, confirmation while NFC remains open,
remembering consent across restarts, and treating an operator chat confirmation
as a substitute for checking the physical card again. Manager-key provenance
remains a hardware-plan prerequisite. Public state alone is insufficient.


## <a id="d42"></a>D42: Show reached recovery pauses in the active iOS NFC sheet

**Decided (ENG-741, 2026-10-20):** validation builds display the reached
armed recovery boundary and current saved journal stage using the existing
native card-message adapter. The iOS NFC sheet covers the React pause panel;
operators need visible evidence of the boundary before terminating the app. Read
the stage from the workflow snapshot at the checkpoint. Limit the message
callback to the lifetime of the card session and clear it in its finally block.
Closed-session checkpoints use the app panel. The independent installation and
recovery-drill release gates remain unchanged.

**Rejected:** timed kills, inferring a persisted stage from the checkpoint name,
and updating a stale NFC sheet after the card session closes. This is validation
observability. An iPhone write drill requires separate hardware evidence.


## <a id="d43"></a>D43: Keep public interruption context visible until the next card run

**Decided (ENG-741, 2026-10-20):** after an interrupted card operation,
show the last known phase label and actual saved journal stage, explain that
card changes may be incomplete, and ask the operator before retrying. Keep
this message through service reconciliation; clear it on the next card run or
actor invalidation. Store it only in memory. The durable journal remains the
recovery authority and quarantined attempts remain stopped.

Only mapped phase names enter the diagnostic; missing or unknown phases are
reported as “Not reported.” No raw error, APDU, response, key material or guessed
failure cause is displayed. Add labels for LOAD and key-rotation phases that
previously had no display label. Phase context is the last emitted phase, not
proof of a completed command, and this revision does not retrospectively
explain Max's initial interruption.

**Rejected:** clearing the interruption during background reconciliation,
logging raw secure-channel traffic, treating an interrupted install as blank,
and resetting the quarantined attempt to enable another installation.


## <a id="d44"></a>D44: The holder wallet controls the owner key

**Decided (ENG-741, 2026-10-20, explicit operator selection):** the holder
wallet controls and recovers the private P-256 owner key. Ops-service continues
to escrow manager keys; those are a different authority. The operator app
completes installation/rotation recording, while the holder wallet performs
personalization in the holder's hands. Existing receipts keep
`ready_for_holder: false`. Define wallet handoff and unknown-PIN recovery in
[the handoff contract](PROVISIONER-HOLDER-HANDOFF.md) before claiming payment
readiness. The real app must describe this boundary honestly.

**Rejected:** issuer custody by default, a temporary issuer owner, deriving
owner keys from the manager-key master, and collecting a wallet seed in the
provisioner. The existing wire permits first-reader ownership of an unowned
card; a host token does not secure unattended delivery. Preserve physical
custody until holder setup or review an additional protection design.
This does not enable consumer manager-key issuance or change the card wire.


## <a id="d45"></a>D45: Portable public configuration values, with bounded read-back

**Decided (ENG-741, 2026-10-20):** cardkit encodes the existing SET_CARD and
13-byte SET_LIMIT values and strictly parses GET_CARD. This layer has no
owner signing, PIN, manager authentication or write executor. It supports sat
unit and printable ASCII mint text, validates wire bounds/design/refund-key
framing, and leaves endpoint policy and curve validation to their own layers.
GET_CARD read-back sends one command in an already identified applet session;
no implicit SELECT clears transient grants, and refusal is never retried.
Comparison covers only record fields, never holder/payment readiness.

**Rejected:** inventing a new wire format, silently coercing or rounding limits,
checking only the record-set flag, embedding a wallet private key in cardkit,
and treating public record read-back as owner/PIN/limit attestation. The codec
defines the future holder-wallet integration boundary. Enabling provisioning
requires separate validation.


## <a id="d46"></a>D46: Inject holder signing after identity and durable intent

**Decided (ENG-741, 2026-10-21):** a portable owner-command boundary accepts
only SET_CARD, full SET_LIMIT and ALLOW_LOAD for an empty unlocked already-owned
2.1 card. Validate/snapshot values, match full CPLC and installation key, await
nonsecret intent commit, request a fresh nonce and delegate the exact
`label || nonce || value` to the holder-wallet signer. Context includes a wallet
key reference and frozen configuration identity. Reject malformed DER proofs;
the card checks their cryptographic validity. Guard each asynchronous boundary
against actor/session cancellation and reject overlapping calls on the same
transport. No retries, manager authentication, PIN operations or readiness claims.

**Rejected:** handing private owner material to the issuer, accepting arbitrary
signing purposes, signing before durable intent, reusing a nonce after refusal,
and treating an owner-command acknowledgement as verified personalization.
The wallet adapter must authorize its key/context/operation; the caller owns
exclusive NFC access and must read back and persist observations. The helper
selects the applet before its nonce, clearing earlier grants; callers must not
assume a preceding PIN or load grant survives that identity check.


## <a id="d47"></a>D47: Operator installation setup exposes only settings it applies

**Decided (ENG-741, 2026-10-21):** hide PIN policy, dollar-limit inputs and
unapplied card-design promises from real installation-only setup. Label the
required mint as a batch reference. Holder-wallet setup applies card
personalization. Keep historical batch/journal/API fields compatible; newly
created installation-only batches send perCard policy and zero dollar limits as
inert metadata, without a PIN. Holder-wallet setup owns the actual settings
under D44. Saved batch configuration is never rewritten by this UI change; demo
design is separate.

**Rejected:** collecting a batch PIN the issuer cannot apply, exposing controls
that imply limits have been set, and migrating existing recovery fingerprints
just to simplify the form. This does not enable holder setup or physical writes.


## <a id="d48"></a>D48: Service-backed mint discovery

**Decided (ENG-741, 2026-10-21):** real batch setup shows only the current
service response or an explicit loading/empty/failure state. Offer a retry;
clear list and selection when the request scope changes. Demo endpoints remain
exclusive to demo mode. Explicit custom mint references remain available and
are metadata only for installation-only batches (D47).

**Rejected:** silently showing public demo mints while real discovery is
pending or failed, and leaving a previous actor/service selection presented as
current. Discovery never contacts any mint; it reads the configured ops list.


## <a id="d49"></a>D49: Service origin is explicit public build configuration

**Decided (ENG-741, 2026-10-21):** the app reads its default service origin
from one public JSON build file. A Node-only tool validates and atomically
writes it; no credentials, network calls or runtime endpoint switch are involved.
Production preflight requires a canonical HTTPS DNS origin without userinfo,
path, query or fragment, and an exported literal-false recovery-drill flag.
Explicit local configuration permits the existing loopback HTTP development
origin or HTTPS local validation. The committed default remains local.

**Rejected:** shipping an implicit phone-loopback production endpoint, relaxing
TLS globally, accepting credentials in a URL, and automatically migrating saved
attempts when the service changes. Existing origin/actor journal checks remain
authoritative. This preflight validates packaging. Deployment still requires
authorization, hardware certification or holder readiness; it does not enable
installation.


## <a id="d50"></a>D50: Export public recovery identifiers through an explicit action

**Decided (ENG-741, 2026-10-21):** expose a versioned support-details share
from a ready, same-actor batch screen. Allowlist public batch/device/attempt and
full card identities, stages, artifact/key-version metadata and receipt-presence
booleans. Never serialize the complete workflow, raw receipts, frozen bodies,
PIN policy/mint configuration, keys or session. Bound recent history to 20
entries and include its total count; original evidence remains on the device.
Sharing is user initiated, disabled during operations and changes no journal or
service state. Foreign-actor/blocked screens do not expose the action.

**Rejected:** copying native app storage for routine operator support, exporting
raw runtime objects, and sending details automatically. This diagnostic is not
a recovery backup, receipt proof or authority to reset/unblock an attempt.


## <a id="d51"></a>D51: Deploy the first remote rehearsal into isolated staging

**Decided (ENG-740, 2026-10-21):** prepare a distinct
`cashu-card-ops-staging` Worker, its own SQLite DO namespace and staging-only
R2 backup bucket through an explicit staging configuration. Reuse shared
operator provisioning and backup logic; the staging entry allowlists those
routes and blocks holder, legacy and anchor routes. Expose only an edge-status
root that does not imply backend readiness. Use independently generated test
master/operator/recovery material; never import Pixel/Max databases or real
card keys. A local-only mint reference supplies metadata for the rehearsal.

**Rejected:** treating a successful port/dry run as deployment, deploying the
production-named configuration to discover a URL, or reusing live validation
secrets. Account selection, resource creation, secret injection and public
nonproduction smoke tests require a concrete approved deployment scope first.
The default production configuration is unchanged. Hardware, holder readiness
and independent production backup custody are separate release gates.

## <a id="d52"></a>D52: Preserve password work factor under the deployed PBKDF2 cap

D103 changes the default Workers credential writer. This PBKDF2 compatibility
path remains for legacy hashes and native cost refusal.

**Decided (ENG-740, 2026-10-21):** retain PBKDF2-SHA256 at 600,000
iterations and the existing stored format. Prefer native WebCrypto; on its
specific 100,000-iteration `NotSupportedError`, use the already pinned
`@noble/hashes` asynchronous PBKDF2 implementation. Other crypto errors still
fail closed. Compare the fallback against Node's native PBKDF2 and exercise
it inside workerd. Record remote bootstrap/sign-in and timing separately:
local runtime acceptance did not prove deployed runtime compatibility.

**Rejected:** reducing password protection to fit the native limit, inventing
a chained KDF, or silently falling back on every crypto failure. The fallback
costs JavaScript CPU; a successful remote smoke test is required before calling
the deployment usable. It does not establish production capacity or abuse
resistance.

## <a id="d53"></a>D53: Bound sign-in separately from provisioning requests

**Decided (ENG-741, 2026-10-21):** allow 30 seconds for operator sign-in,
retaining a 10-second deadline for all other app API calls. An explicitly
injected timeout still overrides both for tests/local clients. Keep abort
racing and timer cleanup; never retry authentication automatically. Remote
staging's unchanged 600k PBKDF2 verification took 8–12 seconds and exceeded
the original universal deadline. A fake-clock regression pins both budgets.

**Rejected:** reducing password strength, extending every reservation/record
request deadline, or removing the sign-in bound. This latency accommodation
is not evidence of production authentication capacity or availability.

## <a id="d54"></a>D54: Organization Vault custody and independent Nextcloud backups

**Custody choice superseded by D55; Nextcloud and the loss-window choice remain.**

**Decided (ENG-740, 2026-10-21):** the operator selected the existing organization
HashiCorp Vault, designated recovery operators, Nextcloud on Start9 for an
independent encrypted copy, and a maximum 24-hour loss window. Vault setup is
unfinished. The copy process does not receive the private age identity.
Record provider/access/runner readiness separately from the selection. The
[recovery plan](OPS-RECOVERY-PLAN.md) proposes 12-hour production exports with
prompt verified copying and freshness enforcement; it changes no live schedule.

**Rejected:** treating a local staging identity as production custody, treating
Nextcloud as offline/immutable, giving the Worker independent-copy credentials,
counting a fresh upload of an old snapshot as a fresh recovery point, or claiming
that nightly export plus delayed copying guarantees a 24-hour maximum. Vault's
own recovery, independent access, retention, alerts and restore/reconciliation
remain release gates that require evidence from the configured systems.


## <a id="d55"></a>D55: Use an organization password manager for recovery custody

**Decided (ENG-740, 2026-10-21):** after clarifying that the HCP account has no
Vault cluster, the operator selected an organization password manager instead.
Use restricted shared custody, designated individual recovery operators, MFA
and a tested emergency-access procedure. The operator confirmed Vaultwarden
on Zion, alongside Nextcloud, and selected a designated recovery operator to
keep a protected offline identity/instructions copy outside that server. Test
recovery without Zion before relying on this arrangement. Confirm collection permissions and account-recovery
features before configuring it. The private age identity stays
out of the copy job and Cloudflare; Nextcloud/StartOS and the accepted 24-hour
maximum remain as in D54. No key is transferred by this decision.

**Rejected:** creating and operating a dedicated Vault cluster solely to hold
this recovery identity, using one person's device as the only recovery path,
or treating selection of a password manager as proof of successful custody.
Retain D54 as history; its initial assumption of an existing organization Vault
was corrected before deployment. Independent copy/restore evidence and
reconciliation/fencing remain required.

## <a id="d56"></a>D56: Inject Android upload signing and reject debug-key releases

**Decided (ENG-741, 2026-10-21):** Android Release builds receive the existing
upload keystore path, alias and passwords only through private environment
inputs. A Gradle prerequisite validates completeness, a readable absolute path
and rejection of the published debug keystore (including renamed copies).
AGP remains responsible for actual keystore/password/alias validation and signing.
Debug builds retain their published development key. No new upload key is
created and no existing signing identity is changed by this implementation.

**Rejected:** committed release passwords, a default local release key, silently
falling back to debug signing, or an optional check that direct Gradle/Studio
Release builds could skip. Store enrollment/certificate continuity and protected
upload-key custody require explicit release review before any distribution.

## <a id="d57"></a>D57: Verify Android API 36 and native alignment on built bundles

**Decided (ENG-741, 2026-10-21):** compile and target API 36 using AGP 8.10.1,
Gradle 8.11.1 (checksum pinned) and the existing JDK 17/NDK 27 toolchain. Keep
application identity, dependency versions, four configured ABIs and physical
release gates unchanged. Verify actual AAB manifest/config and every included
64-bit ELF library using bundletool and llvm-readelf.
Run a path-filtered native CI build for Android toolchain/native dependency
changes with an ephemeral test signer and no store upload or retained AAB.

**Rejected:** changing only the manifest target, suppressing unsupported-SDK
warnings, treating JS bundles as native compatibility evidence, or using
production signing keys in PR checks. Format/alignment validation is not a
16KB-device runtime test, hardware evidence or a distribution-ready artifact.
A maintained React Native/dependency baseline remains part of release review;
this narrow toolchain change does not certify long-term framework maintenance.

## <a id="d58"></a>D58: Make supplied legal links available before sign-in

**Decided (ENG-741, 2026-10-21):** show the operator-supplied Flash privacy
policy and terms links on sign-in and in Settings, opening the system browser
only on a deliberate press. Failed opens show a generic actionable message.
The terms URL is labelled Terms. The operator subsequently confirmed
`support@getflash.io`; expose it through a Support mail link, with a readable
address when the device cannot open a mail app.
The linked policy still needs review against the provisioner's actual data flows
before store declarations and production submission.

**Rejected:** requiring an operator session to reach the privacy policy, calling
a terms page Support, inventing a contact URL, or treating a working hyperlink
as approval of policy coverage or store disclosures.

## <a id="d59"></a>D59: Verify additive independent copies through rclone

**Decided (ENG-740, 2026-10-21):** use a thin Python runner around rclone for
scoped encrypted R2-to-Nextcloud copies. Preserve prior snapshots, immutable
conflicts and interruption evidence. Download and SHA-256-check destination
bytes and their stable manifest before certifying an artifact. Recheck the
newest snapshot each cycle; measure freshness by its source timestamp, never
copy time. Report 18-hour warning, 24-hour failure, failed-cycle and stopped-runner
health. Keep transfer credentials in protected configuration; no recovery private
identity enters the runner. Validate actual transfer mechanics on loopback WebDAV.

**Rejected:** custom S3/WebDAV implementations, destructive sync/pruning,
ETag-only verification, using copy time as freshness, or interpreting local health
as an enforced issuance gate or delivered alert. StartOS packaging/compatibility,
Zion authorization, actual Nextcloud/R2 validation, custody and remote-artifact
restore remain separate required gates. Source time is trusted exporter metadata;
a hash receipt alone does not authenticate age ciphertext or its recipient.

## <a id="d60"></a>D60: Ship Atoll Recovery separately from issuance authority

**Decided (ENG-740, 2026-10-21):** name the StartOS operational companion
Atoll Recovery, with Cashu encrypted exports as its first workload. Publish a
marked test release to the operator's Atoll registry before installation from
that marketplace. Keep the ops-service as a separate future package. Recovery
holds scoped transfer credentials and optional HTTPS notification routing,
never an age private identity, holder key/PIN or service master.

Monitor copy health independently of the copy process. Send sanitized webhook
notifications on state transitions, bounded reminders and recovery; record only
receiver acceptance after HTTP success. Deduplicate routine checks, back off
failed deliveries and invalidate old confirmation when a destination changes.
Expose delivery evidence and backup health separately. A same-host watcher
cannot report loss of its whole host; an external monitor and actual operator
acknowledgement remain operational requirements. A successful webhook response
is not proof that a human read an alert or that issuance has been fenced.

**Rejected:** widening a backup helper into issuer administration, retaining
recovery identities beside ciphertext, silent notification failures, using old
route receipts to certify a new route, or labelling an untested StartOS lifecycle
as a production release. StartOS installation/uninstall and backup/restore,
actual Nextcloud/R2 access, custody and authenticated restoration remain gates.

## <a id="d61"></a>D61: Pair backup-only companions and authorize Nextcloud in the browser

**Decided (ENG-740, 2026-10-21):** replace mandatory R2 credential entry in
Atoll Recovery with issuer pairing. Deployment administrators explicitly list
which existing operator principals may approve recovery readers. Provisioning
permission alone grants no enrollment authority. Approval yields a ten-minute,
random single-use code. The companion persists its own random secret before
claiming; retries with the same code and secret recover the same connection,
while other claimants and revoked connections fail. Store only hashes of codes
and credentials and retain the approving operator id. Bound pending enrollments,
connections, request bodies, listing pages and artifact sizes.

The companion credential can only list/download existing encrypted `escrow/`
exports through HTTPS. It cannot issue, export on demand, change custody, read
plaintext keys, or act as an operator session. Revocation is independent of
operator sessions. Responses are private/no-store and no redirects are followed.
Existing R2 configuration remains available as an advanced/offline-source option;
verified destination/source changes still require reviewed migration.

Use Nextcloud Login Flow v2 for browser approval and automatic private delivery of
an app password. Verify the authorized principal is non-admin before saving it;
revoke accidentally authorized admin tokens. Persist a successful poll privately
before changing configuration so a lost local action result can be resumed.
Discovery and browser authorization do not create a restricted account: until the
Nextcloud package exposes a reviewed provisioning action, dedicated account
creation remains a one-time administrative step. Never mount Nextcloud's data or
retain its administrator credential as a shortcut.

**Rejected:** handing the copier a Cloudflare account token, granting all card
operators enrollment rights, public backup URLs, automatic source retargeting,
recovery identities in the companion, and treating browser approval or local
copy status as authenticated recovery or an issuance fence. An issuer API outage
can delay new downloads; existing independent Nextcloud copies remain usable,
and the advanced direct-R2 path remains a reviewed fallback. Hosting issuer and
backup storage on one StartOS server would still require an off-server copy.

## <a id="d62"></a>D62: Use scoped NTFY publishers for local recovery notifications

**Decided (ENG-740, 2026-10-21):** use the existing Start9 NTFY package for
Zion notifications. Atoll may call its dependent Provision Publisher action
only for its own package id and one fixed recovery-health topic. Persist the
write-only token privately; publish over verified HTTPS with Bearer authorization.
Validate NTFY's bounded receipt matches the topic before recording acceptance.
Keep generic JSON webhooks available, with independent generation-based receipts.
Publisher permissions do not include reading topics or administering users.

**Rejected:** an unauthenticated topic, an administrator token in Atoll, secrets
in query parameters, or a bespoke notification service. Local NTFY acceptance
is not evidence that a person received a push. Zion shutdown also stops NTFY;
whole-host failure requires an independent monitor. Browser/mobile subscription
and an actual received-alert check remain operator acceptance steps.

## <a id="d63"></a>D63: Enforce public build configuration in native Release paths

**Decided (ENG-741, 2026-10-21):** run the existing public HTTPS-origin and
literal-disabled recovery-drill validator from native build prerequisites,
not only an optional preparation command. Android Release pre-build, signing
validation and JS bundling depend on the check. Xcode's bundle phase loads
React Native's Node environment and checks every configuration except Debug
before invoking the bundler, including custom archive configurations. Debug
keeps local validation support. The validator reads the same source files Metro
bundles; it never contacts the service or handles signing credentials.

**Rejected:** optional preflight, a Release bypass for local diagnostics,
changing the committed localhost default to an unapproved production origin,
and treating a syntactically valid public endpoint as reviewed deployment or
hardware evidence. This adds no phone operation, signing change or store upload.

## <a id="d64"></a>D64: Declare the provisioner's first-party operational data

**Decided (ENG-741, 2026-10-21):** replace the empty first-party collected-data
array with operator IDs, device/chip identities, submitted batch configuration
and operational activity, using Apple's User ID, Device ID, Other User Content
and Other Usage Data categories. Mark them linked to the operator, for app
functionality and not for tracking. Remove the unused location-purpose string;
NFC access and the existing required-reason API entries remain unchanged.
Document the mapping to the actual requests and persistent records.

**Rejected:** declaring no collection because there is no advertising SDK,
calling an installation UUID anonymous, leaving location copy that describes
NFC, or treating a plist change as policy approval or completed store disclosure.
Final deployed hosting, SDK aggregation, retention and policy coverage still
need release review. This does not add data collection or a permission request.

## <a id="d65"></a>D65: Keep laboratory card writes out of distributed builds

**Decided (ENG-741, 2026-10-21):** add a literal-disabled bench gate independent
of physical installation validation. Hide the bench entry, reject navigation
and check the gate inside the handler before opening NFC. A directly mounted
disabled bench cannot initiate or cancel a card session. Native Release
preflight requires both bench runs and recovery drills disabled. Read-only
identity and the reservation-based operator coordinator remain separate.
Approved laboratory Debug builds may explicitly enable the bench gate; no
production, stopped-card or hardware authorization is inferred from it.

**Rejected:** leaving spare-card install/key-rotation controls reachable through
demo mode, hiding only the row, relying only on disabled native buttons, or
using a development bench to evade durable attempt and quarantine contracts.
The regression invokes all three write handlers directly and proves no NFC
session opens. No card operation was performed while implementing this guard.

## <a id="d66"></a>D66: Bind recovery evidence to the encrypted source snapshot

**Decided (ENG-740, 2026-10-21):** return the consistent database snapshot time
from the exporter and store it with the armored ciphertext SHA-256, UTF-8 byte
length and metadata version in the same conditional R2 creation. An existing
object is never overwritten; failure does not advance export-success status.
The metadata also binds the stable issuer UUID; evidence for another issuer or
without that binding is ineligible even if the object is accessible in the bucket.
The snapshot timestamp uses Unix seconds and precedes encryption. Existing
exports without metadata remain downloadable but cannot serve as validated
freshness evidence. This metadata alone does not attest independent storage or
enforce an issuance fence; those remain the next implementation slices.

**Rejected:** inferring snapshot time from the filename, R2 upload time or the
copier's clock; using the plaintext byte metric as ciphertext length; and
silently reclassifying legacy downloads as verified independent copies.

## <a id="d67"></a>D67: Grant copy-attestation authority separately from backup reads

**Decided (ENG-740, 2026-10-21):** append a default-disabled capability to
recovery connections. Only a deployment-allowlisted recovery administrator can
grant or remove it. Old and newly paired readers remain read-only until that
separate grant. Removing/regranting authority discards its prior copy evidence.
Readers may retrieve source metadata; an authorized copier may attest only the
exact object, source snapshot timestamp, digest and byte length validated against
R2. Missing/legacy metadata and future snapshots fail closed. Persist only the
newest source snapshot per connection, rechecking authority transactionally after
the asynchronous storage read. Credential revocation makes its receipts ineligible.

The receipt is a trusted copier's assertion that destination read-back succeeded,
not proof of Nextcloud possession. No destination credentials or private recovery
key enter the issuer. This extends D61 only for deliberately granted connections;
ordinary backup readers still cannot mutate issuance or trigger exports. Issuance
enforcement and Atoll receipt delivery remain separate implementation slices.

**Rejected:** automatically upgrading paired readers, treating caller timestamps
as source evidence, keeping receipt health across capability removal/regrant, and
letting an older retried copy replace a newer snapshot.

## <a id="d68"></a>D68: Fence new issuance on the age of independent-copy evidence

**Decided (ENG-740, 2026-10-21):** add an opt-in issuer-specific policy to the
shared database domain. Only receipts from a live, currently authorized copier
for that issuer count. Missing evidence, future source times and source age of
24 hours or more fail closed. Evaluate inside batch creation, new reservation
and key-disclosure transactions, including the legacy internal key helper.
Return HTTP 503 `independent-backup-stale`. Workers additionally require the
configured policy issuer to match their recovery issuer. No deployment enables
this policy automatically.

Matching batch/reservation replay may return existing state without allocating
more work. Inspection, outcome recording and terminal dispositions remain usable;
the recovery-required fence still takes precedence in the provisioning flow.
There is no stale-backup key-disclosure exception for interrupted installs.
Keys cached earlier on a phone cannot be remotely revoked by this check, so the
remaining mobile refusal handling and staging drill must precede production
activation. Export status reports independent-copy health separately; export
success alone cannot satisfy the policy. Restored snapshots contain no copier
credentials or receipts and retain the recovery fence.

**Rejected:** applying the check to every writable operation, silently enabling
it on staging, counting receipt time instead of source time, granting retry
requests unrestricted key access, or calling a server-side check proof that a
phone with previously cached keys has stopped.


## <a id="d69"></a>D69: Submit copier evidence only after destination read-back

**Decided (ENG-740, 2026-10-21):** add an explicit, default-disabled issuer
receipt option to the encrypted-copy runner. Submit only after both ciphertext
and manifest have been fetched back from the destination and verified. Match the
issuer's bounded metadata against the actual ciphertext before submitting. A
failed delivery leaves the cycle unhealthy and retries the immutable copy on the
next cycle; an old source cannot become fresh because delivery is recent. Keep
existing destination manifests stable while using the accepted exact snapshot
time for local health, including migration from filename-based local health.

**Rejected:** posting immediately after upload, advancing health despite failed
receipt delivery, silently enabling the capability for existing installations,
rewriting immutable manifests during migration, or treating this source change
as an installed-package upgrade or production activation.


D69 compatibility clarification: verified legacy archives remain copyable when
receipts are enabled, without becoming eligible evidence. An ineligible newest
export fails health; older ineligible archives cannot invalidate a newer eligible
snapshot. Authorization failure or an unsupported metadata endpoint still fails
the cycle. Missing metadata is never converted to filename-based freshness.


## <a id="d70"></a>D70: Read live backup policy at the authorization boundary

**Superseded for Worker binding replacement by [D71](#d71).** The validated source
accessor remains, but reading the object environment itself is insufficient.

**Decided (ENG-740, 2026-10-21):** keep the shared policy accessor live on Workers,
reading the current class environment on each use instead of retaining a scalar
derived in the Durable Object constructor. Validate the issuer on every read as
well as startup, including its match to the recovery issuer. Node callers may
retain a static startup policy. Both forms use the same transactional gate.

The staging drill showed correct deployed bindings while a warm object still
reported its constructor-cached policy as disabled. Cloudflare documents that
[binding-only deployments may reuse isolates](https://developers.cloudflare.com/workers/runtime-apis/bindings/#making-changes-to-bindings).
A real Workers regression changes policy on an existing object, checks activation,
refusal, invalid-issuer rejection and removal without reconstructing it.

**Rejected:** treating control-plane binding metadata as proof of activation,
requiring manual eviction/reset of durable state, passing client-controlled
policy headers, or silently retaining the old policy until a future restart.


## <a id="d71"></a>D71: Carry current deployment policy over private request RPC

**Decided (ENG-740, 2026-10-21):** the edge handler validates its current policy
binding and passes it plus the current recovery-admin allowlist as private RPC
arguments together with the HTTP request.
The object scopes that value to the single call using AsyncLocalStorage; the
shared transactional accessor reads that scope. Explicit removal overrides an
old object snapshot. Clients cannot set the RPC argument through HTTP. Both
the edge and object validate it, and malformed bindings fail closed. Scheduled exports remain
independent of issuance health. Request/Response RPC preserves streaming for
large encrypted downloads without buffering them into JSON.

A live retest proved that re-reading a warm object's environment reference was
not enough: it retained the old binding object. The regression now supplies a new
edge environment without mutating the object, then overlaps enabled/disabled
calls to check request isolation. Recovery-admin removal also takes effect on
the warm object without granting authority from stale bindings. This matches
the platform's documented
[Request/Response RPC support](https://developers.cloudflare.com/workers/runtime-apis/rpc/#readablestream-writablestream-request-and-response).

**Rejected:** trusting the constructor snapshot, client policy headers, a shared
mutable current-policy field, separate configure-then-fetch RPC calls that can
interleave, resetting durable storage, or falling back to an older ungated path
when a new RPC method is unavailable during deployment.

## <a id="d72"></a>D72: Read offline recovery identities from protected local files

**Decided (ENG-740, 2026-10-22):** the offline Node restore CLI accepts
`OPS_RECOVERY_IDENTITY_FILE` as an alternative to the existing secret-manager
environment input. The path is nonsecret; identity bytes stay inside the restore
process and are never passed as arguments or printed. Reject simultaneous
sources rather than selecting one implicitly. Open the file without following
symlinks or blocking on a FIFO, require a private regular file, bound the read,
and authenticate the artifact before opening the destination database.

The existing empty-service restore, disabled credentials and recovery-required
fence remain unchanged. This makes the operator's protected offline copy usable
without pasting a key into a terminal. It does not certify the pending
separate-machine restore, authorize access to a drive or service, create a
production identity, or reopen a restored service.

**Rejected:** key contents in command arguments, automatic precedence between
two sources, silently relaxing file permissions, reading unbounded special
files, exposing filesystem/crypto exception details, or treating a software
regression as disaster-recovery evidence from another computer.

## <a id="d73"></a>D73: Keep separate issuer copy histories in Atoll Recovery

**Decided (ENG-740, 2026-10-22):** retain the existing staging issuer and its
nightly export while preparing production alongside it. Atoll's additional
issuer setup uses a separately paired reader, a distinct Nextcloud directory,
and its own copy/notification state and health checks. Sharing the dedicated
Nextcloud account and notification route does not share copy receipts or
freshness evidence. Additional issuer notifications name their backup source.
Existing verified source/destination coordinates remain fixed; re-pairing the
same coordinates may rotate credentials without replacing evidence. A lost
claim reply reuses its privately journaled device secret.

The additive capability preserves staging history. It needs package/runtime
verification before production copy health can be accepted. The operator
approved freeing `meridian-jabari`'s cron for production, leaving the staging
schedule intact. Production's required-copy gate remains closed until its own
authorized reader verifies a fresh artifact.

**Rejected:** retargeting the verified staging source in place, deleting its
history to permit setup, sharing a state path across environments, treating
staging receipts as production evidence, or removing an unrelated cron without
the operator selecting it.


## <a id="d74"></a>D74: Enable installation in operator-approved internal builds

The operator explicitly requested enabling installation after build 3 shipped
with it disabled. Enable the authenticated coordinator on both platforms for
internal testing. Keep recovery drills and bench writes disabled. Reservation,
identity, replacement consent, quarantine, key recovery and independent-backup
authorization checks remain enforced. No APDU or protocol behavior changes.
This does not authorize operating physical devices.

The Pixel report establishes one successful composite installation/recovery run.
The Max report records an interrupted installation and quarantined attempt, not
a successful full iPhone drill. Internal enablement is an explicit operator
decision within those recorded limits. Hardware certification requires its own
evidence. Public publication and holder readiness remain separate decisions.

Rejected retaining the global block for an operator-authorized provisioning
test. Rejected enabling laboratory controls or bypassing stopped-card evidence.

## <a id="d75"></a>D75: Deployment-designated operator administration

Provide a same-origin web console at `/ops/operators` over the shared Node and
Workers administration API. `OPS_OPERATOR_ADMINS` is a separate deployment-owned
JSON allowlist of exact operator names, empty by default. Backup-reader admin
permission confers no operator-management permission. Forward the live binding
through private Worker-to-DO dispatch, including explicit removal; never trust
an HTTP header or a client-supplied role. Recheck both session and policy after
asynchronous password hashing before the transaction commits.

Administrators can list/create operators, reset passwords and disable/re-enable
accounts. Roles are not editable in this console. Password resets preserve the
account's disabled state. Access changes revoke all affected sessions, and
login checks disabled state again after password verification. Disabling oneself
is refused; an active administrator always remains. Accounts are never deleted,
so card, batch and recovery references remain valid. Successful mutations and
audit events commit together; audit events contain IDs/actions/times, never
passwords or password hashes. Deployment-only emergency credential recovery
continues to preserve disabled state.

The browser keeps its bearer only in memory and uses same-origin authenticated
JSON calls, no authentication cookies or browser storage. Password fields clear
on submission, output uses text nodes, and a restrictive hashed-script CSP
blocks framing and third-party resources. Sign-out revokes the session.

Recovery export v3 preserves disabled flags and the administrative event trail;
passwords, password hashes and sessions remain excluded. Updated restore tools
accept v1/v2/v3, restore credentials disabled and retain the reconciliation
fence. Older restore binaries cannot read v3; recovery must use this revision or
later. Atoll copies opaque encrypted objects and requires no format change.

Rejected deleting operators, promoting ordinary operator tokens, or overloading
the backup-reader allowlist. Rejected a native-only admin interface that would
require an app-store release for routine account maintenance.

## <a id="d76"></a>D76: Task-oriented operator workspace without a new hosting surface

Replace the initial administrative form with a responsive, branded workspace:
operators, recent installation attempts and access activity have dedicated
views, search/filter controls and focused account/detail dialogs. Account
creation/password reset require explicit password-vault handoff acknowledgement;
editing a password invalidates that acknowledgement. Native dialogs replace
browser confirmation popups, keeping consequence text and keyboard focus within
the relevant workflow. Partial refresh failures remain visibly distinct from an
empty result, and successful mutations are not reported as failed just because
the following refresh fails.

Keep the existing APIs, deployment-controlled admin grant and server checks.
The client retains its bearer only in a closure, clears displayed account data
on sign-out/expiry, and holds no credentials in browser storage. Render dynamic
text with escaping; compute CSP hashes over the exact served script/style.
Use local icons and system fonts, no third-party resource or analytics requests.
Read-only attempt details do not add a quarantine-clear or card action.

Rejected introducing another framework, asset host, CDN or authentication layer
for this console. The Worker continues serving one same-origin page, with its
source separated into readable client/style/icon modules. A single optional
Chrome acceptance journey runs against a disposable localhost fixture, covering
actual admin workflows, authorization, keyboard/mobile behavior and partial
refresh failures. It adds no browser dependency or additional CI matrix.

## <a id="d77"></a>D77: Wallet-neutral provisioner administration

The administration console uses Cashu Card Provisioner naming and the Cashu
logo published at https://cashu.space/cashu-no-bg.png, bundled locally with
source attribution and its checksum. Wallet-specific names and marks are
removed: the provisioning tool serves the card protocol independently of
the holder's wallet. Keep the existing workspace design and authorization
boundaries; do not imply that a particular wallet has been certified.

Rejected retaining a wallet sponsor's branding because it implies exclusive
wallet affiliation. Remote image loading is unnecessary; the bundled image
works without a third-party request and CSP permits only data images.


## <a id="d78"></a>D78: Cashu Card visual identity and console domain

Keep the original Cashu mascot, set in a fine card frame beside a compact
wallet-neutral cashucard wordmark. The sign-in illustration is made from
HTML/CSS with a single entrance and foil pass, plus a hover response. No
external scripts, fonts or image calls are added. Motion settles within
three seconds and is disabled for reduced-motion preferences. The signed-in
brand stays still until hovered, so administration remains focused.

Prepare ops.cashucard.org as the console's custom domain. Serve the console
at both / and /ops/operators without redirects or an API origin change.
Activate the custom-domain route only after the domain is an active zone
in the existing Cloudflare account. Retain workers.dev for current mobile
clients and backup pairing; switching their origins is separate work.

Rejected a continuously animated mascot, which distracts during operations,
and a new frontend framework or remote assets for a small visual change.


## <a id="d79"></a>D79: Plain administration copy

Apply the Ajene copy rules to the console: descriptive headings, concrete
actions, full sentences and a single contextual explanation of each boundary.
Replace slogan fragments and broad wallet claims with the tool's actual tasks.
Keep card-state warnings and session consequences beside the relevant actions.
Use explicit unavailable/loading labels instead of em-dash placeholders, and
ask operators to check saved results before retrying an uncertain request.

Rejected retaining marketing slogans in administration screens because they
obscure the account and provisioning tasks operators came to complete.


## <a id="d80"></a>D80: Public Cashu Card protocol website

The content layout and motion described below were superseded by D81. The
separate hosting, public source mirror and asset decisions still apply.

Publish a wallet-neutral protocol introduction at cashucard.org, separate from
ops.cashucard.org and its authenticated service. Keep a public source mirror
in website/ with locally hosted fonts, the original Cashu mascot and native
HTML/CSS/SVG card artwork. A buildless site avoids runtime dependencies and
keeps the main content readable without JavaScript. Interactive protocol and
audience tabs explain the implementation roles; motion is finite or driven
by visitor actions and supports reduced-motion preferences.

The site links to the draft proposal, wire reference, test vectors, simulator,
MIT license and security model. State the draft status and offline settlement
risk where they are explained; make no wallet certification or adoption claims.
The source is packaged and published with Sites, with its returned apex and
verification DNS records on the existing Cloudflare zone. Keep the ops custom
domain and service bindings intact. Rejected a combined public/admin backend,
external frontend dependencies and continuously running decorative animation.

## <a id="d81"></a>D81: Compact visual story for the public protocol site

The four-stage story and its motion were superseded by D83. The short page
and direct source links still apply.

**Decided (2026-10-22):** Keep the public site to roughly two desktop screens:
a brief hero, one four-stage visual story, and direct links to the draft
protocol and public implementation repositories. The story shows the applet
moving from provisioner to card, proofs moving from mint through wallet to
card, a terminal/card authorization, and terminal/mint settlement. Each stage
names its participants and what moves between them. It plays once when reached,
then stops; visitors can choose a step, pause, or replay. Reduced-motion
preferences disable autoplay and transfer animation.

Link directly to Cashu Card, Flash Mobile, Foxy iOS and Flash POS as
implementation sources, while avoiding claims that every integration is
complete or certified. Keep the draft status, MIT license and separate
operator-console link visible. D80's longer audience tabs, code example and
resource catalogue move to the repository rather than occupying the landing
page.

**Why:** user review found the first flow diagram visually attractive but weak
at explaining the exchange, and the five long sections hid the useful source
links. A focused animated transfer makes the protocol legible with much less
copy. Rejected a prerecorded video for this revision because native animation
stays sharp at phone sizes, loads with the page and lets visitors inspect each
stage without an added media asset.

## <a id="d82"></a>D82: Object-led motion and card finish studies for the public site

The four-stage object animation was superseded by D83. The Ops Sage hero
and unindexed finish studies still apply.

**Decided (2026-10-22):** Use the ops console's restrained sage card as the
public hero treatment. Keep two additional native-art finish studies, Forest
Emboss and Ivory Signal, at the unindexed `/concepts` route for review. The
homepage stays focused on the protocol and retains its roughly two-screen
desktop length.

Replace the three-icon transfer diagram with one card that persists through
all four stages. The provisioner installs the applet, the holder's wallet
loads mint-issued proofs, an NFC tap produces the card's authorization, and
the terminal settles with the mint. Object movement, proof tokens, NFC waves,
anchored callouts and a chapter timer distinguish the events. A settlement
badge appears only in the settlement stage; the tap stage says authorization
is pending mint settlement. The finite playback and reduced-motion controls
from D81 remain.

**Why:** review found the saturated hero card weaker than the existing ops
artwork and the moving-packet diagram insufficiently expressive. An
object-led sequence makes the card's role visible while preserving the short
page, inspectable chapter controls, small payload and wallet-neutral claims.
Rejected a long scroll-locked render sequence and an autoplaying video because
they would expand the page and make individual protocol stages harder to
inspect on a phone.

## <a id="d83"></a>D83: Direct protocol and source landing page

The separate source section was superseded by D84. The removal of the
four-stage story and the direct source links still apply.

**Decided (2026-10-22):** Remove the four-stage “One card. Four moments.”
section from the public site. Keep one concise hero and a plainly titled
“Protocol and code” section linking directly to the draft specification,
card applet and tools, Flash Mobile, Foxy and Flash POS. Describe each link by
its source role without claiming that an integration is complete or certified.
Use clear, concrete calls to action and remove labels that imply a transaction
walkthrough where none is shown. Keep the site readable without JavaScript;
retain the finite hero-card motion, reduced-motion support and the unindexed
card-finish comparison.

**Why:** repeated review found the animated story visually busy and still
weak at explaining the exchange. Its script and controls added length without
helping visitors reach the protocol or implementations. Rejected another
story redesign or video for this revision; the source documents are the
accurate place to learn the transaction flow.

## <a id="d84"></a>D84: Compact grouped source footer

The home page's Flash Mobile, Foxy and Flash POS links were removed by D117,
and the install guide links Flash and Foxy at their own sites (D118). The
grouped footer still applies.

**Decided (2026-10-22):** Put the public protocol and repository links in
the footer instead of a standalone “Protocol and code” section. Group the
Flash Mobile, Foxy and Flash POS links under “Apps”; keep separate Protocol
and Source groups for the draft specification and Cashu Card repository.
The navigation scrolls to this footer. D85 changes the hero's code action to
a direct source link. Keep the link
labels simple and preserve draft status, license and operator-console links.

**Why:** the separate source section gave a small set of links more visual
weight than it needed after the story was removed. A grouped footer makes
the one-screen landing page easier to scan. Rejected individual app cards
because they added bulk and suggested a stronger integration status than
the links alone establish.

## <a id="d85"></a>D85: Direct code action on the short public page

**Decided (2026-10-22):** Make “Browse the code” open the Cashu Card source
repository directly. Keep the footer's grouped source links for visitors who
want a specific protocol or application repository.

**Why:** once the source links moved into the compact footer, that footer was
already visible at common desktop heights. An in-page anchor produced no
visible response to the button. A direct repository link matches its label
and produces a clear action.

## <a id="d86"></a>D86: Name the card innovation and its settlement boundary

**Decided (2026-10-22):** Lead the public site with “Cashu, now on a card.”
Explain beneath it that wallets load ecash onto the card, terminals can accept
a tap offline, and terminals settle with the mint when connected. Keep the
draft-protocol label visible and align the page's description metadata with
that explanation.

**Why:** “Cashu, in your hand” described a feeling but did not explain what
the protocol makes possible. “Pay offline. Settle online.” was shorter, but
could imply that an offline tap is already final payment. Naming the actors
and the later mint settlement makes the distinction clear without adding a
long paragraph to the landing page.

## <a id="d87"></a>D87: Show confirmed LOAD progress in the signed-in provisioner

**Decided (2026-10-22):** Reuse the approved printed-card figure in the real
operator installation screen. Reveal it from left to right and show `Writing
NN%` from LOAD blocks only after each block's successful card response. Keep
the last acknowledged fill on screen when a run is interrupted; reset it when
a new run or operator scope begins. After a restart, the journal confirms
whether LOAD completed but does not reconstruct a partial block count. A full
figure confirms that LOAD finished, while
installation, key rotation, and service recording retain their own stages and
success requirements. Keep the figure's stop and completed rings tied to the
saved attempt state.

**Why:** the figure and progress existed in the demo loop but were absent from
the signed-in installation path. That left an operator holding a card through
the longest phase without the approved feedback. Emitting progress before a
LOAD response could falsely show a block that the phone never confirmed.
Rejected timed interpolation and treating 100% LOAD as a completed card.

## <a id="d88"></a>D88: Make batch count adjustable without cursor placement

**Decided (2026-10-22):** Put decrement and increment buttons beside the
editable card count. Select the whole value when the input receives focus,
allow an empty value while editing, and block batch creation outside 1 to
100,000 cards with an inline range message. Keep the same server range and
batch request format.

**Why:** focusing the default `12` could leave the cursor before it, where
Backspace had no effect. Buttons make small changes immediate; selection on
focus makes a replacement number easy to type. Rejected a slider because the
range is too wide for precise selection.

**Update (D90):** New phone batches are limited to 500 cards. Existing saved
batches retain the earlier range so they remain recoverable.

## <a id="d89"></a>D89: Report bounded provisioning conflicts

**Decided (2026-10-22):** Give each provisioning 409 invariant a stable reason
code. The phone distinguishes an unresolved chip, changed saved requests,
recovery fencing and missing escrow in its guidance. A recovery export made
after a failed operation includes only an allowlisted operation, HTTP status and
allowlisted reason code. This bounded context is saved with the local workflow
so a restart does not erase it. Unknown service reasons are omitted; raw URLs,
error messages, credentials and APDUs are never added. The saved journal,
consent and quarantine rules remain unchanged. The context supplies diagnostic
support data. Recreating or retrying an attempt requires its existing
authorization.

**Why:** a generic 409 message hid whether the service rejected chip binding
or a changed reservation. A saved attempt can have no chip ID when binding
failed before its receipt was stored. Keeping typed, bounded context lets an
operator diagnose the conflict without exporting private request data or
weakening recovery gates. Closing the batch clears the last failure together
with its local attempt history.

## <a id="d90"></a>D90: End unfinished operator batches with a server fence

**Decided (2026-10-22):** An operator may end an unfinished batch only when it
has no active card attempt. The phone saves an ending intent before calling an
idempotent service endpoint. The service stores a closure receipt and refuses
new reservations for that batch. Existing attempts, records and escrow stay
available for audit and recovery; a lost reply replays the same closure. The
screen requires confirmation and states how many card slots remain unused.
New phone batches are capped at 500 cards, and history is shown in bounded
pages. Older saved batches remain valid under their original count limit.
Encrypted recovery exports use format v4 so a restore retains ended-batch
fences; earlier export versions remain readable.

**Why:** an operator who stopped a card or chose the wrong count previously had
no way to leave the batch. Clearing only the phone would make the service and
phone disagree about whether unused ordinals could be reserved. Deleting
escrow or attempt rows would erase evidence needed for recovery. Closing an
active attempt would hide an ambiguous card state, so it must be resolved or
acknowledged first.

## <a id="d91"></a>D91: Gate owned-card reset on exact public state and escrow provenance

**Decided (2026-10-23):** A reset review for a 2.1 card requires the same full
CPLC and applet public key in the card-specific consent and the reviewed escrow
reference. The read-only inspection exposes proof counts and owner/PIN/record
presence. Any unspent or spent proof, missing tag, unresolved attempt, missing
provenance or missing consent stops before card-manager authentication. An owner
or PIN alone does not prevent review when there are no proof slots, because
their removal is the explicitly acknowledged purpose of an owned-card reset. The
escrow reference supplies lookup metadata. Key availability must be established
separately; the service must verify the exact escrow row before releasing a
reset intent.

**Rejected:** treating a wallet's “empty” display, a serial alone, or a
factory-key attempt as authority to delete. Those cannot identify the current
applet or prove its manager keys. Also rejected an automatic retry after an
interrupted DELETE: the card state and durable intent must be reconciled first.

## <a id="d92"></a>D92: Look up reset provenance without returning manager keys

**Decided (2026-10-23):** The operator service offers a read-only lookup by
full CPLC and applet public key. It reports a recorded attempt and escrow
reference only when both identities match and the key row exists. Any active,
quarantined or abandoned attempt on the chip takes precedence and reports an
unresolved state. The endpoint returns metadata only; it cannot authorize a
reset or assert which manager keys the card currently uses. Production,
staging and local service databases must each be checked separately until an
audited historical import exists.

**Rejected:** returning manager keys from a lookup or treating a recorded
installation alone as reset authority. The key set may have changed after the
record, and a later interrupted attempt may have changed the card again.

## <a id="d93"></a>D93: Persist a reset intent before any destructive tap

**Decided (2026-10-23):** The phone keeps reset state separately from its
installation attempt journal. The immutable binding includes the service and
source origins, operator/device, reset ID, full CPLC, old applet public key,
source attempt and card-specific consent. It cannot advance to deletion intent
without a saved service intent receipt. Each later stage advances one step;
a lost DELETE reply leaves `delete_intent` on disk until independent inspection
establishes the deletion state. A stopped or completed journal is terminal.
The journal stores no manager keys or holder secrets.

**Rejected:** storing reset progress only in screen state, reusing the
installation attempt journal, or advancing from intent directly to key
rotation after a lost reply. Those would erase the distinction between a
command being sent and its effect being observed.

## <a id="d94"></a>D94: Persist reset authorization and preserve it through recovery

**Decided (2026-10-23):** The service stores immutable reset intents bound to
the full chip and applet identities, source attempt, operator/device, explicit
consent and the reviewed zero-proof-slot inspection. The initial source must
be an exact recorded installation in this service, with an escrow row and the
same operator/environment. Unresolved attempts, a stale required independent
backup or a restored-service fence prevent authorization. A matching request
replays its original receipt; changed input cannot reuse that identity.

An outstanding intent blocks normal chip binding and new reservations on its
phone. Recovery export v5 retains the intent and validates its relationships;
v1–v4 remain readable. Restore retains the global reconciliation fence even
for an identical authorization retry. This domain is not exposed through an
HTTP reset action until execution and completion reconciliation are present.

**Rejected:** relying on phone state alone, returning keys from the provenance
lookup, or importing historical key material implicitly. Each can lose the
authority or history needed to recover an interrupted reset. Cross-origin
imports and resolving stopped attempts require their own audited contract.

## <a id="d95"></a>D95: Recover applet removal from registry evidence before rotating keys

**Decided (2026-10-23):** Owned-card reset leaves the Cashu applet/package
absent and manager keys verified as factory keys, ready for a later fresh
installation. It rechecks the exact CPLC and installed public key, zero proof
slots, explicit consent and service authority before saving deletion intent.
Tagged GET STATUS then establishes which whitelisted objects remain and that
they belong to the expected Cashu package and ISD. Only present objects are
deleted, in tag/card/opener/package order; each acknowledged deletion is
checked against a new registry observation. Lost replies retain intent, and
the next connection inspects before choosing another command.

After observed removal, rotation intent is saved before PUT KEY. Source and
factory keys are compared to one INITIALIZE UPDATE cryptogram offline;
factory keys are considered only after saved rotation intent. A confirmed
factory state is adopted without another PUT KEY. CPLC is read again before
acknowledgement because factory keys are shared by blank cards. No LOAD is
part of reset. Completion and releasing the service fence remain separate.

Registry commands and parsing are held to the existing owner `gp-list.txt`
capture. Pagination follows the tagged GET STATUS sequence used by
[GlobalPlatformPro](https://github.com/martinpaljak/GlobalPlatformPro/blob/next/library/src/main/java/pro/javacard/gp/GPSession.java),
with bounded continuation and no legacy fallback. Malformed, duplicate,
foreign-owned or unexpected lifecycle evidence stops the reset.

**Rejected:** replaying DELETE after a lost reply, trying factory keys as an
initial fallback, or treating fake-card success as chip evidence. Hardware
execution still requires a named-device plan and card-specific approval.

## <a id="d96"></a>D96: Retain reset completion and release only the matching admission fence

**Decided (2026-10-23):** The service exposes exact operator/device reset
authorization, recovery reads, source-key fetch and immutable completion.
Keys are available only to the unfinished intent's actor and device, behind
restore and independent-backup gates. Completion records assert the exact
removed installation, observed factory manager key version and absent Cashu
package. An identical completion replays its receipt; changed evidence is a
conflict. Completion is accepted when the independent copy becomes stale so
verified work is retained, while restored-service reconciliation still stops
mutations. Completed sources cannot authorize another reset.

Completion releases only that reset's chip/device fence. Old installation
records, escrow, authorizations and results remain; quarantined attempts keep
their existing block. Export v6 preserves both pending and finished resets;
v1–v5 remain readable. No production rollout or phone reset action is implied
by adding the API.

**Rejected:** deleting old attempts to free a chip, returning historical keys
from a read endpoint, or treating a foreign service's public receipt as
automatic authority to clear a target service's quarantine. Historical local
cards should be reset where their keys are retained, with a separate audited
target reconciliation when needed. This avoids an unnecessary key transfer.

## <a id="d97"></a>D97: Preview local escrow recovery and freeze completion evidence

**Decided (2026-10-23):** The local recovery CLI defaults to a metadata preview
and opens no reader. Execution requires explicit consent flags, exact source
and card selectors, and the historical loopback service scope. It creates a
protected source snapshot before migrating the local DB, uses a private
atomic journal with an exclusive invocation lock, and calls the same service
and cardkit domains as the phone. Exclusive SQLite access is held before opening
the reader to prevent concurrent source changes. PC/SC runs through a private, bounded pipe
whose Python bridge permits only inspection, reset and key-rotation commands.
It adds no APDU or retry and prints no key or wire data. Production origins
are rejected by this local-only tool.

Factory verification saves key version and time before completion. That
evidence is immutable through acknowledgement, allowing an identical record
after a lost service reply. A completed invocation returns the receipt without
another reader connection. Pending resets resume from their saved stage only
when the operator explicitly runs the approved command again.

**Rejected:** passing escrow keys to a command line, making a generic APDU
bridge, silently using the local runner for production, or recording completion
without durable verification evidence. The first physical run remains gated by
the [named-card drill](reports/OWNED-CARD-RESET-DRILL.md).

## <a id="d98"></a>D98: Report bounded reset failure phases without printing native errors

**Decided (2026-10-23):** Local reset failures report a fixed operation phase
and a bounded reason code. Reader-not-found, card-connect, transport, command
rejection and source/service checks can be distinguished without key data,
APDUs or arbitrary native exception text. Read-only card refusals may include
their public status word and instruction. Unknown child errors are normalized.
Tests exercise the private pipe with fake executables and preserve a reviewed
journal when startup fails. Reporting does not add an APDU or retry.

**Why:** the first physical invocation stopped before authorization, but its
generic message could not distinguish readiness from an identity or preflight
failure. Repeating that invocation without useful evidence would not improve
recovery. Dumping exceptions or wire data would weaken secret handling.

## <a id="d99"></a>D99: Reconcile a foreign reset through explicit administrator review

**Decided (2026-10-23):** A deployment administrator may release one bound,
terminal chip admission fence after reviewing the original custodian's public
reset completion and a matching, independent CPLC/applet-absence observation
made within 15 minutes. The packet binds the exact target attempt revision,
source origin, reset/source identities, removed applet key, factory-key
verification and original completion receipt. Evidence must follow the target
disposition and precede reconciliation; later target bindings/installations,
an outstanding reset, stale required backup or a restored-service fence stop
admission. The same foreign reset cannot release another attempt.

The administrator attests that the source completion was checked against its
custodian. An unsigned JSON receipt does not authenticate a foreign issuer or
prove factory keys. The independent read checks chip identity and applet
absence only. No key import, card command or automatic cross-service trust is
introduced by this operation.

The original attempt state, revision, binding, disposition, escrow and receipts
remain intact. One immutable reconciliation records actor, packet hash and
time; only its fence flag changes in the same transaction. A partial unique
index continues to prevent overlapping unresolved chip assignments. Identical
retries return the receipt; different evidence cannot overwrite it. Export v7
retains and validates both the released fence and its evidence, while v1–v6
remain readable and restored services remain fenced. A current unbound phone
reservation can resume without creating another batch or installing new app
code.

**Rejected:** deleting history, marking a failed install successful, accepting
foreign receipts automatically, clearing every block for a chip, or exposing
a general database editor. The physical end-to-end run exposed this missing
boundary after a local reset; none would establish why production admission
can safely resume.

## <a id="d100"></a>D100: Audit spent entries without discarding their recovery data

**Decided (2026-10-23):** An empty card's retained spent entries are audited
before preparing a cleanup/reset. A separate read-only tool binds full CPLC,
applet public key, version 2.1, zero unspent value, the expected spent count
and the card's recorded mint. It reads only occupied spent slots, then checks
identity/state again. Private slot material stays in the reader child's
bounded pipe and parent memory; the tool never prints/exports nonces, C,
secrets, Ys, witnesses or arbitrary native/mint errors.

The parent reuses the existing vector-tested format-4 secret/hash-to-curve
implementation on public-data operations only. HTTPS mint origin is explicit,
must match the card record and cannot redirect. Keyset prefixes must resolve
uniquely to sat keysets. Every derived Y must appear exactly once as SPENT in
the bounded checkstate response; pending, missing, duplicate, unknown and
malformed evidence stops the audit. The output contains counts, denomination
totals, time and a digest. Reset and cleanup each require separate authorization.

Default invocation is a preview with no reader/network access. Physical
execution requires its named-card plan and explicit inspect flag. The reader
contains no authentication, write or retry operation. Existing zero-proof
reset gates remain unchanged; any future clearing must obtain separate
authorization and recheck current evidence rather than trust an old report.

**Rejected:** blindly clearing spent entries after a zero-balance display,
dumping a card file into logs, treating a till message as proof for each slot,
or transferring holder/manager keys to perform this audit. The completed
61-sat physical run left 13 spent entries, making this a concrete preparation
step for reusing that card in the hardware video.

## <a id="d101"></a>D101: Separate mobile reset from fresh installation and audit before cleanup

**Decided (2026-10-23):** The mobile app offers a signed-in, card-specific
reset review outside a batch. A fresh installation inspects before binding:
an existing applet is directed to reset without manager authentication,
factory-key replacement, or a new chip fence. Older interrupted installation
journals retain their existing recovery semantics.

Reset requires exact CPLC/public key, the original issuing service and operator,
retained manager-key provenance, explicit erasure/value-handling consent, and
no other saved batch. The read-only service lookup reports actor eligibility
without returning keys, and withholds eligibility during restore, stale backup
or an outstanding chip reset. Missing foreign provenance stops; it is not an
implicit escrow import or a factory-key fallback.

If an otherwise empty card retains spent entries, the app re-reads every slot,
reconstructs format-4 proof identifiers, resolves sat keysets uniquely, and
requires every mint response SPENT. It checks the same record/identity/slot
bytes again before persisting a public digest and performing one sealed PIN
verification followed by CLEAR_SPENT. Noble curves 1.9.7 supplies the same
secp256k1/BIP-340 primitives used by the wallet; existing spec labels and
hash-to-curve behavior are unchanged. No owner key is requested. PINs, raw
proofs, tokens and manager keys stay out of journals, diagnostics and service
requests; only derived Ys go to the recorded HTTPS mint, without credentials,
redirects or automatic retries. Network waiting is bounded.

Cleanup and reset are separate deliberate taps. A lost successful clear reply
can be adopted from the same identity/record and observed zero slots. Remaining
valid entries require a new settlement audit; malformed remnants stop for
review rather than replaying a blind clear. Cleanup never relaxes the existing
zero-proof reset authorization. A separate, retained mobile reset envelope
binds review, cleanup digest and D93's journal to the original actor/device.
It shares the installation coordinator's exclusive queue and blocks new work
until completion. Each destructive boundary commits before its command;
factory evidence is frozen before a completion request. A lost completion
reply replays that record without a card connection or key fetch. Completed
history remains in the service, and a later batch uses the existing fresh
installation path followed by holder-wallet setup.

**Rejected:** routing a provisioned card through factory-key replacement,
calling the whole chip factory-reset, asking for a PIN in a terminal/chat,
allowing pending mint states to authorize erasure, treating the earlier
read-only audit as permission to clear, or claiming simulator success proves
the new mobile hardware path. Release still requires its named-device drill.

## <a id="d102"></a>D102: Turn public card state into next steps without certifying payment readiness

**Decided (2026-10-23):** A signed-in operator can deliberately check a card
from batch setup or Settings. The shared operation queue owns this read-only
NFC session. CPLC and applet selection distinguish absence from an unsupported
version; an unknown version stops before further card reads. A supported card
reports public state and matching service history, with no PIN, authentication,
clearing or spending. A failed new read removes stale results.

The screen distinguishes a new installation review, holder setup, a wallet-linked
empty card, unspent value, retained spent entries, PIN/lock recovery, incomplete
installation and unresolved history. Matching local interrupted work routes to
its saved attempt rather than starting over. Holder instructions do not launch
an installation; eligible reset is a separate review action. Counts are not a
wallet balance, and spent entries do not imply mint settlement. Service history
checks are separate from the physical read; unavailable history cannot authorize
reset. The existing CPLC-only identity screen keeps its narrow command scope.

**Rejected:** one generic “empty/ready” state, treating applet presence as
holder readiness, silently beginning a reset from a status check, or reading
additional applet data behind the existing identity-only control.

## <a id="d103"></a>D103: Migrate successful operator sign-ins to native memory-hard hashing

**Decided (2026-10-23):** Workers uses native scrypt with N=16384, r=8, p=5,
16-byte random salts and 64-byte output. This is OWASP's listed 16 MiB scrypt
profile; its allocation limit is 32 MiB, within the Workers isolate budget.
The profile also fits the previous verifier’s default memory limit; a regression
runs that exact older recipe to preserve credential readability on rollback.
The existing self-describing scrypt/PBKDF2 formats remain readable. The first
successful login for an issued PBKDF2-600k or legacy scrypt-16384/8/1 credential
verifies that exact hash, derives the new one, then rechecks the original hash,
enabled state and key environment in the session-issuance transaction. Only
then does it replace the hash and issue a session. Wrong passwords do not
migrate; concurrent administrator recovery wins. Existing sessions are not
revoked merely by rehashing, and the durable login work budget is unchanged.

If an edge's native scrypt cost cap refuses the profile, an upgrade retains the
old hash without a second PBKDF2 derivation. New credential creation retains
the existing PBKDF2-600k path in that case. A migrated scrypt credential remains
readable through the parameter-identical noble fallback if a later backend
imposes a native cost cap. Unrelated crypto errors fail closed. Missing or
truncated hash/salt fields cannot authenticate as an empty derived key.

**Why:** both native PBKDF2 APIs call workerd's same iteration-cap check;
switching APIs does not remove the deployed JavaScript fallback. The local
public-fixture benchmark shows a substantial native scrypt improvement without
reducing PBKDF2 iterations or changing the password. Deployed edge timings and
native-cap behavior still require rollout verification; the initial legacy
login retains its original verification cost.

Sources: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt),
[Workers Node crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/),
and [workerd PBKDF2/cost checks](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/node/crypto.c%2B%2B).

**Rejected:** lowering PBKDF2 to the native 100k cap, chaining shorter PBKDF2
calls into a different function, storing a reusable password-derived login
secret, skipping verification after one success, or migrating an arbitrary
custom/stronger hash solely because of its format prefix.

## <a id="d104"></a>D104: Explain operator outcomes without changing recovery contracts

**Decided (2026-10-23):** The app and console use plain outcomes: installation
saved, in progress, stopped, administrator review needed and new installation
allowed. A completed install points to holder-wallet setup; historical records
do not claim the card's current balance or owner. A stopped installation does
not imply that wallet use is blocked. Operators can close a finished batch,
check saved work, save a stop or share support details without needing to
interpret rotation records, acknowledgements or reconciliation terminology.

Interrupted work names the last known public step and asks for the same card;
raw journal stages remain in the bounded support export and laboratory drill,
not the normal recovery message. Pending completion records explicitly require
online confirmation without a new card tap. PIN refusal, incomplete cleanup,
mint unavailability and service-history disagreement remain distinct stops.
Sign-in maps known failures to actions and never displays an arbitrary error
payload. The console keeps protocol-neutral branding and its existing CSP.

The read-only reset lookup adds a bounded `blocked_reason` to distinguish the
wrong operator from overdue backup, restore fencing and an existing reset.
`can_reset` retains all previous gates. The app identifies the recorded mint
before checking settlement and explains the limited data sent. Public card
reviews omit credentials/query data in malformed mint URLs; unsupported origins
cannot authorize cleanup. Machine state values, API reason codes, receipt and
journal schemas, revision checks and all destructive consent controls stay
unchanged.

**Rejected:** marking every historical record “ready to spend”, saying a stopped
installation forbids spending, hiding uncertain card changes behind “nothing
happened”, or relaxing a recovery check to make the wording simpler.

## <a id="d105"></a>D105: Keyboard-safe sign-in and removal of demo mode

The operator found Sign In covered by the iPhone keyboard during build 7
acceptance. Keep its primary action outside the scrollable form, inside a
full-screen keyboard-avoiding container on iOS. Android retains native
`adjustResize` without additional keyboard padding. Preserve safe areas, let
fields/legal links scroll, move Next to Password and submit with Go; dismiss
the keyboard only on a valid submission. Do not depend on an extra dismissal
tap or fixed screen/keyboard dimensions.

At the operator's request, remove the design-review demo feature from build 7:
the sign-in door, Settings switch, banner, mode state, placeholder batches,
fake-card generator and legacy fake installation navigation. All app routes
require a real operator session and installation uses the durable workflow.
Keep existing service, journal, scope, consent and card-write checks. Software
fakes remain in the cardkit tests; removed fake UI scenarios are not hardware
evidence. App-review access requires a scoped account and the physical video.
This supersedes earlier demo-mode UI instructions without changing the wire.

## <a id="d106"></a>D106: A rendered film and a step-by-step tap on the public site

**Decided (2026-10-23):** Add two rendered sections below the hero of
cashucard.org, in the manner of daylightfob.com. The first is a 48-second film:
the physical card in a dark studio, its key made on the chip, a wallet writing
pieces into its slots, a tap at an offline till, one signature that burns the
named pieces, and the till settling with the mint later. Each chapter is its
action and then a hold of three seconds or more with one sentence on screen.
Custom controls sit under it (play, sound, timecode, a chapter scrub bar), and
"The film as text" carries its words. It plays once, muted, when most of it is
in view, pauses out of view and holds its end frame.

The second, "One tap, step by step", shows the tap in six steps (select, name,
outputs, sign, check, settle) over 96 rendered frames of the card at a till's
reader, with callouts that follow the card and the till and a panel of the
card's slots. In the last step the card leaves the reader and a night passes,
the light turning to morning, before the till comes online and settles; the
payment is already accepted, so settling needs only the till. Wide screens
scrub it by scroll; narrow screens and reduced motion get a stepper with
Previous and Next; without JavaScript the steps read as a list beside one
frame. With reduced motion nothing plays on its own; without JavaScript the
film keeps the browser's controls. This supersedes D81's and D83's rejection of
a video and D82's rejection of an autoplaying video and a scroll-driven render
sequence.

Both state only what `spec/NUT-XX.md` and `spec/APDU.md` say. The bill is an
exact amount because an offline till cannot finish the card's change, and
acceptance and settlement stay separate events (D86); the steps section states
once that the till carries the risk of a piece spent elsewhere until it
settles. The film and the steps show the protocol itself: wallet and app names
stay off them, and the phone and till screens are generic. Recordings of the
real apps may follow as their own section under the same rule.

The site moves from Sites to a Cloudflare Worker (`website/wrangler.jsonc`)
in the account that runs ops.cashucard.org. Static assets carry `_headers`;
`/film/*` runs a small script that answers byte ranges, with Workers Caching
on, because the asset server answers a range request with the whole file and
Safari on iPhone plays video only from 206 responses. The film's render source
stays private.

**Why:** the user asked for daylightfob.com's motion treatment, then for slower
pacing so each motion can be taken in, for the step-by-step sequence, for
Workers hosting like daylightfob.com, and for no app names. Earlier reviews
found animated diagrams busy and weak at explaining the exchange; rendered
objects with one sentence per beat, chapters that can be chosen, and a stepper
on phones answer that. Playing once and holding the end frame keeps D80's rule
against continuously running decorative animation.

## <a id="d107"></a>D107: Describe operator scope without implying a card-key selector

Settings shows one read-only “Provisioning scope” value from the signed-in
account, with an accessible, expandable explanation. Remove the two “active”
rows: they look like a switch or a scan of the card’s credentials. “Issued”
and “Factory” remain the service’s existing account scope values; neither
label certifies deployment environment or current card-manager keys. Signed-out
Settings must not invent a Factory scope. The help explains why saved batches
and recovery work require the original account/service, and directs card-state
questions to Check a card. No authorization, key derivation, journal or wire
behavior changes.

## <a id="d108"></a>D108: Keep the focused reset PIN visible with native keyboard scrolling

The first physical mobile cleanup succeeded, but the operator reported its
PIN field was covered by the iPhone number pad. Enable the iOS ScrollView's
native keyboard-inset/focused-input handling and interactive dismissal. Keep
Android's native resize behavior without duplicate insets. Add an iOS numeric
keyboard accessory with an explicit Done control that only dismisses the
keyboard; it must not authenticate, clear entries or start a reset. Keep PIN
entry masked and out of storage/sharing. No manual screen measurements, timers,
PIN visibility toggle or authentication change is needed. Preserve the durable
zero-slot review when rebuilding the app after the successful cleanup.

## <a id="d109"></a>D109: Cancel unsubmitted reviews; stop and retain durable card work

Every shipped screen needs an explicit exit appropriate to its current state.
Unsubmitted forms/reviews can be canceled. Durable installation/reset work can
be stopped and left for later, retaining its actor/device/origin binding,
request IDs, evidence, receipts and admission fences. The saved-reset landing
page must offer Stop for now and Settings instead of only Continue. Keep the
original recovery ID even while its local stage still says reviewed: service
authorization may have committed before a lost reply. A UI exit cannot safely
pretend to undo or abandon that service intent. Permanent reset-intent
cancellation would require a separate service contract; no fence is released
by this navigation change.

Stop ends the owned NFC session, invalidates late reads and aborts service/mint
waiting, including body reads. Request cancellation can lose a committed
response, so existing frozen requests and idempotent recovery remain the source
of truth. In-session automatic record retries pause after explicit Stop until
the operator resumes work; reopening can still perform existing network-only
reconciliation. Never automatically arm NFC. Leaving for Settings during busy
card work requests Stop first; hardware Back uses the same action. Sign-in
cancellation clears its input and refuses late session acceptance. Completed
card changes remain in place; no journal, key escrow or recovery evidence is
cleared as an exit shortcut.

## <a id="d110"></a>D110: A phone as the till, the provisioner in the film, where to get cards, and an install guide

**Decided (2026-10-23):** Five changes to cashucard.org.

The film section is black and headed "How it works". The film's scene fades
to black over the outer nine percent of the frame's height, under its text
layer, so the frame has no visible edge on the page, and the screen loses its
outline and shadow. Headlines carry a soft dark halo so they read over bright
objects.

The till, in the film and in "One tap, step by step", is an Android phone
running a point-of-sale app with nothing branded on it. The customer holds
the card to the phone's back, set to one side so its chip shows past the
phone's edge, while the camera watches the screen. The screen's flow follows
flash-pos's card checkout: a sheet asks for the card while rings close on it,
the charge screen shows the card, its pieces and the payment and names each
step, and a check and a green screen mark the payment accepted. It stays the
offline, exact-amount payment of D106: the card is lifted away once the
payment is accepted, and the receipt waits through the night until the phone
is back online and settles, while the phone's clock runs from evening to
morning. In the steps an OFFLINE badge in the frame's top right turns to
ONLINE at that moment. The frames move to `seq/tap-2/` and the film to
`film-2`.

The film's key chapter shows the provisioner (apps/provisioner) installing
the applet: the phone is set down on the card, its installation screen runs
through the app's own phases and writes the card in, and the chip makes its
key as the card's applet is installed. The screen is the app's dark theme
with the Cashu Card's face in place of its branded card art.

A section, "Where to get cards", names the chip the applet runs on (NXP
J3R180) and how to buy it: unfused and initialized, with the default
GlobalPlatform keys over SCP02, which the phone's install uses (D27). It
links one Amazon listing that states those, for testing, and CardLogix and
Feitian's J3R180 on Alibaba for volume, with prices dated 23 October 2026. A
third option, custom printed cards with the applet installed, shows three
made-up designs rendered in the film's studio under a "Coming soon" stamp;
its quantities and its Lightning and Stripe checkouts are placeholders. The
smoke test's word and page budgets grow to hold the section.

`docs/HARDWARE_DEPLOYMENT.md` becomes an install guide on the site at
`/guide`: six steps from a blank card and a reader to an applet that answers,
each command with its expected answer, plus reinstalling, troubleshooting and
reference tables. It follows `tools/cardctl`'s README on PC/SC for macOS,
names no mint in its setup example, and publishes the tracked CAP's sha256,
which CI's `cap` job now checks. It links the ACS ACR122U, the reader the
hardware reports used, on Amazon and at GoToTags. For people whose AI agent
does the work, `/guide.md` carries the same steps as Markdown with the stops
as rules, the page offers a one-line prompt that points an agent at it, and
`/llms.txt` lists it. An MCP server was considered and left for later: the
install is a few `gp` commands an agent with a terminal can already run, and
a server would have to run beside the reader and hold the card manager's
keys.

**Rejected:** a matte on the finished film frames, which would also have
dimmed the corner marks and readouts near the edge; an Amazon search link,
which returns cards that cannot run the applet; the JavaCardOS store and
Smartcard Focus, whose cards are Java Card 3.0.4; and a hand-drawn card with
a dashed artwork box for custom cards, which the user found weak.

**Why:** the user asked for the film's section to be black so its edge
disappears and for it to be headed "How it works"; for the till to be an
Android phone tapped on its back, with flash-pos's screens as the model and a
clear offline and online indicator; for the film's key chapter to show the
provisioner and its words to be readable; and for "Where to get cards" with
an Alibaba option, custom printed cards marked "Coming soon", and the
hardware deployment guide as an easy page on the site, with a reader to buy
and a ready handoff for people whose AI agent installs the applet.


## <a id="d111"></a>D111: Saved operator workspaces and Cards home

**Decided:** signing in lands on Cards. Stop for now and Cancel setup return
there; Settings Back does not reopen an installation. Cards shows a saved batch
or reset, an explicit Continue action, and safe End batch / Close finished batch
actions. Ending still requires confirmation and the existing service receipt;
an unresolved attempt must be finished or its stop acknowledged first.

The original `cashu.provisioning.attempt.v1` key advances to an atomic schema 3
envelope retaining workspaces by exact service origin, operator ID and key
environment. Each workspace contains the existing strictly validated schema 2
batch and schema 1 reset journals. All workspaces share the original device ID.
Legacy journals are validated together and migrated in one replacement; their
original bytes remain in the envelope and the old reset key remains unchanged.
Malformed, unknown-schema, mismatched-device, foreign-bound or unreadable data
blocks card work without clearing evidence. Older binaries reject schema 3;
downgrading requires reconciliation rather than a fresh empty namespace.

Storage adapters bind permanently to one workspace and serialize all envelope
writes. Changing account/service remounts transient workflow state, cancels its
owned session and suppresses late UI results. A late durable reply can update
only its original workspace. Returning to that operator restores the same
request IDs. No session tokens, PINs or manager keys are stored. This does not
relax service device/chip holds: another operator may prepare a separate batch,
but cannot install around an unresolved attempt/reset on the same device.

**Rejected:** clearing saved work, signing another operator into the old batch,
per-account keys that hide pre-upgrade evidence, assigning another device ID to
bypass service holds, and treating Settings as the only exit from installation.

**Why:** #142 reported that Stop for now → Settings → Back reopened saved work,
and changing operator stranded the phone at a foreign-account warning. Shared
phones need independent retained work and a useful landing page, with the same
recovery and account boundaries as before. This changes host workflow/storage,
not the protocol, applet or CAP. Hardware-free tests cover navigation, atomic
migration, reset retention, corrupt data, lost acknowledgements, cross-account
writes and a late old-account reply after another operator has started work.

## <a id="d112"></a>D112: Public cardkit package and independently released components

**Decided:** keep the monorepo, with an explicit `@cashu-card/cardkit` 0.2 API.
Core, optional cleanup and Node-only testing entry points have package exports;
private GP paths are unsupported. React Native selects TypeScript source and
Node selects compiled JavaScript/declarations. App and ops install explicit file
dependencies after building the SDK; no Metro sibling-source alias is required.
The real packed package is tested in ordinary Node, alongside existing GP tests.

Firmware, cardkit, provisioner and ops retain separate manifest versions and
component tags. A guarded release checks exact tag/main ancestry and committed
identity, then requires reusable full CI before artifacts. Firmware publishes the
tracked pinned CAP; host changes do not rebuild/re-pin it. Ops has separate
staging/production bundles, file provenance and an explicit prebuilt deploy.
Mobile candidates use existing signers, committed version/build identities and
explicit store uploads; no automatic build bump or certificate creation remains.
Recovery/master secrets are not part of CI. Environments/signing credentials and
live execution remain separate configuration/authorization steps.

Affected-component CI is a conservative allowlist. UI/docs/site edits avoid
unrelated jobs; protocol, firmware, cardkit, admission/auth/schema, phone recovery
and persistence, recovery contract tests, workflow policy and unknown paths retain
full integration. Missing history runs full; push diffs compare trees directly so
force-push deletions cannot disappear behind a merge-base diff. `CI gate` always
runs and rejects missing/failed/cancelled/unexpectedly skipped jobs. Require that
gate in branch protection instead of individual checks that legitimately skip.

**Rejected:** splitting tightly coupled recovery work across repositories now;
deep relative imports as an API; a single global version/release; publishing a
freshly converted timestamp-different CAP instead of the pinned file; automatic
production deployment/store rollout on branch pushes; and path filters that can
leave required integration checks silently absent.

**Why:** #141 requested clear package boundaries, independent releases, focused
CI and documentation reflecting the shipping system. Architecture/contributor
instructions now distinguish installation from holder-wallet setup and bounded
hardware evidence from simulation. API boundary, diff/gate, version identity,
archive integrity and signing-identity regressions are hardware-free. No protocol,
applet behavior, production data, device or signing-custody change is authorized
by this refactor.


The Simon review follow-up tightens D112: active XML CAP properties, rather than
comments, determine firmware identity; reset/installation/status/home controls
retain full integration coverage; and mobile upload verifies the complete native
artifact set and checksums through the same manifest verifier as ops. Publication
retries reject unfinished drafts instead of reporting a published release.
Ruby 3.3 workflows explicitly use Bundler 2.6.9. The locked CFPropertyList
changes from 3.0.9 (Ruby <3.2) to compatible 3.0.8, and macOS/Linux platform
variants are recorded without moving Fastlane/CocoaPods. Unprivileged native CI
loads the locked release toolchain and round-trips a property list before signing.

## <a id="d113"></a>D113: Website Cashu mascot as the provisioner app icon

The mascot icon was superseded by [D119](#d119), the Cashu Card mark. Opaque iOS
squares, the separate Android foreground and the store-listing checks still apply.

**Decided:** use the exact sunglasses-wearing Cashu mascot served by
`cashucard.org/assets/cashu.png` (SHA-256
`fffab936aede92ad75b199c60ccfa547fee4a2b5bafce525925a0069ff42430b`)
on the website's `#10271E` background. Keep a local source copy and a deterministic
macOS generator for all iOS catalog sizes, Android launcher variants and the
store images. Square iOS/store outputs are opaque; Android adaptive icons use
separate background/foreground layers with the mascot inside the safe circle.
Pixel edges use nearest-neighbor scaling.

**Rejected:** redrawing the mascot or adding wallet-specific branding. The user
asked for the website's existing icon, and the shared provisioner serves wallets
implementing the protocol. This is a visual asset change, with no card/protocol
behavior or app build-number change.


D113 follow-up: store and legacy upload paths now share the same generated Cashu
mascot; the feature graphic uses the same background and Figtree font. Replace
historical demo screenshots/listing claims with current native UI and
installation-only wording. Verify storefront metadata separately from native
launcher assets: Google rejected the mismatched old listing icon even though
build 9 contained the new launcher image. This updates store assets. App
behavior, firmware and the uploaded build 10 binaries retain their existing
versions and hashes.

## <a id="d114"></a>D114: Keep reset results separate from the next card check

**Decided:** keep a completed reset receipt in history. Start each new card
check with a fresh inspection. Show Reset complete when the reset being worked
on finishes. After Check another card or leaving/reopening, start with Check
card for reset; cancelling that new check cannot restore the old success
headline or green card. The old receipt stays available as Share last reset
details. Unfinished resets still resume their original card and never take this
fresh-start path.

Reset preparation checks its caller's cancellation and actor before
looking up eligibility, after that reply and immediately before its first durable
write. A late eligibility reply cannot create a saved reset after Stop or after
leaving the account. Starting another read expires the previous card review and
its consents, including when the new NFC read is cancelled. When a stopped
operation finishes, replace its temporary Stopping notice with the final stopped
or cancelled outcome.

Once a storage write starts, its outcome can be uncertain: retain any committed
reset and recover it with the original card, account and service. Existing saved
resets, service intents, keys and admission fences are unchanged. This does not
add permanent reset-intent cancellation or clear historical saved work (D109).

**Rejected:** discarding a journal on navigation, treating a cancelled service
request as proof that no durable work exists, or leaving the previous card's
consents actionable after a cancelled new check.

**Why:** cancelling preparation could still save a late response, preventing the
next card check. Regressions reproduce that race, a cancelled second NFC check,
Stop during a durable write, and completed-result re-entry/cancel/retry. This is a host lifecycle fix; no protocol,
firmware, CAP, production data or physical device is changed.

## <a id="d115"></a>D115: The protocol's core lives in cashucard/nut as NUT-CCP

**Decided:** the core every card and reader share (selecting the card, card
proofs, reading, paying, the card's own change, loading, card policy and offline
acceptance) is NUT-CCP: `CCP.md`, with its test vectors, in the public
repository [cashucard/nut](https://github.com/cashucard/nut), written to be
proposed to cashubtc/nuts. It keeps that name until the Cashu maintainers assign
a number. `spec/NUT-XX.md` is removed. Its core is CCP.md, and its profiles were
already in `spec/APDU.md`, which now also carries what only NUT-XX.md said: the
owner key's counter byte and recovery from the seed, the one-tap set-up order,
the work a forged header costs, and what a terminal handed the PIN can take.
`spec/APDU.md` stays the reference implementation's command reference and the
home of the owner, clock and limits, and NFC tag profiles until each is written
in cashucard/nut. Links in the docs, the tools, the applet's comments and
cashucard.org point at CCP.md. `test_spec_consistency.py` holds the applet to
NUT-CCP's two card proof secrets, quoted from CCP.md, and SchnorrHWMathTest's
guard against a document claiming branch-free arithmetic reads `spec/APDU.md`.
A change to the core starts as a pull request in cashucard/nut, before any
implementation changes. cashucard/javacard keeps mirroring `spec/`, so its
next mirror drops NUT-XX.md.

**Rejected:** keeping NUT-XX.md as a second copy, which had already drifted
from CCP.md in its version labels, terms and layout; and vendoring cashucard/nut
as a submodule for the tests, which would make every checkout and CI job fetch
the spec when the check needs only the two secret forms.

## <a id="d116"></a>D116: cashucard.org offers the provisioner beside the install guide

**Decided:** the home page's "Install the applet" section (`#install`, the
nav's "Install") gives two ways to install the applet. The Cashu Card
Provisioner, 1.0.0 build 9, is for card issuers with an operator account. It
links the TestFlight public beta, Google Play's testing opt-in for
`com.islandbitcoin.provisioner` and the GitHub release
`provisioner-v1.0.0-build.9` for its files and checksums. The install guide
covers a computer with a card reader. The guide's "What you need" and the
footer's Apps link the section. The page's word and height budgets in the smoke
test grow by what the section measures.

**Rejected:** the stores' official download badges while the app is a beta, and
a Play listing link, which a visitor who has not joined the test gets as not
found. When the app is published, the store listings replace both beta links.

## <a id="d117"></a>D117: The home page's footer lists the provisioner alone under Apps

The install guide's app links were changed by D118, which links Flash and Foxy
at their own sites. The home page's footer still applies.

**Decided (2026-10-24):** the home page's footer drops the Flash Mobile, Foxy
and Flash POS links, so its Apps group holds the Cashu Card Provisioner alone.
The install guide's footer keeps all four, because its step for giving a card
away sends the new holder to the wallets listed there. The smoke test fails if
the home page links any of the three apps. This supersedes D84's app links on
the home page.

**Why:** user review on 2026-10-24 asked for the three app links to come off
the home page.

**Rejected:** removing the Apps group with them, since the provisioner is the
app the home page offers in its install section.

## <a id="d118"></a>D118: The install guide links Flash and Foxy at their own sites

**Decided (2026-10-24):** the install guide's footer links the wallets at
their own sites, Flash at getflash.io and Foxy at getfoxy.io, in place of the
apps' GitHub repositories. getflash.io sends its wallet and its POS to the
same download page, so one Flash link replaces Flash Mobile and Flash POS. The
smoke test holds the guide's Apps to those two sites and the provisioner, and
fails if the home page links either site. This supersedes D117's four guide
links.

**Why:** user review on 2026-10-24 asked for the guide to link the apps'
marketing pages instead of their GitHub pages.

**Rejected:** separate Flash Mobile and Flash POS links to the same page.

## <a id="d119"></a>D119: The Cashu Card mark is the cashew drawn as a chip

**Decided (2026-10-24):** Cashu Card has its own mark: the Cashu cashew, redrawn
as one smooth shape and turned 14 degrees to the left, cut with a card chip's
center pad and contact lines, in a lime-gold gradient. At 40 px and below it
drops the lines and is the plain cashew, because the lines would be under a
pixel wide. `brand/generate.swift` holds the shapes and colors once and draws
the library in `brand/` from them: SVG and PNG masters in color, deep green and
white, the app icon, a social avatar, favicons, the wordmark lockups and the
color tokens. It also draws the provisioner's iOS, Android and store icons and
the Play feature graphic, which now sets its text in Figtree 600. The wordmark
is "cashu" in Figtree 800 and "card" in Figtree 400, from Figtree's variable
font in `brand/fonts/`. The generator replaces
`apps/provisioner/scripts/generate-app-icons.swift`, and the mascot source
`apps/provisioner/assets/app-icon/cashu.png` goes with it. This supersedes
D113's mascot icon.

**Why:** the user asked on 2026-10-24 for a cleaner, modern logo built from the
Cashu cashew and made for Cashu Card, to start a consistent asset library. From
five directions, then three, they chose the chip.

**Rejected:**
- The mascot's sunglasses, which lean on Cashu's community mascot.
- Contactless waves from the cashew, which resemble EMVCo's registered
  contactless indicator.
- A card with a cashew window, alone or with the chip set into it, which reads
  as a card first and Cashu second.
- The cashew as a "c" with the status dot, which says least about cards.

## <a id="d120"></a>D120: cashucard.org, the film and the social kit carry the Cashu Card mark

**Decided (2026-10-24):** the D119 mark replaces the Cashu mascot everywhere
the public sees Cashu Card. On cashucard.org, the header is the brand's
outlined lockup, the tab icons are the brand's favicon set, the hero card wears
the deep green mark where the mascot sat (36% wide, 7% from the right, 17% from
the top), and the install section shows the provisioner's new icon. The film's
card face (`cardart.js` in cashucard-film) paints the same mark in the same
place, so the card in the film, its steps, its screens and the share image all
match; they are rendered again as `film-3`, `poster-3`, `seq/tap-3` and
`og.jpg`. The social kit's clips and stills are rendered again from the new
face. The smoke test holds the header, the tab icons and the hero card to the
mark, and fails if the home page shows the mascot.

**Why:** the user asked on 2026-10-24 for the mark on the site's tab icon and
header, the film's card face and the social kit, right after choosing it.

**Rejected:** the live-text wordmark in the header, because the site's font
files stop at semibold and the mark's wordmark is drawn at 800; switching the
site to Figtree's variable font would have made every headline heavier.
Redrawing `concepts.html`'s finish studies, which stay as the record of the
card before the mark.

## <a id="d121"></a>D121: Cards home offers daily tools and tools return to their launch screen

**Decided (2026-10-25):** Cards shows the signed-in operator's name and service,
the saved batch's mint reference and completion count, and direct entries for
card status and reset. The operator name is a memory-only display value;
authorization and saved-work ownership continue to use the verified operator
ID, service and key environment. A saved reset keeps the primary Continue
action. A saved batch or pending reset disables the separate reset entry.

Card checks remain available with saved work. Tool entries are disabled during
an operation, loading or a workspace mismatch. Reset and installation retain
their build gates. Opening a tool leaves NFC idle until an explicit read;
reset retains its inspection, authorization, erasure confirmation and recovery
boundaries.

Each tool remembers its own launch screen. Reset opened from a card check
returns to that check, which returns to its original screen. Settings Back
still returns to Cards (D111). Reset's idle exit names the destination; leaving
a review dismisses transient evidence while preserving durable work (D114).

**Why:** operators use Cards for everyday work. Routing card checks and resets
through Settings adds taps, while returning every tool to Settings breaks the
path back to the batch or card check that opened it.

**Rejected:** skipping batch review or reset consent, starting NFC on screen
entry, and a shared return destination that could trap nested tools in a loop.

## <a id="d122"></a>D122: Routine app help opens from information icons

**Decided (2026-10-25):** routine explanations move into shared tap-to-read
panels on the shipping sign-in, Cards, setup, installation, card status,
identity, reset and Settings screens. Information icons have labeled 44-point
targets. Panels support scrolling, screen-reader focus, an explicit Close
action, outside-tap dismissal and Android Back. Opening help starts no card
operation or service request.

Cards labels and announces the operator name with “Signed in as”. Dashboard
links follow the configured service. Only the existing production Worker
origin has a display alias to `https://ops.cashucard.org`; other service
origins link to their own dashboard. Cards' account help shows the actual API
origin separately. Changing this display leaves API requests and saved-work
origin/actor bindings intact (D49, D111). Selecting another service remains
build-time configuration. Setup controls accept taps while the keyboard is open.

Errors, disabled-action reasons, live progress, required card-holding
instructions, destructive consent, pending-reset erasure consequences and
recovery steps stay visible. Setup retains its batch review; reset retains its
existing approvals. This change reduces explanatory text on the daily screens.
It does not reduce the number of batch-creation or card-write steps.

**Why:** operator review found the account name unlabeled, the technical API
address confusing and repeated explanations distracting from routine actions.

**Rejected:** hover-only help on phones, moving required consent into a tooltip,
silently switching the API origin, and removing review steps as part of a copy
change.

## <a id="d123"></a>D123: Operators select a service before signing in

**Decided (2026-10-26):** sign-in offers saved service addresses and an explicit
review of a new HTTPS DNS origin. Settings offers sign-out and service selection,
with the existing saved-work confirmation. The build's default service remains
available. Addresses are canonicalized without React Native's incomplete URL
parser; credentials, paths, query strings and fragments are rejected.

Only public service addresses and the selected address are saved in a separate
preferences key. Unreadable preferences block authentication until reloaded or
an explicit selection is saved. A failed selection retains the old destination.
Credential fields are cleared when leaving sign-in; generation and origin
checks reject late replies after cancellation or service changes. HTTP requests
omit ambient credentials, request redirect rejection and refuse redirected or
wrong-URL replies. A service's operator credentials are entered after selection.

Switching requires sign-out and remains blocked by unconfirmed legacy registry
rows. The existing workspace envelope retains each service/operator/environment's
card work with the original device ID. Returning to that service and account
restores its work; addresses and tokens are not reassigned to another service.
Dashboard links continue to follow the selected service (D122).

**Rejected:** retargeting a signed-in session, copying passwords or tokens between
services, clearing journals on a switch, and accepting a redirected reply as
evidence from the chosen service. D122's build-time-only service choice is
superseded; the release preflight still validates the build's default origin.

## <a id="d124"></a>D124: Batch setup reviews and starts the first card in two presses

**Decided (2026-10-26):** Cards → New batch opens one editable mint/count review.
Start & Read First Card creates the batch and starts its first card run. Create
Batch Only saves the same reviewed configuration for later. Both paths take two
presses from Cards with the shown defaults; editing mint/count adds the chosen
input interactions. A fresh form defaults to one card and the service's first
listed mint reference. Approved choices are remembered per service, verified
operator and key environment, then checked against the fresh mint list. A removed
mint requires an explicit replacement; late defaults cannot overwrite edits.

Creation and the first run share one cancellable coordinator operation. The
original request is saved before HTTP, the acknowledged batch is displayed
before the first card run, and actor/generation/cancellation checks run between
creation and reservation. Stop, sign-out and uncertain replies retain the
original work and cannot arm a late read. Reopening or resuming a batch still
requires an explicit card action. Existing chip checks, key gates, readout,
recovery and reset consent remain in force.

The optional count/mint defaults contain public form data in a separate key;
card recovery does not depend on them. Build 11 includes this flow and D123's
service selector, with no firmware, cardkit API or ops-service migration.

**Rejected:** an extra review page for the shipping flow, opening NFC on screen
entry or restart, and chaining two independent operations that could clear a
Stop request between batch creation and card reservation.


## <a id="d125"></a>D125: Sign-in shows the service as a compact connection row

**Decided (2026-10-26):** replace the full-width URL action on sign-in with
an “Ops service” label, a single-line hostname and a separate “Change” cue in
one accessible button. Long hosts shorten in the middle; the full display
address is announced to screen readers and remains available in the selector.
The existing production display alias remains. The row uses the input surface
and a quiet border, with an accent for Change and pressed feedback.

**Why:** the uppercase URL button competed with sign-in and wrapped long
addresses. The row distinguishes the current destination from its action.

**Rejected:** a connectivity indicator without a service check, extra steps to
switch services, and changing API origins or saved-work bindings for display.


## <a id="d126"></a>D126: Provisioner sign-in shares the Cashu Card identity

**Decided (2026-10-26):** use the canonical Cashu Card lockup on the app's
sign-in screen in place of the lightning-bolt placeholder. Bundle exact dark
and light SVG copies from the brand library, with a regression check against
the originals. Use the site's forest, lime and paper colors in a sign-in-only
theme, explicit field labels, and the ops console's left-aligned form hierarchy.
The submit action stays outside the scrolling fields and above the keyboard.

The rest of the app retains its selected theme. Service choice, credential
clearing, cancellable sign-in and recovery ownership retain their existing
behavior. Sign-in adds no network assets or service requests. Build 12 carries
this update because build 11 already has a signed published release; its
artifacts and tag stay unchanged while its store rollout is held.

**Why:** the placeholder icon and black form did not match the Cashu Card site
or the provisioning console. A shared identity makes the product recognizable
while keeping the service destination visible before credentials are entered.

**Rejected:** redrawing the logo, a marketing introduction before the form,
a fixed hero that covers fields when the keyboard opens, and replacing build
11's published artifacts.


## <a id="d127"></a>D127: Every provisioner screen uses the forest palette

**Decided (2026-10-26):** use the approved sign-in forest background throughout
the app, including when the phone is in light mode. One shared theme supplies
forest surfaces, pale text, sage secondary text, lime accents and coral danger
states. Filled controls have explicit foreground colors for readable labels.
Sign-in inherits this theme; its separate light palette is removed. The old
System/Dark/Light selector and its unused state are removed from Settings.

Card tools, service selection, setup, installation, recovery, results, help
panels and the gated bench screen share the palette. The bench's release gate
and hardware handlers retain their existing checks. Card artwork and progress
meaning remain the same. Build 12 includes this refinement before distribution.

**Why:** the operator approved the sign-in background and asked for it on all
pages. OS appearance and per-screen overrides would make the app inconsistent.
D126's sign-in-only theme scope is superseded by this decision.

**Rejected:** changing only the page background while retaining unreadable
button labels, keeping appearance controls that switch away from the chosen
palette, and separate copies of the same theme for each screen.


## <a id="d128"></a>D128: Daily card tools live on Cards home

**Decided (2026-10-26):** remove Check a card and Reset a card for reuse from
Settings. Their daily entry points remain on Cards home, with the existing
saved-work, hardware-busy and reset guards. Contextual actions in card status
and installation retain their current navigation and consent paths.

Settings retains physical chip identity under Diagnostics, and the bench
entry in approved laboratory builds. Identity returns to Settings, whose Back
action returns to Cards. An empty diagnostics group is hidden. Build 12
includes this cleanup before store distribution.

**Why:** Cards home already gives direct access to checking and resetting a
card. Duplicating those actions in Settings adds clutter and another entry
path to the same tasks.

**Rejected:** removing identity diagnostics, moving everyday tools back into
Settings, and changing card operations or recovery rules for a navigation edit.

## <a id="d129"></a>D129: A standalone container hosts the Node ops-service

**Decided (2026-10-26):** package the existing Node/SQLite provisioning domain
as one multi-stage OCI image, with native AMD64 and ARM64 acceptance in CI.
Runtime carries compiled JavaScript and production dependencies. It runs as
an unprivileged user with persistent SQLite, separate mounted secrets and
filesystem exports. StartOS packaging can consume the same image later.

The standalone process validates listener, mint and administrator configuration,
accepts bounded regular secret files, applies the existing nonce-based operator
setup before listening, and drains HTTP before closing SQLite. Separate live
and ready endpoints distinguish a running database from a recovery-fenced
issuer. Initialization creates private random credentials once. Encrypted export
and restore reuse the existing v7 artifact format and recovery fence. The image
changes no card protocol, manager-key derivation or deployed Cloudflare state.

The existing Workers adapter continues to own R2 scheduling and companion
enrollment/receipt HTTP APIs. The first container uses filesystem export with
an external scheduler and independent copy procedure. Source documentation
states that boundary; the public website guide remains deferred by the operator.

**Why:** independent issuers need a portable deployment with private setup and
durable state. A StartOS-specific runtime would tie the service to one host.

**Rejected:** a TypeScript development runtime in the final image, embedded
credentials or live databases, an automatically replaced issuer master, sharing
one SQLite volume across replicas, and presenting container startup as backup
or restore acceptance.

## <a id="d130"></a>D130: Ops tags publish an immutable multi-platform image

**Decided (2026-10-26):** an `ops-vX.Y.Z` component release publishes
`ghcr.io/cashucard/ops-service:X.Y.Z` after full CI, using the exact tagged
source and the existing container build. The index must contain Linux AMD64
and ARM64 payloads. OCI provenance and an SBOM accompany the image. Release
metadata records its digest, platforms and source commit; the GitHub release
waits for both the Worker artifacts and the image before publication.

The version-availability guard reads every registry version page, refuses an
existing tag, and stops on ambiguous permission/network errors. The first
package can be created after a confirmed API 404. Release jobs remain serialized
by component tag. The workflow's repository token supplies registry access;
registry credentials remain outside the build context and image layers.

**Why:** independent operators need a pullable image with the same tested
runtime on their CPU architecture. Source builds remain available, and hosting
packages can pin the same digest. The public website guide was deferred here; D131 adds it after release validation.

**Rejected:** a moving `latest` deployment tag, replacing an existing published
image version, publishing a one-architecture index as a portable release, and
announcing anonymous availability before checking package visibility.


## <a id="d131"></a>D131: Developer docs separate card use, issuance and hosting

**Decided (2026-10-26):** the public Developers page starts with the payment and
issuance flows, identifies who operates each component, and offers separate paths
for reader development, installation and service hosting. Optional storage,
notification and recovery companions sit in expandable sections. A dedicated
ops-service guide explains manager-key authority before Docker setup and links a
release-pinned Compose file. It distinguishes standalone filesystem exports from
the Workers pairing and receipt adapters.

**Why:** a wallet developer needs the card/mint contract; a card issuer also needs
operator authorization, persistent manager keys and installation history. A new
reader should be able to identify that responsibility before encountering the
host's recovery tools or deployment commands.

**Rejected:** making the service a requirement of the payment protocol, presenting
Nextcloud or ntfy as required server dependencies, and putting the full hosting
runbook ahead of the component overview.


## <a id="d132"></a>D132: Ecosystem map shares one physical card across flows

**Decided (2026-10-26):** the developer overview uses a native SVG architecture
map with separate desktop and phone compositions. Wallet, till and CCP connect
to the same physical card running the applet. The mint serves payment flows;
the ops-service authorizes installation and keeps manager keys and records.
The supporting layer names the copy job, independent backup storage, alerts and
separate backup-key custody. Captions distinguish Workers/Atoll from standalone
filesystem exports. A text explanation remains available below the image.

**Why:** two linear flow cards duplicated the card and combined till and mint,
which obscured the actual relationships. One map makes the boundaries visible
while keeping deployment detail in the hosting guide.

**Rejected:** treating the ops-service as a payment intermediary, implying Atoll
pairs with the standalone Docker service, and shrinking a desktop graph until
its labels become unreadable on a phone.

## <a id="d133"></a>D133: The provisioner draws a neutral Cashu Card face

**Decided (2026-10-26):** the provisioner's card figure and batch-setup design
row show the Cashu Card face: the brand's lime gradient, the lockup, the gold
cashew-contacts chip and the mark. It is a generic face, not a design code in
[CARD-DESIGNS.md](CARD-DESIGNS.md); holder wallets keep choosing and writing
design codes. The ops-service default mint list now starts with
`mint.minibits.cash`; `forge.flashapp.me` stays in the list, last. The
installation screen's card-check button, hardware gate and recovery notice now
sit inside the setup form's safe area.

**Why:** the provisioner is a shared open source tool and its store listings
show these screens. Drawing one issuer's card and preselecting its mint reads
as that issuer's app. On Android the check button drew over the status bar.

**Rejected:** registering a new design code for the figure (the provisioner
writes no design), dropping the Flash mint from the list, and removing the
check button from setup (it returns to the form, per D121).

## <a id="d134"></a>D134: cashucard.org carries its own privacy, terms and support pages

**Decided (2026-10-26):** cashucard.org publishes `/privacy`, `/terms` and
`/support`, linked from every page's footer. Island Bitcoin LLC is named as the
party responsible for cashucard.org, ops.cashucard.org and the Cashu Card
Provisioner app, the three things it runs and publishes. Contacts are
@cashucard.org addresses: support, privacy, security, conduct and hello.
`/support` points to the questions and answers, GitHub Discussions and issues,
and the support address.

The privacy policy states what is collected: Cloudflare request logs for the
site; the operator's sign-in and the batch and card records the app sends to
the ops service it chooses; operator accounts, card records, issued keys and
an audit log on ops.cashucard.org. The app carries no analytics, advertising
or tracking code.

**Why:** the provisioner's store listings and its sign-in screen linked to
Flash's privacy policy, terms and support address. A shared open source project
needs its own, and a privacy policy needs a named legal entity; "The Cashu Card
authors" is a license holder, not one.

**Rejected:** naming "The Cashu Card authors" as the responsible party, and
publishing the pages before the @cashucard.org mailboxes receive mail.

## <a id="d135"></a>D135: The provisioner and the repository use the @cashucard.org contacts

**Decided (2026-10-26):** the @cashucard.org mailboxes receive mail on Proton,
so the project points to them. The provisioner's Privacy Policy, Terms and
Support links open cashucard.org/privacy, cashucard.org/terms and
support@cashucard.org (replacing the Flash pages from D58). The Play listing's
support line names cashucard.org/support and support@cashucard.org.
SECURITY.md adds security@cashucard.org beside private advisories, the code of
conduct takes reports at conduct@cashucard.org, and SUPPORT.md names the
support and conduct addresses. The FAQ and the developers page give the
security address too.

**Why:** D134 published the pages and the addresses but held the switch until
the mailboxes received mail. Test mail to all five arrived on 2026-10-26.

**Rejected:** keeping GitHub advisories as the only security channel. A
reporter without a GitHub account needs a private route too.


## <a id="d136"></a>D136: Verify settlement before clearing retained spent slots

**Decided (2026-10-27):** readers must obtain complete NUT-07 `SPENT`
coverage for the same authenticated card's retained spent-proof snapshot before
calling the existing all-slot `CLEAR_SPENT`. Incomplete, unavailable or
unreconstructable evidence blocks cleanup. Interrupted cleanup retains its
previously verified scope. Merchant output and owed-change records remain
independently recoverable. The APDU bytes and applet version stay at 2.1.

**Why:** a spent slot records a card signature, while an offline till may still
hold the only signed swap. Clearing its reconstruction data before mint
settlement can strand that payment. The corresponding shared reader-contract
change is reviewed in cashucard/nut#4.

**Rejected:** treating a zero card balance, input consumption on the card, or an
empty phone queue as proof of mint settlement.

Assisted settlement is being developed in separate gated slices: merchant
pre-sign durability, exact-output recovery with replay-safe accounting, then a
reviewed card outbox and selective retirement. The local feasibility rehearsal
in `tools/cardsim/assisted-settlement.cjs` proves the signed-swap/restore path
against a local Nutshell mint. Resource bounds and the new wire contract still
need partner review and separately approved silicon measurements.


## <a id="d137"></a>D137: Isolate the early outbox resource probe from released firmware

**Decided (2026-10-27):** `tools/outbox-spike/build-probe.py` copies the current
applet sources into a new scratch directory, preserves its installation path and
adds a persistent pool (16 KiB by default) with persistent memory counters. It
replaces command dispatch with probe-only memory reporting and a dummy 128-byte
transaction. The package uses the private test AID `F0434153485550524F4245` and
version 0.0. Production payment, PIN, load and reset commands are refused. The
production CAP, protocol version and provisioner assets stay unchanged.

**Why:** the outbox needs a physical-chip resource gate before choosing record
limits. A generated probe can measure the current install demand plus a candidate
pool without adding a full transient packet buffer or committing to production
APDU assignments. Its manifest binds the source hashes, tool hash and CAP hash.

**Rejected:** estimating the number of supported payments from nominal EEPROM,
using simulator memory counts as chip measurements, and installing an unmeasured
prototype through the released provisioner. This probe establishes a resource
floor. Descriptor signing latency, the final transaction layout, power loss,
record limits and wear still require the subsequent approved prototype drills.
Physical installation and restoration need a named disposable card, confirmed
empty/reconciled state, known key provenance and an approved action list.


## <a id="d138"></a>D138: Run the resource probe only after a service-recorded factory reset

**Decided (2026-10-27):** the USB resource runner accepts only the private 16 KiB
probe profile, a pinned manifest hash, a named chip/ACS reader, confirmed factory
reset and a fresh private journal. It uses cardkit 0.2.0's public API and factory
keys only. It rejects an installed production applet or unexpected registry
objects before loading. One known-key secure channel loads the probe; selection
ends that channel, so one new known-key channel performs verified cleanup.
Every failed operation stops without a retry or automatic cleanup.

The bridge opens the reader exclusively, restricts mutation to the private
probe's package/instances and refuses PUT KEY and production deletes. The
runner verifies CPLC before each authentication, persists the next stage before
mutation, measures one dummy publication and verifies registry absence after
cleanup. It finishes factory-blank; the operator restores a recorded released
applet through CCP's ordinary batch flow.

**Why:** a disposable empty card may still have assigned manager keys. Using
CCP's reset first preserves its service history and proves the documented
factory transition while keeping issued keys inside the existing protected
phone/service flow. The standalone probe needs no production credential or
issued-key export.

**Rejected:** guessing factory keys on an assigned-key card, widening the
production delete whitelist, writing an unrecorded production installation over
USB, and retrying after an uncertain LOAD or INSTALL. Physical execution remains
behind a separate approved action list and a complete protected journal.


## <a id="d139"></a>D139: Diagnose resource-probe registry failures without repeating the write drill

**Decided (2026-10-27):** the resource runner records public GET STATUS replies
and parsed registry fields in its protected journal, with fixed status, format,
incomplete-response and unexpected-object failure codes. It excludes arbitrary
exception text and all authentication payloads. A separate registry-only mode
shares the pinned artifact, identity and known-factory-key checks, but returns
before installation or cleanup. Its PC/SC bridge independently refuses every
probe mutation. Both modes refuse journal reuse and stop without retries.

**Why:** the approved first physical invocation stopped at the blank-registry
gate before loading the probe. Its original stage-only journal cannot determine
whether the cause was a registry status, parser refusal or unexpected object.
Bounded public evidence makes the next separately approved diagnostic useful
without rerunning a mutation workflow.

**Rejected:** accepting an unparsed registry, automatically trying another format
or secure channel, deleting unknown objects, and recording APDU/authentication
transcripts. The original stopped invocation remains preserved. Inspection needs
its own named-device approval and does not authorize resuming the write drill.


## <a id="d140"></a>D140: Preserve the exact observed platform packages during the resource drill

**Decided (2026-10-27):** the named 09336320 probe profile accepts the three
pre-existing platform load files observed by the approved registry inspection.
It pins their full public GET STATUS entries, requires every one before and
after the drill, and permits only the private probe package/instances alongside
them during cleanup. Different versions, metadata, missing entries, duplicates
or extra objects stop the run. The profile requires an explicit flag and the
matching CPLC. The default remains empty-registry-only.

**Why:** the original D138 empty-registry assumption rejected this card's platform
packages after a successful CCP reset. The same three entries appear in the
owner's earlier captures. They are the SSD creation package and the JavaCard
biometry libraries, not an installation left behind by CCP. The exact baseline
is a preservation check; AID recognition alone is insufficient.

**Rejected:** removing platform packages to satisfy an empty-registry check,
accepting arbitrary installed packages, matching only AIDs, and accepting a
missing baseline after cleanup. The bridge continues to allow deletion only of
the private probe AIDs. The stopped invocation and diagnostic evidence remain
retained, and the revised write plan needs separate approval before execution.


## <a id="d141"></a>D141: Separate cleanup of a stopped resource drill from another install attempt

**Decided (2026-10-27):** the resource runner has an explicitly selected cleanup
mode for a separately approved named-card plan. It matches CPLC, requires known
production objects absent, proves the factory channel once, checks the selected
exact registry baseline, deletes only the private probe objects in dependency
order and verifies the baseline afterward. An absent probe object is acceptable;
unexpected state or any other command failure stops without retry. The bridge
independently refuses loading, creation and dummy writes in cleanup mode.

**Why:** the approved platform-profile drill loaded its package and created the
opener, then stopped while creating the probe applet. It obtained no resource
measurement. Restoring the released applet requires removing these private test
objects first, without repeating their creation or assuming the final instance
exists. The old host discarded status details for non-registry refusals, so the
cause remains unresolved; future fixed failure codes include the public status
word when available.

**Rejected:** automatic rollback after an uncertain mutation, retrying INSTALL
to discover the old failure, deleting platform or production objects, and
recording arbitrary errors or authentication transcripts. Prior journals remain
unchanged. Cleanup approval does not authorize another resource-probe attempt.


## <a id="d142"></a>D142: Separate the resource probe's constructor, allocation and optional diagnostics

**Decided (2026-10-27):** private format-2 probes have a zero-pool control with
the original constructor unchanged and a pool profile adding only its persistent
byte array. Both query the legacy capped memory counters after installation.
The control refuses dummy publication; the pool publishes once only after
available diagnostics and reported commit capacity permit it. The host and
bridge bind selection to the pinned format/pool size. CI converts and exercises
both generated profiles.

**Why:** the format-1 probe combined extra installation-time memory queries,
stats allocation and a 16 KiB pool, then stopped before measurements. Its result
cannot identify the failing addition or establish a capacity limit. Separating
these steps provides a control and keeps optional diagnostics out of creation.
The legacy counter's 32767 cap is explicit, and successful allocation supplies
its own evidence independently of exact free-memory estimates.

An empty-body `6F00`, `6A81` or `6D00` from the private read-only measurement
command is a declared diagnostic outcome: record unavailable, skip pending dummy
publication and perform the planned cleanup. Other errors, malformed data and
transport failures retain the stop-with-journal policy. The physical plan must
include these outcomes. Counter unavailability supplies no memory measurement.

**Rejected:** repeating the failed mixed probe to infer its old error, guessing
an EEPROM limit, querying optional APIs inside the control constructor, runtime
allocation, and interpreting capped counters as exact space. Existing format-1
artifacts retain their original interpretation. Revised hardware actions require
their own pinned profile plan and approval; production firmware is unchanged.

## <a id="d143"></a>D143: Compare bounded allocation layouts with explicitly approved refusal cleanup

**Decided (2026-10-27):** after the format-2 control succeeded and the single
16 KiB allocation returned `6F00`, the next private comparison profiles are
256 bytes, 4 KiB and four 4 KiB arrays. The manifest binds size and layout.
The original constructor work and transient allocations are preserved. A dummy
publication touches the first segment. Continue only after a prior profile's
valid measurements, confirmed/re-read publication and verified cleanup.

An opt-in plan may declare empty-body probe-creation `6F00`/`6A84` responses as
refusals followed by cleanup. Persist the refusal, rematch identity, prove a new
factory channel, check the exact baseline plus private probe objects, delete
only those private objects and verify the baseline. Return a distinct
`install-refused-cleaned` result (CLI exit 2), ending the sequence. A cleanup
failure retains both errors. Default failure handling stays stop-with-journal.

**Why:** the control gives measured constructor/commit-counter evidence, while
the generic creation refusal leaves the allocation cause unresolved. Smaller
and segmented candidates compare size/layout while keeping the test bounded.
The successful cleanup path already establishes its identity, key and registry
gates. Explicitly declaring this narrow outcome avoids a separate operator
round trip for the same backout, while preserving prior evidence.

**Rejected:** arbitrary adaptive sizing, advancing after refusal or unavailable
measurements, inferring an EEPROM limit, changing transient allocation, and
cleanup after ambiguous delivery, authentication failures, unexpected replies or
registry changes. The flag requires a named approved allocation plan. Production
firmware, CAP and protocol assignments are unchanged.

## <a id="d144"></a>D144: Measure a one-time reservation after installation using one fixed image

**Decided (2026-10-28):** the next private resource profile uses the same CAP
for baseline measurements and 256-byte, 4 KiB or 16 KiB reservations. Its
original constructor remains unchanged. One private command persists an
attempt marker, then makes one persistent array outside a transaction. It
refuses another attempt even after deselection. Diagnostics expose actual
reserved bytes and the attempt marker. Only a confirmed reservation can
proceed to the existing 128-byte dummy publication.

**Why:** the 256-byte constructor probe failed with the same generic `6F00`
as the 16 KiB probe. Both images were 19,751 bytes; the successful control was
19,635 bytes. Existing chip evidence documents load-size sensitivity and a
separate constructor allocation budget. D142/D143's comparisons therefore
cannot isolate capacity. Separating reservation from INSTALL and retaining one
binary across sizes removes those changes from the reservation comparison.
The guarded deferred proof store in D17 supplies an existing implementation
precedent; this experiment makes no production allocation-policy change.

A caught allocation `SystemException` reports its public reason. Explicit
refusal cleanup first persists that result and confirms zero reserved bytes,
an attempted reservation and no publication. It then rematches CPLC, proves
one new factory channel, validates the exact registry, removes private objects
and verifies the baseline. The distinct result exits 2 and ends the sequence.
Ambiguous delivery, malformed responses, failed persistence, authentication or
registry checks retain stop-with-journal handling. Each physical run needs a
named approved plan covering reservation and the declared cleanup outcomes.

**Rejected:** inferring available capacity from generic INSTALL failures,
changing the image between sizes, unbounded allocation retries, reserving
inside a transaction and enabling this command in released firmware. Final
outbox initialization, publication, limits and recovery remain design and
physical validation gates after this resource experiment.

## <a id="d145"></a>D145: Retain fixed reader failure categories and public PC/SC codes

**Decided (2026-10-28):** the private probe bridge labels enumeration,
connection, command validation and transmission failures with fixed codes.
When pyscard provides an integer HRESULT, retain only its normalized eight-digit
hexadecimal value. The host admits only the known code set and exact numeric
shape, retaining those fields in its journal and stopped result. Exception
text, command bodies, authentication data and arbitrary bridge fields stay out
of diagnostic output. A disconnect failure preserves an earlier failure.

**Why:** the approved fixed-image transfer stopped at LOAD block 13 with
`operation-failed`. The reader remained visible, and offline command framing
validation passed. The previous bridge discarded the information needed to
distinguish command rejection, PC/SC failure and broken transport. The cause
of that stopped run remains unresolved; its separately approved cleanup
succeeded. Future fixed public diagnostics can narrow a failure without
collecting authentication transcripts.

**Rejected:** dumping exception strings or APDUs, inferring a physical cause
from a generic error, retrying a stopped write to recover its old error, and
widening cleanup authorization through an observability change. Physical
actions and stop conditions retain their approved scope.

## <a id="d146"></a>D146: Revalidate the known control before fixed image-layout comparisons

**Decided (2026-10-28):** the next resource experiment starts with the previously
successful pinned constructor control. Only a valid control and verified
cleanup permit trying a new image. Two fixed post-install candidates alter
only the existing unreachable padding method; constructor, reservation and
publication code remain identical. Each selected image stays fixed across
256-byte, 4 KiB and 16 KiB requests. A separately approved plan can permit the
second image only after the first image's initial creation refusal and verified
cleanup. Other failures retain their approved stop/backout rules.

**Why:** the format-3 diagnostic rerun completed LOAD, then received `6F00` at
creation before any pool command. It has no added pool in its constructor.
The chip's documented load-size sensitivity and possible changes to its
initialization baseline need separate controls. The generated candidates are
20,068 and 20,196 bytes; 20,068 matches the released image's measured size,
without establishing that a new image of that size will install.

An explicit named-baseline execution may read the public ISD `FF21` memory tag
before authentication. Admit its documented TLV structure and retain numeric
counters, with tag 81 left uninterpreted. Declared empty unsupported-command
responses record unavailable. Malformed data or other errors stop before
loading. These optional counters supplement the capped JavaCard API; they
do not select an adaptive allocation size.

**Rejected:** treating a generic creation error as a capacity limit, repeating
the same failed image as a new comparison, changing runtime code or allocations
to pad an image, extrapolating a universal alignment rule, and unbounded image
search on hardware. Pinned artifacts and an approved bounded plan remain
required; production code, CAP and protocol behavior are unchanged.

## <a id="d147"></a>D147: Preserve the converted instance shape in the private allocation diagnostic

**Decided (2026-10-28):** an `existing-fields` private profile preserves all
original fields and the constructor. Its restricted dispatcher borrows the
initially null `dleq` reference for its pool and persistent `cardLocked[0]` for
the one-attempt marker. Production commands remain unreachable in this image.
It retains format 3 and the same bounded reservation/publication interface.

**Why:** the known control installed again, while both fixed layouts were
refused before reservation. The Oracle 3.0.5 verifier reports 50 declared instance cells
and 50 references for the control, versus 52 cells and 51 references for those
probes. Adding diagnostic fields altered instance layout even with an unchanged
constructor body. The new profile removes that confound; the cause of the old
refusals remains unresolved.

A host-only inspector reads the converted Class/Import components through the
pinned SDK. Builds record its hash and the class shape in the manifest. The
existing-fields profile must have the known control's size 50, first reference
token 0 and reference count 50. Source tests additionally compare the full
class outside its private dispatcher/padding method. Unknown storage modes or
shape mismatches are refused before reader access. Fixed padding variants keep
the image constant within each reservation sequence.

**Rejected:** inferring a hard field-count limit, assuming equal source
constructors imply equal converted layout, adding scratch state to the control,
and changing production ownership, locking or proof storage for an experiment.
Borrowed state exists only in a private disposable diagnostic. Final firmware
storage design remains gated on actual capacity, publication and recovery
evidence, with a named approved plan required for every physical run.

## <a id="d148"></a>D148: Model publication and retirement within a bounded byte image

**Decided (2026-10-28):** use a host-only storage model for the next resource
prototype slice. Its entire candidate bookkeeping and packet page pool occupy
one explicit byte image. A hidden STAGING record becomes COMMITTED only after
its complete frame is written and checked. That marker also commits burn intent;
all modeled export, load, spend admission and balance operations resume burns
before proceeding. Pending records pin their proof generations.

A matching installation/payment/record-generation/digest acknowledgement moves
a record to CLEARING. Proof cleanup resumes before any replacement load.
A separate internal RELEASING state follows completed proof cleanup so a cut
while freeing payload pages needs no access to already-released pages. Abandoned
staging is reclaimed without consuming its inputs. Counters refuse at exhaustion.

**Why:** the approved field-preserving B image physically reserved 16 KiB and
published 128 bytes on 09336320. That is a floor for the next prototype, while
record metadata, capacity and interrupted cleanup still need design evidence.
The model permits exhaustive cuts after byte writes and modeled transactions.
The largest assumed transaction covers 13 counter/identity/state bytes; staging
length, digest and page maps are separate tearable byte writes. Transactions
remain assumptions until JavaCard and silicon validation.

The initial complete-packet candidate budgets 676 global/proof-bookkeeping bytes,
32 headers of 48 bytes, and 109 pages of 128 payload bytes plus two page-map
bytes each: 16,382 used bytes within a 16,384-byte image. The draft's fixed
canonical fields total 89 bytes before URL, counts, entries and signatures;
with a 24-byte URL and 33-byte full keysets, one-input/one-output packets total
422 bytes and 128-input/one-output packets total 14,138 bytes. The model also
stores a count plus five-byte slot/generation references. Four pages per small
packet admit 27; the large packet cannot fit. These are candidate arithmetic
and synthetic workload results, with no production capacity assignment.

**Rejected:** treating a successful raw allocation as a final outbox size,
storing complete expanded packets without accounting for metadata and page
rounding, exposing staged signatures, freeing pinned inputs before retirement,
and inferring physical tear safety from a host model. The next compact prototype
must reconstruct inputs from pinned slots and keyset mappings while preserving
exact canonical export bytes. Production APIs, wire bytes and assets are unchanged.

## <a id="d149"></a>D149: Reconstruct the candidate packet from compact references

**Decided (2026-10-28):** add a host-only compact export prototype following the
open NUT proposal and its independently encoded signed vector. Ordered
slot/generation references remain in the storage frame. The compact payload
keeps outputs as amount, full-keyset registry reference and blinded point,
followed by the original payment witness and descriptor signature. Immutable
fixture state supplies the retained proof data and configuration.

Canonical body and SIG_ALL hashes stream through fields. Export verifies both
signatures before yielding bounded pages. Full keysets retain their exact
8/33 bytes, ambiguous prefixes are refused, and uint64 payment identities use
BigInt with explicit rejection of unsafe Numbers. Unsupported secret/date/refund
profiles, change/refund output roles, duplicate inputs/outputs, overflow and trailing compact bytes fail
closed. The canonical packet ID is distinct from the model's framing checksum.

A synchronous storage builder checks record/byte capacity and fixes identity
and input generations before invoking the test signer. Interleaved public model
operations are refused during the builder. Signing/length failures preserve the
unconsumed state; existing publication and recovery ordering is retained.

**Why:** expanded storage could not fit the large draft-shaped payment. In the
compact candidate, reserve 724 context/registry/mapping bytes and additional
uint64 identity bytes inside the 16 KiB budget. With 64 candidate record headers,
89 payload pages admit 44 small synthetic payments. The 128-input/128-output
workload needs 5,635 frame bytes and streams a 23,163-byte signed packet for its
fixture context. The independent mixed-keyset vector also pins a payment ID
above JavaScript's exact Number range.

**Rejected:** copying complete expanded inputs into every record, omitting
metadata outside SIG_ALL, verifying only the payment witness, silently adapting
unsupported secrets, and presenting software byte budgets as silicon evidence.
The fixture assumes preverified immutable loading; owner/load provenance, fees,
DLEQ, the physical combined setup, RAM, crypto timing and tears remain separate
gates. The store still refuses at its internal uint32 counter limit; reserved
uint64 bytes do not implement a new card counter. This changes no production
APDU, protocol assignment, firmware, CAP or provisioner asset.

## <a id="d150"></a>D150: Convert a private byte-backed JavaCard fixture prototype

**Decided (2026-10-28):** generate a separate private package,
`F04341534855434D5054`, preserving the production fields, constructor, crypto
engines, scratch and proof hex cache. Conversion requires the known instance
shape: 50 cells, first reference 0, 50 references. The release CAP is unchanged.

One guarded setup persists intent before allocating the 12,288-byte DLEQ store
and 16,384-byte pool outside a transaction. The pool borrows `cardReceipts`;
its old buffer stays allocated. Private dispatch replaces ordinary operations,
including owner/PIN, receipts, limits and production payment commands. Public
synthetic fixture loading and unsigned retirement are bench interfaces only.

The pool holds a real uint64 counter, immutable context/registry mappings, slot
generations, 64 headers of 52 bytes and 90 linked 128-byte pages. Reusing the
existing proof status bytes removes the host model's duplicate status/nonce
budget and admits 45 small fixtures. BEGIN fixes identity/generation and hidden
STAGING in a 21-data-byte transaction. Both signatures and canonical packet ID
precede COMMITTED/burn intent. Burns and retirement resume before reuse;
CLEARING advances to RELEASING only after every selected slot is empty.

Burn completion is persisted last. Completed records avoid repeated full hashes
on unrelated commands. Export/scope validates references and packet integrity
once per selected session using existing transient state. Mutations invalidate
the cache; selection clears it. A fresh session rejects corrupted pinned data.

**Why:** the host model could not establish JavaCard conversion or byte-backed
state/signing. The converted prototype uses the original Schnorr implementation
and matches independently verified host exports for mixed/full keysets, large
input/output counts and a uint64 identity above Number precision. Source checks
preserve constructor demand and prohibit allocation in the static state engine.

**Rejected:** modifying release firmware for an experiment, adding instance
fields/transient buffers to the working constructor, freeing payload during
incomplete proof cleanup, and treating simulator memory or cuts as silicon
evidence. Fixed test keys and boundary cuts live only in separately compiled
host harness sources and never enter the CAP. Generated-source, SDK and artifact
hashes are retained. Existing hardware tooling rejects this package/kind.
Physical setup, memory, signing/transfer latency and tears require a reviewed
runner and named approved plan. Production authorization, mint/load validation,
receipt/limit integration and the final capability remain separate gates.

## <a id="d151"></a>D151: Bound the first private compact hardware drill

**Decided (2026-10-28):** use a dedicated runner and PC/SC policy for the private
compact package. Preview reads local files. Execution requires exact artifact,
source and runner pins, the named 09336320/ACS reader, factory-reset confirmation
and a new private journal. Existing resource artifact admission stays unchanged.
Share the process bridge and journal transport; keep package/APDU admission
separate. Fingerprints include the built cardkit files and dependency pins.

The first workload attempts combined DLEQ/pool setup once, then signs two
synthetic inputs into two outputs, reselects and exports the packet. Verify both
signatures, exact canonical bytes and scope with the card-generated public key
before unsigned bench retirement. Record memory/commit counters and timings.
The original platform registry is exact; deletes name only the private applet,
opener and package. CPLC and a fresh factory channel precede cleanup.

Persist every stage before transmission. Single-attempt fixture commands,
30-second response deadlines, a 120-second elapsed gate and 512-command ceiling
bound the drill. Unknown delivery, malformed data, authentication failures and
signature/export mismatches stop with retained evidence. A separately enabled
declared-refusal branch permits bounded private cleanup after empty-body
`6F00`/`6A84` from creation or setup. It ends the test; it cannot authorize a retry.

**Why:** full integrated allocation and signing need physical evidence after the
converted prototype. A small deterministic public fixture isolates those costs
before larger capacity and power-loss workloads. Fake transports and offline
policy tests exercise the host boundary before any physical access.

**Rejected:** broadening the old resource artifact allowlist, accepting arbitrary
proof/PIN/key input, submitting fixture data to a mint, retrying uncertain writes,
and automatic cleanup after unknown delivery. A named approved plan remains the
physical access gate. Production firmware, protocol assignments, assets and the
released app stay unchanged.

## <a id="d152"></a>D152: Separate private setup from runtime channel management

**Decided (2026-10-28):** move the private compact prototype's setup instruction
from `70` to `7E`. Bump its selection identifier to `CPROT/2` and its manifest
and diagnostic format to 5. Update the runner, simulator and independent Python
transport policy together; new admission rejects previous private formats.
Production firmware, protocol versions and assignments remain unchanged.

**Why:** the approved format-4 image loaded, installed both instances and
answered diagnostics on 09336320, then setup returned `6E00`. The
[JavaCard 3.0.5 programming notes](https://docs.oracle.com/cd/E59935_01/prognotes/isoiec_7816-42013_specific_apdu_commands_for_logical_channel_management.htm)
and runtime specification section 4.6.1 identify `70` as MANAGE CHANNEL,
handled by the runtime. This conflicts with an application setup instruction.
Runtime interception is a plausible explanation for the observed status;
the run supplied no post-setup allocation or signing evidence. The revised
instruction still requires its own physical test.

The host stopped on the unexpected status. The operator then explicitly
requested return to blank; a separate named cleanup-only plan matched CPLC,
proved one factory channel, removed only the private objects and verified the
original platform baseline. Retain both journals and their original artifact.

**Rejected:** retrying setup under the completed plan, treating the refusal as
EEPROM exhaustion, admitting a changed artifact with old pins, or inferring
silicon dispatch behavior from simulator success. The regression check forbids
runtime-owned `70` for setup, and both host policies agree on the fixed command.

**Physical follow-up (2026-10-28):** the format-5/SETUP-7E image completed the
small synthetic payment on 09336320, including combined DLEQ/outbox allocation,
both independently verified signatures, exact export, retirement and return to
blank. See the [hardware report](reports/HARDWARE_TEST_REPORT_2026-10-28.j3r180-compact-payment.md).
Capacity, actual power-loss recovery and production integration remain open.

## <a id="d153"></a>D153: Bind each permitted bench card to its captured baseline

**Decided (2026-10-28):** permit the compact bench runner on two exact CPLC IDs,
09336320 and operator-selected 07297620. Select an immutable full-TLV baseline
by that identity. The first retains its original three entries; the second adds
the observed `A00000016443446F634C697465` version-1.0 load file. Require the
selected baseline before loading and after cleanup. CPLC remains bound through
cleanup. Unknown cards and entries from another profile fail before loading.

**Why:** the operator requested inspection, blanking and continued testing on
07297620. Inspection found a 2.0 installation and test value/history. After
explicit loss acceptance, factory keys were proved at version 1. The registry
identified its additional pre-existing file. Cashu objects were removed while
preserving all four baseline files, then a separate read-only check confirmed
the exact CPLC and all four Cashu AIDs absent. The original three-entry profile
cannot describe this different card.

**Rejected:** weakening the registry check for all D321 cards, dropping unknown
entries, trying alternate manager keys, or replacing the original profile.
The fixed synthetic workload, private ABI, CAP, factory-key policy and cleanup
order are unchanged. Tests exercise the new profile, preserve rejection under
the old profile, reject unknown identities, and verify cleanup uses the chosen
CPLC. Production protocol and reset behavior remain unchanged.


## <a id="d154"></a>D154: Preserve bounded transport evidence through SDK wrappers

**Decided (2026-10-28):** the private bench runners retain a validated reader
failure code and optional eight-digit lowercase PC/SC code when cardkit wraps
that failure in its public `TransportError`. Unwrap only a direct, typed
`ProbeFailure` with a fixed transport code. Share classification between the
resource and compact runners. Keep arbitrary native messages, stacks, nested
causes and unvalidated fields out of journals and CLI results.

**Why:** the 07297620 compact attempt completed package loading and opener
creation, then stopped at unconfirmed main-instance creation with only
`operation-failed`. Cardkit wraps transceiver failures; the runner previously
recognized only direct failures. The original cause was discarded and remains
unknown. Bounded error preservation improves evidence for a future invocation.
The separate cleanup verified the four-file blank baseline.

**Rejected:** printing native exceptions, walking arbitrary cause chains,
classifying a wrapped failure as a card reply, or extending automatic cleanup.
Declared-refusal cleanup still requires the original direct empty-body card
response at an admitted stage. Transport uncertainty retains the journal and
stops without retry. The CAP, private workload, production app and protocol
remain unchanged.


## <a id="d155"></a>D155: Select fixed compact capacity workloads explicitly

**Decided (2026-10-28):** retain the default two-input/two-output bench profile
and add one explicit `128-input-128-output-v1` catalogue entry. The latter is
restricted to qualified card 09336320. A checked-in public fixture defines all
128 input slots and outputs. Node and the independent Python bridge construct
the same fixed setup, load, staging and export commands from that fixture.
Unknown profile names fail before reader access. The bridge selects one profile
per invocation; it cannot admit the union of both command sets.

The candidate full-slot case stages outputs through 22 short APDUs, then exports
23,163 bytes through 91 pages. Verify every canonical byte, both signatures and
the exact scope before fixture retirement. Retain received public pages durably
as they arrive so interrupted export preserves its available evidence. A stopped
or invalid export cannot authorize retirement or deletion. Original identity,
factory-key, baseline, journal, deadline and command ceilings remain in force.
The fixed host `drill-bound-exceeded` stop survives the SDK wrapper so a budget
stop retains its reason without changing cleanup admission.

**Why:** the small physical payment passed on 09336320 in #210, establishing
combined allocation, signing and export for that workload. The existing private
image already handles a full-slot payment; a bounded explicit host profile can
measure it without a firmware/layout variation. Matching independent bridge
commands and simulator execution catch framing and count errors before hardware.
The selected 128-output case is a candidate test, with final protocol limits
still open.

**Rejected:** arbitrary fixture/APDU input, automatic expansion to 07297620,
changing time/command limits to make a run finish, or treating an export failure
as permission to erase evidence. Many-small-record capacity, between-command
power loss and cuts during writes remain separate measured gates. Physical
execution still requires a named approved plan; production firmware, protocol
assignments and release capability are unchanged.

## <a id="d156"></a>D156: Isolate the Android private creation control

**Decided (2026-10-30):** prepare a separate offline Android lab application for
one creation-only control on the Pixel and exact blank card 09336320. Generate
it outside the checkout from committed source, under a separate application ID,
with bundled JavaScript, disabled developer support, removed Internet
permission, disabled release variants and public debug signing. Keep the
CPROT/2 format-5 CAP and load bytes unchanged. Production firmware, CCP, store
builds, service configuration and manager keys remain unchanged.

The portable controller admits a fixed command sequence through cardkit's public
API. Pin the load hash, match CPLC, prove factory version 1 before external
authentication, and require exact baseline registry evidence. Load once, create
opener then main, select the private version, read diagnostics and validate the
public key. A successful control rematches CPLC, opens one fresh factory channel,
requires the exact private objects and original baseline, removes only those
objects and verifies return to blank. Persist intent before every transmission.
A consumed journal survives relaunch; cancellation, uncertain transport,
unexpected replies and persistence failures stop without retry or cleanup.

**Why:** the sole recorded-reset ACS repeat stopped at opener creation with an
unsuccessful exchange, before capacity measurement. A different transport with
the same image and a smaller creation-only workload supplies a bounded control.
It does not attribute a driver/card/power cause or replace physical capacity and
interrupted-write tests. Availability of the Pixel authorizes local preparation
only; a named reviewed physical plan remains required for device/card access.

**Rejected:** more ACS installation attempts, changing the private image to make
the test pass, enabling the production bench flow, automatic retries/cleanup
after uncertainty, and replacing the installed CCP app or its saved work. See
[Pixel creation control](../tools/outbox-spike/PIXEL-CONTROL.md) for preparation
and the exact hardware boundary.

**Physical follow-up (2026-10-30):** the approved Pixel 8 Pro control completed
both private creations, diagnostics/public-key validation and exact return to
blank on 09336320. The saved journal recorded 143 commands and a 20,783-ms
connected session. See the [hardware report](reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-compact-creation.md).
This is creation evidence for that invocation; capacity and interrupted-write
gates remain open, and the ACS failure cause remains unassigned.

## <a id="d157"></a>D157: Verify the closed full-slot workload on the Pixel

**Decided (2026-10-30):** add one explicit capacity mode to the isolated Pixel
lab generator, under a separate application ID and consumed journal. Reuse the
unchanged private CPROT/2 image and exact 09336320/factory/baseline admission.
Pin the committed 128-input/128-output fixture bytes and construct its fixed
commands with portable arrays. Unknown modes/fixtures stop before hardware.

After verified creation, the mode performs private allocation/setup, loads the
128 synthetic input slots, stages 128 outputs, signs once and reselects. Persist
all 91 export pages as they arrive. Rebuild the exact 23,163 canonical bytes
from the pinned fixture and observed public key, match scope identity/generation
and packet hash, and verify both BIP-340 signatures. Persist the verified packet
before scoped retirement. Require the fully free status before fresh identity,
factory and registry checks permit private-only deletion and blank verification.

**Why:** the independent Pixel creation control passed in #216, while capacity
remained unmeasured. The existing Node codec/workload uses Node-only APIs.
A closed portable implementation can run on the offline Pixel without adding
Buffer/Node shims or changing production dependencies. Tests match its commands,
packet bytes and both signatures against the existing independent host code.
The capacity command ceiling matches the existing 512-command host limit; the
120-second gate and 15-second native response timeout remain unchanged.

**Rejected:** arbitrary on-phone fixtures/APDUs, trusting a valid signature over
different canonical bytes, retirement before verification/durable packet save,
automatic cleanup after uncertainty, replacing the creation app to erase its
journal, and treating this private control as production protocol enablement.
Many-small-record capacity, physical interruptions, production authorization
and final wire/limit agreement remain separate gates. No additional physical
action is authorized by this decision; review the exact APK and named run plan
before touching the phone or card.

**Physical follow-up (2026-10-30):** the approved Pixel run created the private
applets and allocated the 16 KiB pool and 12 KiB DLEQ area. It confirmed proof
slots 0 through 84, then stopped at slot 85 with uncertain transport/delivery,
before output staging or signing. The approved conditional ACS cleanup removed
only private objects and verified the original blank baseline. The plan is
consumed; full-slot capacity remains unmeasured. See the
[hardware report](reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-capacity-load-stop.md).
Retain a bounded native failure category and failed-call elapsed envelope in
the isolated lab before preparing another approved physical invocation. The
image and existing limits remain unchanged; ACS installation attempts stay
paused.

## <a id="d158"></a>D158: Preserve bounded native failure evidence in the Pixel lab

**Decided (2026-10-30):** improve only the private generated Android lab after
the Pixel full-slot invocation stopped with a generic transport error. Pin the
original and patched NFC dependency source hashes. During generated postinstall,
replace its transceive exception catch with a finite class-based token and
remove that catch's raw exception log. Fail the build on unknown source. Keep
normal CCP source/dependencies and every NFC command, image and limit unchanged.

Measure the failed JS-to-native await after intent persistence, retaining only
stage, command ordinal, finite category and elapsed envelope. A short reply gets
its own bounded category. Preserve `transport-uncertain` and existing cleanup
admission; preserve a controller's stopped reason through outer session/save
failure. Exclude native text, stack traces, APDU bodies and nested causes.

**Why:** #218 records successful creation/setup and 85 confirmed loaded slots,
then unknown delivery at slot 85. Its record cannot distinguish even a native
I/O category or failed-call duration. The dependency discarded exception type
before JavaScript could observe it. A private build-only patch and offline Java
classifier regression address that evidence gap without modifying card behavior.
An I/O or tag-loss category still leaves its underlying cause open.

The explicit capacity-diagnostics mode upgrades the same private app to code 2
and adds one fixed consumed plan/journal, preserving the prior capacity key and
evidence. It executes the identical workload. Existing modes keep their own
consumed journals. A new exact APK and named plan require approval before
upgrade, arming or other hardware access. Collect terminal results after the
operator reports the result; omit live host UI inspection during card commands.

**Rejected:** recording raw native messages, inferring timeout from generic I/O,
changing production dependencies or the card image, erasing/reusing a consumed
journal, automatic retries/cleanup after uncertainty, and extending deadlines
or increasing command limits. ACS installation attempts remain paused.

**Physical follow-up (2026-10-30):** the approved diagnostic invocation confirmed
all 128 input slots and 72 outputs. Output stage 12 returned `9000`, then the
120-second host elapsed gate stopped the run before response-body validation
or signing. The journal records 278 commands and 120,927 ms connected, with no
failed native exchange. Conditional cleanup verified the original blank card
and closed the reader. The plan is consumed. See the
[hardware report](reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-capacity-deadline-stop.md).
Analyze staging and host persistence costs offline before preparing another
physical invocation; full packet capacity remains open.

## <a id="d159"></a>D159: Reduce private compact page traversal without changing durability

**Decided (2026-10-30):** optimize the private prototype's page access before
another physical capacity invocation. Resolve span addresses once, traverse at
page boundaries, and preserve the original ordered byte stores. Reuse existing
scratch for batched output-point comparisons and a 16-byte input-slot bitmap.
Use local cursors for canonical references and access only the requested frame
range during export, retaining full hashing and page-chain validation.

**Why:** #220 recorded full input loading followed by a host deadline stop
during output staging. Offline metering found repeated walks from the head for
individual bytes and repeated complete-field traversal for short exports. The
fixed large fixture's staging/sign/export link reads fell from 1,479,099 to
87,096, while its full canonical packet and independently verified signatures
remain valid. See the [access profile](../tools/outbox-spike/COMPACT-ACCESS.md).
These counts supply an algorithmic improvement; hardware speed remains open.

Retain the byte-backed layout, constructor/reference shape, allocation rules,
publication/recovery semantics, fixture and all phone/host bounds. Keep every
journal persistence barrier: the original 395-command fake workflow records 1,676 saves,
but Android write latency is unmeasured. Host-only counters, fragmented-page
reference checks and byte-store cuts stay outside generated CAP sources.
Released firmware/assets, protocol, cardkit and existing Pixel image pins are
unchanged. A new exact image/APK and named approved plan precede hardware use.

**Rejected:** raising deadlines, shrinking the fixture to claim the same gate,
discarding duplicate checks, persistent cross-command cursor caches, changing
byte-store atomicity with bulk EEPROM copies, removing durable intent/page
barriers without recovery evidence, or inferring chip timing from JVM counts.
ACS installation attempts remain paused.

The fixed `capacity-optimized` mode pins the converted image from commit
`038e298ec7c846cec75e7e40366b1bc4d25a88d6`, with 27,343 load bytes and 111 blocks.
It uses a separate consumed plan/key under the same private app ID, version
code 3, and preserves the earlier journals. Existing modes retain their old
image pins; crossed profiles stop before the first APDU. The full fake path is 396
commands within the unchanged ceilings. Its exact APK and named physical plan
still require review and approval.

**Physical follow-up (2026-10-30):** the optimized Pixel invocation confirmed
all 128 inputs and all 128 outputs, then stopped at signing with no reply/scope.
The journal records 289 commands, `android-tag-lost` and a 15,015.558-ms failed
native-call envelope. The approved cleanup gate rejected this uncertainty and
the card remains preserved. See the
[hardware report](reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-optimized-sign-stop.md).

## <a id="d160"></a>D160: Recover an existing private signing attempt without signing again

**Decided (2026-10-30):** prepare a closed reader recovery flow for the optimized
private image and exact synthetic full-slot fixture on 09336320. Pin the stopped
journal and saved installation key. Match CPLC, prove factory-version-1 keys
before external authentication and require the exact baseline/private registry.
SELECT the private applet once, explicitly permitting its recovery side effects.

Proceed only after proving either released unpublished staging with all 128
proofs unspent and no scope, or the exact committed scope with 128 spent proofs.
For a committed scope, persist every export page, verify the full canonical
packet and both signatures with Node plus independent Python, and durably save
that evidence before one scoped retirement and a confirmed free state. Only
then may a fresh identity/factory/registry check admit private-only deletion and
verified return to the original blank baseline. Keep all registry snapshots.

**Why:** signing uncertainty cannot establish whether publication completed.
Retrying SIGN or deleting the applet would replace or erase the evidence. The
private applet's SELECT can release staging or finish committed bookkeeping,
so describing this as read-only would misstate its behavior. Existing simulator
cuts cover those recovery states; focused host/policy tests cover the new flow.

The independent reader policy excludes signing, loading, installation, setup,
key changes and production namespaces. Keep the existing reader response bound
and elapsed gate, with 160 commands and short frames. All uncertainty stops
without further commands. See [private recovery](../tools/outbox-spike/COMPACT-RECOVERY.md).
No hardware action is authorized by this decision; prepare an exact pinned
launcher/plan and obtain approval before opening the reader.

**Rejected:** treating tag loss as proof of a failed signature, increasing the
phone timeout to repeat signing, deleting a possibly committed packet, trusting
only a success status or packet checksum, retirement before independent
verification/durable save, and continuing after unknown state or delivery.


**Physical follow-up (2026-10-30):** the approved recovery-only invocation
matched 09336320 and the saved private installation key, then SELECT recovered
all 128 synthetic proofs as unspent with all headers/pages free and no scope.
This admitted the unpublished-staging branch. Conditional private-only cleanup
verified the exact original blank baseline and closed the reader after 24
commands. The plan is consumed; the card is blank. Full-size physical signing
remains unproven. See the [recovery result](reports/HARDWARE_TEST_REPORT_2026-10-30.pixel-optimized-sign-stop.md#approved-recovery-and-final-blank-state).


## <a id="d161"></a>D161: Stream private compact reads and buffer canonical digest updates

**Decided (2026-10-31):** remove the remaining repeated frame-head scans in the
private compact prototype. Use local physical cursors derived from validated
logical offsets for duplicate checks, input/output validation, canonical fields
and payment-message output reads. Preserve logical span/buffer/alignment and
page-owner checks; retain whole-chain validation before canonical rendering.

Buffer canonical bytes in 128-byte blocks within the existing transient scratch.
Flush a final partial block before finalization and preserve the tagged prefix.
The export path remains clipped copying. Scratch is distinct from persistent
pool/proofs, and its lifetime moves from input validation to hashing within the
same command. No new fields, arrays or command-time allocations are introduced.
Persistent store order, publication/recovery boundaries and signature transcripts
remain unchanged.

**Why:** the optimized Pixel run completed staging but lost the signing reply;
its subsequent recovery established an unpublished record and restored the blank
card. Offline profiling found remaining head scans and thousands of small digest
updates. The new helper reduces signing page-link reads from 37,211 to 1,479 and
canonical digest updates from 2,849 to 545 for the same fixture and hash bytes.
See the [access profile](../tools/outbox-spike/COMPACT-ACCESS.md#local-cursors-and-buffered-hashing-october-31).
These counts supply an offline improvement; silicon timing remains unproven.

Retain existing Pixel image pins, release CAP/assets, protocol, phone/host
bounds and durable journal barriers. A separately pinned image/lab profile and
approved named plan precede another physical invocation. ACS installation
attempts remain paused.

**Rejected:** raising timeouts or elapsed gates, reducing fixture size, persistent
cursor caches, dropping ownership/duplicate/integrity checks, bulk persistent
state writes, allocating another buffer, and treating simulator counters as
proof of physical completion.


The fixed `capacity-streamed` profile pins the image built from
`96eb11df58c0969e2d00a1d52a2ca726f8d2d971`: CAP
`b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`,
load `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048`,
28,067 bytes / 114 blocks. Its version-code-4 private APK uses a new consumed
journal key while preserving previous records. All three image profiles reject
interchanged load bytes before APDUs. The full fake workflow is 399 commands;
all existing ceilings and persistence barriers remain. Building the APK locally
opens no phone; physical execution still requires a named approved plan.


The closed recovery host also accepts the exact `streamed` image profile. Its
launcher binds the observed public key to the same attempt's pinned journal and
image. The reader bridge admits a compressed expected public key, retaining
the historical optimized key as its default. Unknown image profiles, malformed
keys and key arguments to other bridge profiles stop before device access.
The named hardware plan can include one conditional recovery connection with
the existing complete-export, independent-verification and cleanup gates;
SIGN and authentication are never retried.


**Physical follow-up (2026-10-31):** the streamed Pixel run confirmed all 128
inputs/outputs and received `9000` from SIGN at command 292, then hit the
elapsed gate before saving scope. Its already approved reader recovery found
the exact committed record, exported all 91 pages / 23,163 canonical bytes and
verified both signatures in Node plus independent Python. Scoped retirement
and private-only cleanup verified the original blank card and closed the reader
after 117 commands. The plan is consumed. This establishes full-fixture physical
signing/export/retirement capacity; the single-pass phone time budget remains
open. See the [hardware report](reports/HARDWARE_TEST_REPORT_2026-10-31.j3r180-full-capacity-recovery.md).

## D162: Private qualification phases and host timing evidence

**Decision (2026-10-31):** retain the physically qualified private image and add
a fixed eight-phase many-record recipe in the simulator. Capture 45 small
payments, prove refusal before consumption when the page pool is full, verify
every retained packet, retire and reload one slot, reject its stale retirement
scope, verify all current records and retire those exact scopes. Every phase
is bounded to at most 160 commands. The
[qualification guide](../tools/outbox-spike/PHASED-QUALIFICATION.md) records its
expected states and the remaining live executor requirements.

Record native and persistence envelopes separately in the private Pixel journal.
Retain an exact successful SIGN reply's public scope and native duration before
checking the elapsed gate. Mark persisted save counters as covering preceding
completed saves. Coalesce progress rendering by running stage while awaiting
every storage barrier and presenting all terminal updates.

**Why:** full-fixture physical signing/export capacity is established, but the
combined Pixel run exceeded its elapsed gate. Host timing separates bridge and
storage costs. The fixed record recipe addresses capacity refusal, preservation
and reuse independently of another full-size payment attempt. Its simulator
transcript is checked after execution; live use requires durable phase admission,
same-card/context/image fencing and reconciliation of uncertain writes before
further actions. Physical runtime and interrupted-write qualification remain open.

**Rejected:** raising elapsed limits, dropping durable saves, treating a received
scope as verified settlement evidence, re-signing an uncertain payment, retiring
a reused slot with its old scope, or presenting simulator phase counts as
physical timing evidence. Production firmware/assets and protocol remain
unchanged; another hardware invocation needs a new approved named plan.

## <a id="d163"></a>D163: Durable private phase execution and scoped reconciliation

**Decision (2026-10-31):** execute D162's fixed recipe through a local
injected-transport controller and an exclusive, atomically persisted file
journal. Derive progress from ordered receipts; bind the chip, installation
public key/context, qualified image, recipe, controller/codec/SDK and runtime.
Persist intent before each command, received replies before elapsed checks and
packet verification before scoped retirement. Keep the 30-second response,
120-second further-transmission and 160-command bounds for each invocation.

An uncertain command blocks normal execution. Reconcile a published SIGN by
reading and verifying its exact scope/packet and committed counts. Reconcile a
completed retirement by proving the old scope absent, every other retained packet
unchanged and the expected reclaimed state. Label these receipts as recovered.
Selection/public reads can complete the applet's existing recovery bookkeeping;
the reconciliation path issues no new signing, retirement, load, setup or
authentication command. Unsupported or inconsistent states require reviewed
recovery. See the [controller guide](../tools/outbox-spike/PHASED-QUALIFICATION.md#local-phase-controller).

**Why:** bounded phases need durable evidence across host restarts and lost
responses. A completed write with a missing reply cannot justify repeating the
payment. Exact packet identity/generation and retained-record checks also
prevent an old retirement acknowledgement from clearing a reused slot. The
local JavaCard test kills the signing host before reply delivery, verifies the
stale lease blocks execution, and reconciles from disk in a new process after
explicit test-only lease cleanup. It also drops a completed retirement reply.
Native duration remains a host envelope;
physical timing and interruption qualification are separate gates.

**Rejected:** trusting a saved cursor without receipt/packet validation,
automatically re-signing an uncertain payment, clearing a stale file lease on
restart, accepting a scope without its verified packet, or deleting unverified
records. This local iteration supplies the controller and simulator adapter;
device admission, installation, closed reader policy and hardware launchers still
need implementation/review before another approved physical run. Production
firmware, protocol, provisioner releases and earlier journals remain unchanged.

## <a id="d164"></a>D164: Closed USB phase programs and installation admission

**Decision (2026-11-01):** compile the next private phase invocation from the
validated journal into an exact ordered wire program. Keep this bridge separate
from GlobalPlatform installation and cleanup. Its independent Python policy
restricts commands to the named phase's synthetic fixture, checks the CPLC/key/
diagnostic/state fence and expected replies, and independently verifies canonical
retirement packets and both BIP-340 signatures before reader enumeration.
Recovery programs permit selection and public reads. Retain the per-invocation
30-second response, 120-second transmission and 160-command bounds.

Campaign admission binds explicit approval, clean local source, actual image and
runtime files, a dedicated installation-only phone receipt and the current phase
journal. Acquire the exclusive file lease before opening the device, preserve
the generated wire request and recheck static admission at the lazy connection.
Use isolated Python imports with a fresh cache prefix and the hashed pyscard
package. Retain the lease on startup/close uncertainty, including known process
IDs; clearing it requires reviewed recovery. Preview and error reporting keep
private configuration contents out of logs.

**Why:** the injected controller needs a transport that cannot broaden the
approved actions or confuse a previous capacity run with a newly installed
uninitialized test image. Exact phase programs fit the existing bounds and derive
retirement scopes from retained verified packets. The local JavaCard run checks
all 12 normal/recovery invocations against the independent wire policy, including
the killed signing host, lost retirement reply and refusal of a corrupted
retirement signature. The process transport is tested with an isolated fake PC/SC
package; physical timing remains unqualified. See the
[admission guide](../tools/outbox-spike/PHASED-QUALIFICATION.md#closed-usb-admission).

**Rejected:** expanding the earlier generic probe bridge, accepting an old
capacity/cleanup journal as installation evidence, trusting response lengths for
retirement authority, checking source/runtime only before acquiring the lease,
automatically removing an uncertain lease, and raising deadlines to admit a run.
This iteration stays local. The dedicated Pixel installation-only build and
receipt generator remain the next step; another physical run requires a complete
named plan and fresh approval. Production firmware and store releases remain
unchanged.

## <a id="d165"></a>D165: Rehearse card-carried settlement through a portable relay and the real till

**Decision (2026-11-04):** add a portable private packet decoder, durable paged
capture/resume and exact-payment reconciliation engine against the existing
candidate descriptor. Inject cryptography, an approved HTTP transport and durable
storage. Revalidate both card signatures, the mint/card/installation context and
scope before mint work. Save submission intent, reconcile a lost response using
complete original output signatures and every input state, and distinguish helper
`outputs-confirmed` evidence from the till's independent proceeds/accounting.

Connect the unchanged private JavaCard engine to Flash POS's actual preparation,
signature, merchant recovery and inventory code through fresh host processes.
Keep the merchant's openings solely in its protected synthetic store. Exercise
both local mint keyset shapes, lost successful swap replies, mint restart, a POS
process killed after its synced inventory write, replay and a barrier-controlled
phone/till submission race. Bind retained software evidence to actual source
hashes. The runner creates only uniquely named, loopback-published FakeWallet
services on a dedicated Docker network and cleans up its own services. A public
per-campaign seed and in-container keyset checks bind the host endpoints to this
campaign's newly created mints.

**Why:** private signing/export capacity and isolated restore rehearsals do not
establish the full merchant outcome. This slice connects the carrier, a
phone-compatible engine and the deployed-code accounting boundaries in one local
test. See the [run guide](../tools/assisted-relay/README.md). Network work occurs
after packet capture, outside NFC. There is no destructive card operation in the
relay engine.

**Rejected:** showing merchant settlement from input consumption alone, replacing
outputs after an ambiguous swap, crediting restored inventory twice, placing
merchant openings in the relay, trusting a cached confirmed flag, fetching an
arbitrary packet URL, or treating a simulator/native-free runtime test as physical
phone qualification. A reserved logical mint maps to explicit loopback origins
only in this demonstration. Production transport, holder authorization, final
wire/limits and partner review remain open. Released firmware/assets, app
capabilities and hardware approvals remain unchanged.

## <a id="d166"></a>D166: Recover only the independently identified, installed unset-up private image

**Decision (2026-11-04):** add a separate host and independent Python policy for
`recover-unset-up-v3`. Fix the observed chip, public installation key, exact
installed registry and original platform records in a public profile derived
from the retained audit. Admit only the unset-up diagnostic state through the
unchanged validator. Read the key, reconfirm identity and the complete registry,
then delete main, opener and package in that order. Verify full applications and
load-files again, final identity and confirmed reader closure. Require independent
policy completion before declaring blank. An isolated decoder also rechecks the
newly persisted registry snapshots, diagnostics, key and final identity receipts
before closure and a successful outcome.

A private campaign binds a clean source commit, final plan, tracked operator
approval, runtime files and a fixed fresh journal. Default preview performs only
local reads. Recheck the source, runtime and historical evidence after durable
one-shot consumption, immediately before opening one isolated exclusive reader
connection. Preserve a permanent consumption marker, persist each command intent
and public reply, and retain the journal lock when closure is uncertain. Neither
controller nor bridge retries. Commands remain bounded by the plan's exact stage
sequence, four pages per registry kind, 64-command ceiling and 120-second gate;
responses have a 30-second bound. Authentication bodies are excluded from receipts.

**Why:** correcting the stale chip identity alone does not make the earlier
initialized recovery flow usable. The private JavaCard dispatcher refuses its
status/scope commands before setup. Saved registry evidence also includes the
private load-file, so deleting two instances or scanning only applications cannot
prove blank. Synthetic SCP02 and isolated fake PC/SC tests, plus actual JavaCard
logic in a simulator, exercise the new path without a device.

**Rejected:** weakening initialized recovery, allowing another card/key or registry
object, setting up the card to make recovery work, fabricating readiness replies,
authentication retries, accepting an unconfirmed disconnect, or reusing consumed
plans/journals. The tracked execution approval remains false. This change grants
no hardware permission; the [named plan](reports/HARDWARE_PLAN_2026-11-04.recover-unset-up-3.md)
requires a separate operator execution decision. Released applets, CAPs and phone
applications are unchanged.

## <a id="d167"></a>D167: Select 07297620 with its own readiness and creation gates

**Decision (2026-11-04):** follow the operator's replacement-card selection and
plan the assisted-payment work on `cplc-v1:4790d3213180072976207515`. Preserve
D153's exact four-file baseline, including CardDocLite. Its saved cleanup proves
historical blank state; the fresh identity read does not prove current blank
state. Prepare a no-deletion readiness campaign first, then a separately scoped
phone creation control before the smallest physical payment/relay/till case.

**Why:** this card's last recorded state is blank after separate cleanup, while
the stopped unset-up image/key belonged to a different identity. Two earlier ACS
creation attempts on 07297620 stopped before setup; their cause remains unknown.
Another card's Pixel creation result is a reason to prepare an independent
phone control, not evidence that this card supports that image. Keep the session
acceptance condition at independently recovered merchant proceeds exactly once.

**Rejected:** changing the consumed recovery plan's identity/key, erasing a card
based on historical state, dropping its fourth platform file, another blind ACS
installation, widening the full-slot qualification guard, or treating target
selection as approval of new hardware actions. No released firmware, protocol,
phone asset or global profile changes. See the
[replacement plan](reports/PLAN_2026-11-04.adopt-07297620.md).

## <a id="d168"></a>D168: Qualify 07297620 readiness without reusing cleanup authority

**Decision (2026-11-04):** implement a separate fixed readiness host and
independent Python policy under the operator's instruction to execute the
07297620 replacement plan. Match that exact CPLC before one proved factory
channel, read both complete registry kinds, require its exact four-file blank
baseline, recheck identity, independently decode saved evidence and confirm
closure. No install, delete or private command is admitted. Retain durable
single-use consumption, synced public evidence, bounded responses and uncertain
closure locks.

**Why:** the selected card's last recorded state is blank, and its fresh identity
read alone cannot establish that state now. Carrying the previous card's unset-up
cleanup policy over would assume a foreign installation key, a wrong registry
baseline and unnecessary deletion authority. The new dedicated profile leaves
old profiles, policies, CAPs and evidence intact.

**Rejected:** treating identity as readiness, broadening the older recovery
policy, declaring blank from applications alone, authenticating without a proved
factory cryptogram, or automatically installing after a readiness result. See the
[named execution plan](reports/HARDWARE_PLAN_2026-11-04.readiness-07297620.md).

## <a id="d169"></a>D169: Recheck readiness only after an operator-reported external reset

**Decision (2026-11-05):** prepare one explicitly named v2 readiness invocation
for 07297620 after the operator reported a reset and returned it to the reader.
Keep the original consumed v1 campaign/profile/journal intact. Reuse the exact
wire predicates, expected chip, public factory-key proof, four-file baseline,
15-command ceiling and deadlines. Bind a distinct fixed journal and profile to
v2; unknown plan labels are rejected before transmission. The independent Python
successor checks that all device/baseline fields equal the original before use.

**Why:** an operator action changes the premise for a fresh check, but is not
proof of restored keys or blank state. The first check stopped before external
authentication; the new one must still prove the factory cryptogram and complete
registry. It must not erase or provision a card based on the reset claim alone.

**Rejected:** deleting a consumed marker, moving or rewriting an old journal,
trying another key set, assuming reset released an ops fence, broadening device
or command admission, or automatically repeating a failed check. See the
[post-reset plan](reports/HARDWARE_PLAN_2026-11-05.readiness-07297620-2.md).

## <a id="d170"></a>D170: Isolate 07297620's phone creation control and retain its installation

**Decision (2026-11-05):** use a separate offline Android debug app and portable
creation controller for the operator-selected 07297620 and available Pixel 8 Pro.
Bind the exact streamed image and this card's four-file baseline. Check complete
registry sets before loading and after opener/main creation, record unset-up
format-5 diagnostics and a newly observed valid public key, then rematch CPLC.
Leave the installation intact for the separately planned small payment test.

Use a distinct application ID/journal, consumed before NFC, and no replacement
of existing app storage. The new generator preserves production sources/assets
and does not broaden the older Pixel policies or NFC patch allowlist. Keep one
factory channel, fixed APDUs, deadlines and stop-on-uncertainty behavior. No
SETUP, proof, payment, key rotation or cleanup belongs to this invocation.

**Why:** 07297620's fresh readiness now proves factory authority and its exact
blank baseline, but its earlier USB main creation stopped. Another card's phone
success does not establish creation on this card. A retained installation/key
receipt supplies the correct provenance for the next physical signing/export
and helper/till tests without a gratuitous reinstall.

**Rejected:** editing global card profiles, accepting instances without a package
record, inventing the new key, erasing after uncertain creation, replacing an
old lab app/journal, raising timeouts, or calling a synthetic success silicon
qualification. See the [named plan](reports/HARDWARE_PLAN_2026-11-05.pixel-07297620-create.md).

## <a id="d171"></a>D171: Inspect uncertain 07297620 creation through registry reads only

**Decision (2026-11-05):** prepare a separate, initially unapproved single-use
inspection of 07297620 after the Pixel's unconfirmed main-creation reply. Match
its CPLC, prove one public factory channel, read both complete registry kinds,
rematch identity, replay the saved public evidence independently and confirm
closure. Require the four original platform frames, private package and opener;
classify the main frame as present or absent. No private applet command is needed.

**Why:** LOAD and opener acknowledgements establish neither main absence nor a
usable applet. A narrowly bounded registry read can resolve membership without
running, recreating or erasing the uncertain instance. Keep a new profile,
transport, native policy and journal so every old guard and consumed invocation
stays intact. Preparation approval is not device execution approval.

**Rejected:** retrying creation, treating an absent reply as a card status,
weakening a blank-state validator to accept an installation, selecting the main
applet merely to determine registry membership, dropping CardDocLite or the
package frame, and automatically continuing after inspection. See the
[named plan](reports/HARDWARE_PLAN_2026-11-05.inspect-07297620.md).

## <a id="d172"></a>D172: Read current public resources before another constructor experiment

**Decision (2026-11-05):** after 07297620's main was absent from the complete
registry, prepare one separate, initially unapproved five-command public ISD
memory snapshot. Match CPLC before and after one exact FF21 read; require known
framing, independent saved receipt replay, durable consumption and closure.
There is no authentication or private applet command and no installation change.

**Why:** the retained image has the original constructor/fields/signer and the
expected 50-reference converted shape, while its large compact/DLEQ allocations
are deferred beyond the failed stage. Current resources remain unmeasured; the
October 28 post-cleanup counters predate this installation and an operator reset.
An availability snapshot can inform the next diagnostic decision without
repeating construction or selecting the uncertain applet.

**Rejected:** calling constructor equality proof of silicon fit, inferring a
largest allocation or transaction budget from counters, blind installation or
padding retries, raising timeouts, dropping baseline objects, and reusing the
consumed inspection approval. See the
[named plan](reports/HARDWARE_PLAN_2026-11-05.memory-07297620.md).

## <a id="d173"></a>D173: Register only a private diagnostic after a catchable constructor fault

**Decision (2026-11-05):** prepare a separate constructor-only diagnostic image
in namespace `F0434153485543545243`. Preserve original instance fields and ordered
initialization operations, add source-bound stage calls, catch bounded JavaCard
API/runtime exceptions inside the constructor, and expose only a read-only
status from the resulting diagnostic instance. Keep every allocation at install
time, disable legacy selection/shared-interface behavior, and require the same
converted 50-reference class shape. Released code, images and guards stay intact.

**Why:** the selected card's main is absent after an unconfirmed creation, while
source budgets and public counters do not identify an operation. A caught API
fault can be recorded before diagnostic registration commits that result. An
INSTALL acknowledgement must therefore be distinguished from constructor
completion; a partial diagnostic is never a Cashu payment applet.

**Rejected:** trusting non-atomic breadcrumbs after failed installation,
application-driven transaction abort while allocating, moving allocations onto
APDU paths, exporting secrets, retrying a stage, weakening older private guards,
or asserting that instrumentation preserves the original image's silicon fit.
An unconfirmed diagnostic INSTALL remains inconclusive and stops. See the
[design and offline checks](../tools/outbox-spike/CONSTRUCTOR-TRACE.md).
No device access is authorized by this decision or source-only preparation.

## <a id="d174"></a>D174: Fix host hashing and isolate a fresh diagnostic invocation

**Decision (2026-11-05):** normalize the diagnostic controller's byte-array load
with `Buffer.from` before the default SHA-256 call. Test that actual default path
and stop injecting a hash in real-artifact native-process fixtures. Preserve the
first invocation's zero-command journal/marker. Prepare an unapproved v2 with a
fixed separate journal, native wrapper and transport, allowing only its explicit
label while requiring equality of every device/image/registry field with v1.

**Why:** the host rejected an array before identity or native startup, but the
one-use attempt was already consumed. Tests with a substituted hash missed the
real input contract. Correcting the host does not imply a new card result or
authorize rearming old evidence. V2 requests exactly the previously reviewed
physical scope; its execution requires a fresh decision.

**Rejected:** deleting consumption, rewriting a zero-command journal as success,
claiming a reader closure was observed when none opened, changing CAP/timeout,
or carrying approval across a consumed invocation. See the
[incident](reports/HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-constructor-host-stop.md)
and [fresh proposal](reports/HARDWARE_PLAN_2026-11-05.constructor-trace-07297620-2.md).

## <a id="d175"></a>D175: The release applet keeps the last SIG_ALL payment's settlement packet (2.2, GET_OUTBOX)

**Decided (ENG-819, 2026-11-05):** applet 2.2 keeps one self-contained record of
its last successful SIG_ALL payment, as the assisted-settlement packet in the
order the portable relay reads it (`tools/assisted-relay/relay.js`,
[cashucard/nut#6](https://github.com/cashucard/nut/pull/6)), and serves it to
anyone with the new INS `1B`, `GET_OUTBOX` ([`spec/APDU.md`](../spec/APDU.md#get_outbox-0x1b)).
P1 `00` answers the 45-byte scope (index, payment id, generation, SHA-256 of the
body); P1 `01` a page of `offset (2) ‖ count (1)`. No PIN and no grant: the packet
says what the till already holds and nothing in it can spend. SELECT answers
`02 02`; nothing else on the wire moves. The record goes in the release applet,
not in the private compact image of [D150](#d150): the compact image's
allocation is still unresolved on the chip, and the relay needs a card a phone
can actually be handed.

**How it is kept.** (Amended by [D176](#d176): the J3R180 refused this
constructor, so the record and the staging are reserved at the first `SET_CARD`;
the installation and the generation stay at install.) Four arrays, all made in the constructor (no transient RAM,
no class added): the record (3,692 bytes: a head of four and a packet of at most
3,688), the outputs of the payment in hand (593), the installation's 32 random
bytes (drawn at install, kept through `RESET_CARD`) and the generation (4: 1 at
install, one more at each reset). 4,321 bytes in all, accepted above the "about
4 KB" of the brief so that a separate stage keeps the last record whole through a
payment that is refused or dropped. `SPEND_ALL_SIGN` writes the record after the
payment's receipt, by itself, in [D14](#d14)'s order: the status byte to 0 in a
transaction, the body outside any transaction, then the length and status 1 in
one transaction. A tear leaves a whole record or none, never a mix; a tear
between the receipt and the record leaves the payment made with no record. The
descriptor (the card key's BIP-340 signature over SHA-256(tag ‖ tag ‖ body),
tag = SHA-256(`CashuCard/assisted-settlement/v1`)) is made at the first read and
kept. A failure in the record never changes the payment's answer.

**The limits of 2.2, known to ENG-820 and ENG-821.**
1. *Output keysets.* `SPEND_ALL_OUTPUTS` carries no keyset, and adding one would
   move the wire, so every output is recorded under the first input's 8-byte
   keyset, as the card's own change always is. A till that blinds an output for
   another keyset, or for a 33-byte one, gets a packet the mint refuses.
2. *Dated pieces.* The packet has no field for a locktime or a refund key, and
   the relay rebuilds the undated secret, so a payment of dated pieces leaves no
   record (flash-mobile never dates its pieces). A profile `02` is the way to
   them, in the shared contract first.
3. *Payment id.* It is the receipt count (`RESET_CARD` sets it back to 0), unique
   only together with the generation.

No record is left for more than 32 inputs or 16 outputs, no outputs or one of 0,
a mint that is not `https://`, or a receipt count or generation at `FFFFFFFF`.
The CAP keeps its name, `cashu-javacard-2.1.0.cap`, and build.xml its version,
to keep the pins few; a rename waits for the next version.

**Around it.** [D28](#d28)'s kept gaps are untouched. `cardctl selftest` keeps
its floor at 2.1, and cardkit (inspect, holder commands, reset review) and the
provisioner read 2.1 and 2.2 cards alike, since 2.2 only adds a read; the
provisioner installs and verifies 2.2. The private outbox spike's builders
(`build-probe.py`, `build-compact.py`, `build-constructor-trace.py`) now take
the released 2.1 sources frozen in `tools/outbox-spike/control/`, since their
images are that known control plus a diagnostic and D147's class-shape check is
the control's; the release applet's four new references would otherwise fail it.

**Not yet shown.** No J3R180 has installed 2.2. The load file is 21,540 bytes,
a size refcheck has no answer for, and the constructor asks for 4,321 bytes more
than the build that installs; allocation is where the compact image failed.
SIGN writes about 500 more bytes for two inputs and two outputs, 3.6 KB at the
most, against an unmeasured tap budget, and the first read's signature may meet
a phone's NFC timeout (a retry is safe). jCardSim cannot tear a write, so the
tests set the torn states directly. Until ENG-818 installs it on silicon, the
tracked CAP is the plan's, not the chip's.

**Shown on 2026-11-06** (amended by D176, which moved the record's allocation out
of the constructor after the chip refused it): the whole flow ran on a J3R180
with the production mint, SIGN wrote the packet, the phone relayed it and the till
recovered 7 sat once
([the end-to-end report](reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-assisted-settlement.md)).

**Rejected:** a new `spec/NUT-XX.md` here (cashucard/javacard mirrors this
`spec/` and has its own); staging the outputs inside the record (a refused
payment would erase the last record); a keyset per output (a wire change);
putting the record in the compact image.

## <a id="d176"></a>D176: The outbox is reserved at the first SET_CARD, not at install

**Decided (ENG-823, 2026-11-06):** the two large arrays of [D175](#d175)'s
assisted-settlement record, the record itself (`outbox`, 3,692 bytes) and the
staging of the payment in hand (`outStage`, 593), are no longer made in the
constructor. The first `SET_CARD` that goes through reserves them, once, each
behind its own null guard, outside any transaction and before the one that
writes the card's record, right after the store of the mint's proofs
([D17](#d17)), whose room matters more. The installation's 32 random bytes and
the generation (4) stay in the constructor: they are facts of the install, and
36 bytes is within what the chip gives there. SELECT still answers `02 02` (no
card has had 2.2), and the CAP keeps its name.

**The measurement (2026-11-06 about 07:12Z, J3R180 CPLC 09336320, ACR122U,
gp v25.10.20, factory keys, SCP02):**

| CAP | `--install` (load and opener) | `--create` card applet `F043415348554341524401` | `--create` tag `D2760000850101` |
| --- | --- | --- | --- |
| 2.2 first build, sha256 `51ddeee44c2fabc369c115d69bd05594478f11867ea75ca1784698222d32ea37`, load file 21,540 B | ok: 88 LOAD blocks, 14.68 s, package LOADED, opener SELECTABLE | **`6F00` after 1.76 s** | not reached |
| 2.1 release, sha256 `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` (control, same card, 2 min later) | ok: 82 blocks, 13.79 s | ok, 2.19 s | ok, 1.02 s |

The cause of the refusal is inferred, not shown. The likely one is the
constructor's 4,321 extra persistent bytes, the install-time allocation limit
[D17](#d17) and [D10](#d10) already record:
+300 bytes in a constructor installed, +12,288 did not, and the same bytes asked
for by a command after the install were given. Nothing on the bench separated
that from the size window refcheck tracks (the same code failing a few dozen
bytes either side of a size that installs), so refcheck's table records 21,540
as a size that failed, the only measurement there. The same `6F00` came from card
07297620, but that card refused the compact image's main applet too
(ENG-817), so it is no evidence
either way. Full report:
[HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md](reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md).

**While null.** Every use of the two arrays is safe while they are null: a card
not yet set up, or one whose `SET_CARD` was refused the room (or the staging's
after the record's), keeps no record. `SPEND_ALL_BEGIN` and the output and
change staging do nothing, `SPEND_ALL_SIGN` signs, burns and receipts the payment
as ever and writes no record, and `GET_OUTBOX` answers `6A88` to both forms, the
same answer as a card with no record yet, so the wire of ENG-820 (flash-mobile
`relay.js`) and ENG-821 (flash-pos) is unchanged. `RESET_CARD` still steps the
generation. A later `SET_CARD` asks for the room again, as D17's store does.

**Pinned by** `SchnorrHWMathTest.theOutboxIsReservedInSetCardAndNowhereElse`
and the two new once-only allocations in `ONCE_ONLY_ALLOCATIONS`; the
constructor's persistent total is back to 29,842 bytes (1.19's 29,806 and the
36). `OutboxTest` covers the null cases.

**Shown on 2026-11-06.** The fixed build (load file 21,631 bytes, 91 more than the
one that loaded) installed on the same J3R180, 09336320: 88 LOAD blocks, the card
applet created in 2.17 s, the tag after it, `cardctl info` answering 2.2 and
`cardctl outbox` 6A88 (the report). That does not tell the two causes apart (a new
size and a smaller constructor at once), so 21,540 stays a failed size in refcheck's
table and 21,631 is added as one that installs.

**Shown on 2026-11-06, later the same morning.** The first `SET_CARD` from the
phone was given the room: the first payment's `GET_OUTBOX` returned a valid
631-byte packet, the phone relayed it and the till recovered its 7 sat once
([the end-to-end report](reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-assisted-settlement.md)).

**Rejected:** shrinking `OUTBOX_MAX` (out of scope, and +300 bytes is the largest
constructor growth measured to install, far below even a minimal record);
reserving the arrays on the first `SPEND_ALL_SIGN` (an allocation on the payment
path, and a record that appears on some payments and not others); dropping the
staging array and staging in the record (D175 rejected it: a refused payment
would erase the last record).

## <a id="d177"></a>D177: cashucard/javacard is archived; `spec/` lives here alone

**Decided (2026-11-06):** `cashucard/javacard`, the repository this one was
copied from, is archived on GitHub: read-only, its history and releases kept for
reference, its `spec/` left at protocol 2.1. `tools/mirror-spec.sh` and its test
are removed with CI's `tools` job; `spec/` is made here and mirrored nowhere.

**Why.** The mirror could not carry 2.2: that repository's CI requires its
`spec/`, its own applet and its cardctl to agree, and its applet and cardctl are
2.1 (cashucard/javacard#45, closed). Keeping two applets in step would have meant
porting every applet change twice for a repository with no users of its own; the
owner chose to archive it rather than port 2.2 there. One repository, one spec,
one applet.

**What stays.** Historical links to `cashucard/javacard` in reports, decisions,
`FORK.md`, `docs/FOR-LNFLASH.md`, `docs/FOXY-CARD-SPEC.md` and `docs/PROVENANCE.md`
are left as written: they describe what happened. The `cashu-javacard-*.cap` file
name and package name are unchanged. An issue still open there at archiving
(cashucard/javacard#27, CLEAR_SPENT in the 0.2 top-up flow) is read-only with the
rest and is tracked here if it still applies.

## <a id="d178"></a>D178: the Android upload key was rotated for build 14

**Decided (2026-11-07):** build 14's AAB is signed with a new upload key, a
4096-bit RSA key under `CN=Cashu Provisioner, OU=LNFlash, O=Island Bitcoin LLC`
with certificate SHA-256
`06:FF:95:3B:AC:96:E7:46:5B:2F:00:C9:42:9C:CB:2D:3F:B0:E1:96:CD:7C:FB:05:81:2E:65:D5:C8:AA:C5:FF`.
The owner requested a Play Console upload-key reset for that certificate; until
Google completes it, the build 14 bundle is published on GitHub but cannot be
uploaded to Play.

**Why.** The key that signed builds 9 through 13 (same subject, certificate
`D1:C1:DE:8B:…:3D:1B:5E`, made 2026-10-19) exists only as a PKCS12 file whose
password was never recorded anywhere: not in the macOS Keychain, not in an
environment file, not in any agent transcript on either Mac. The sessions that
built with it read the password from the shell they were launched from. With
Play App Signing the upload key is replaceable and the app signing key is not,
so a reset costs a day of waiting and nothing else; guessing or waiting for the
password to turn up had no end.

**What changes.** The replacement follows the convention the Foxy and
Fedimint provisioners already use: the keystore lives outside every repository
at `~/.cashucard-android/cashucard-upload.jks` (alias `cashucard-upload`), its
random password is a Keychain item (service `cashucard-android-upload`, account
`cashucard-upload`), and Gradle receives both through the `CASHU_ANDROID_UPLOAD_*`
variables (README § Android upload signing). The old `release.keystore` under
`apps/provisioner/android/app/` in a local checkout is dead and may be deleted
once the reset is complete. The README's rule against generating a replacement
key stands for the normal case; this entry is the one reviewed exception.

## <a id="d179"></a>D179: the ops default mint list is probed, forge first, Minibits at /Bitcoin

**Decided (2026-11-08):** the ops service's code-owned default mint list
(`ops/src/config.ts` `DEFAULT_MINTS`) is, in order, `https://forge.flashapp.me`,
`https://mint.minibits.cash/Bitcoin`, `https://mint.macadamia.cash` and
`https://mint.cubabitcoin.org`. When no `OPS_MINTS` is set, `GET /mints` serves
the defaults that pass a live probe (`/v1/info` answers a JSON object and
`/v1/keysets` a non-empty `keysets` array, both a plain 200, redirects not
followed). A failing mint is dropped and logged. The probe is lazy (the first
`GET /mints` per Durable Object instance or Node process, after the session
check), coalesced, and cached for 10 minutes; when every mint fails, the
last-good list is served, or an empty list if there never was one, and the
probe is retried after a minute. An `OPS_MINTS` override is served as given,
unprobed. This supersedes D133's sentence on the default list's order and
contents; the rest of D133 stands.

**Why.** The list carried `https://mint.minibits.cash`, whose `/v1/info` answers
404 (cashucard#239): Minibits serves its Cashu mint under `/Bitcoin`, so any
batch set up with that reference named a mint no wallet can reach. Production
sets no `OPS_MINTS`, so the code defaults are what operators see. Probing at
serve time keeps a dead entry from reaching a batch again; the daily
`ops-mint-probe` workflow opens a GitHub issue when an entry fails, so the list
gets fixed in code rather than silently shrinking. All four mints stay because
the holder-wallet fence that limited membership is gone (ENG-831): membership
now means reachable and acceptable at the till. Forge is first because
fast-start preselects the first entry for a new operator, and forge is the mint
the holder wallet funds today; D133's concern about preselecting one issuer's
mint is outweighed by a default a new card can actually be funded at.

**Rejected:** serving the unprobed defaults or a 503 when every probe fails
(the app already handles an empty list by letting the operator enter a batch
reference), probing in the Durable Object constructor (a slow mint would stall
every request, issuance included), probing `OPS_MINTS` (staging names a local
`http://127.0.0.1:3338` that would always be dropped), running the live probe
in pull-request CI (a third-party outage would block merges), and tightening
the `OPS_MINTS` validation in the same change.

## <a id="d180"></a>D180: the ops service discovers mints over NIP-87, gated like the defaults

**Decided (2026-11-08):** when no `OPS_MINTS` is set, `GET /mints` serves the
probed defaults (D179) in their order, then up to 10 mints discovered the way
cashu.me finds them: kind 38172 announcements and kind 38000 reviews tagged
`k=38172` from `wss://relay.damus.io`, `wss://nos.lol` and
`wss://relay.primal.net` (`ops/src/discovery.ts`). Every event's id and BIP-340
signature is checked; an event dated more than 10 minutes ahead, a review older
than 24 months, an announcement whose `n` is not `mainnet` and a review without
`k=38172` or a `u` are ignored. URLs are normalized (https, a public DNS name,
no port, userinfo, query or fragment) before they are grouped. A discovered
mint is offered only with an announcement and at least 3 distinct reviewing
keys; an announcement with no reviews is never offered. Candidates are ranked by
reviewer count, then URL; the top 15 are probed and the first 10 that pass are
kept. The probe is the defaults' probe, which now also requires an active `sat`
keyset, for the defaults too. Responses add `mint_info`, keyed by URL, with the
review count and the mint's `/v1/info` name (control and bidi characters
removed, 40 characters at most); reviewer text is never passed on, and `mints`
stays a plain string array for older builds. A request never waits on a relay:
the last-good set is served and, once it is an hour old, refreshed in the
background; when no relay answers the old set stays and the refresh is retried
after a minute. The set persists in the Durable Object's storage
(`mint-discovery`), so a restarted object serves it at once; the Node server
keeps it in memory. `GET /mints/probe?url=` runs the same probe on a written-in
mint for the provisioner, behind a session; batch creation itself still accepts
any http(s) reference, so staging's local mint keeps working.
`OPS_MINT_DISCOVERY=off` turns discovery off; `OPS_MINT_DENYLIST` (a JSON array)
removes a discovered mint without a code change, and an unreadable denylist
turns discovery off rather than ignoring it. This extends D179 and supersedes
what D133 still said about how the provisioner's mint choice is drawn.

**Why.** With the holder wallet funding at any mint (ENG-831), four fixed URLs
are too few, and the owner asked for cashu.me's method. Discovery runs in ops,
not the app, because the probe gate already lives there and every operator
sees the same list. A provisioner writes the chosen URL into every card in a
batch, so the bar is higher than cashu.me's: signatures stop relay forgery,
the reviewer floor and the cap limit cheap keys, the probe proves the mint is
reachable and issues sats, and the denylist and the operator's own choice are
the last defences. The sat gate applies to the defaults so every offered mint
passes one rule; the four defaults passed it on 2026-11-08. A local workerd run
(`wrangler dev`, no `OPS_MINTS`) received 72 relay events over the Durable
Object's outbound WebSockets, so no cron fallback is needed. On that day the
relays held two announcements and neither had three reviews, so the discovered
set starts empty and grows as mints publish announcements.

**Rejected:** discovery in the provisioner app (each operator would see a
different list and the gate would be duplicated), the audit.8333.space auditor
in v1 (a third-party single point of failure), passing on reviewer prose,
counting unverified events, discovering in the Durable Object constructor (a
relay stall would block every request), and probing discovered mints from the
daily `ops-mint-probe` job (it stays a check of the code-owned list).

## <a id="d181"></a>D181: cardkit speaks SCP03 beside SCP02, chosen from INITIALIZE UPDATE's reply

**Decided (ENG-836, 2026-11-09):** cardkit opens a secure channel through one
`openSession`, which reads the protocol from byte 11 of INITIALIZE UPDATE's
reply: 28 bytes with `02` is SCP02 (the J3R180, [D27](#d27)), `03` is SCP03
(the NXP J3R452, JCOP 4.5), 32 bytes at the one i taken, and anything else is
refused as the card's fault with nothing more sent. `provision`, `rotateKeys`
and `resetOwnedCard` never choose. SCP03 runs as GlobalPlatform Amendment D has
it at security level 01, C-MAC only, with AES-128 keys and i=10:

- The card proves the keys twice, and both are checked on the phone before
  EXTERNAL AUTHENTICATE goes out: its pseudo-random challenge (the static ENC
  key's KDF, constant `02`, over the 3-byte counter and the security domain's
  AID) and its cryptogram (S-MAC's, constant `00`, over both challenges). Wrong
  keys, or a challenge made for another security domain, throw WrongKeys after
  INITIALIZE UPDATE alone. A reply whose i reports a random challenge (bit
  `10` clear) is refused: its cryptogram would still prove the MAC key before
  the login, which is all EXTERNAL AUTHENTICATE uses at level 01, but only the
  pseudo-random challenge proves the ENC key and the security domain, and no
  card here opens i=00, so none was captured. So is S16 (bit `01`), whose
  16-byte challenges, cryptograms and MACs are not written here. i is
  read before the length, which follows it as Amendment D's Table 7-3 and
  GlobalPlatformPro's GPSession have it (`scp03ReplyLength`: 29 bytes, 3 more
  for the counter a pseudo-random challenge brings, 16 more in S16), so a card
  that opens either is refused for that cause after its one APDU, not for a
  byte count.
- S-MAC (constant `06`) and S-ENC (`04`) come from the KDF over host ‖ card
  challenge; the static DEK is used as it is. EXTERNAL AUTHENTICATE is
  `84 82 01 00` with the host cryptogram (S-MAC's KDF, constant `01`), as under
  SCP02. Each C-MAC is the first 8 bytes of CMAC(S-MAC, chaining value ‖ the
  header as sent ‖ data), chained through the previous command's full 16-byte
  CMAC from 16 zeros, with Le outside it. At level 01 the card's replies carry
  data and status only: no R-MAC is expected, stripped or checked.
- `putKeys(keys, session, …)` takes the open session and follows its protocol,
  never a caller's flag: `80 10 <3DES-ECB under S-DEK> 03 <KCV>` under SCP02,
  `88 11 10 <AES-ECB under the static DEK> 03 <AES-ECB(key, 16 × 01)[0..3]>`
  under SCP03 (`504A77` is the public default's check value). The raw-DEK form
  is gone, so a caller cannot put DES3 entries on an SCP03 card.
- On an SCP03 card the install's sweep reads the registry first (GET STATUS
  of the applications and of the load files, `readCashuRegistry`) and deletes
  nothing, stopping `guarded`, unless every Cashu object it lists is the Cashu
  package's. The J3R452 test card came with the seller's NDEF tag at
  `D2760000850101`, made from `D276000085` (`scp03-07`), which is the AID the
  card's tag takes, and the sweep, whose job is clearing what a torn run left,
  would otherwise delete it on the first install. A torn install of the card's
  own still comes back: the registry shows its objects as the package's. SCP02's
  sweep sends what it always has, byte for byte (the J3R180 comes blank, and
  its transcripts stand), and a sweep that names no Cashu AID, the hello
  plan's, reads nothing.
- The security domain's AID is a run option, `sdAid`, the ISD's
  `A000000151000000` by default, which both chips use: provision and rotation
  select it, log in to it and name it in INSTALL [for load], and an SCP03
  install reads the registry for it (`readCashuRegistry` takes the domain, the
  ISD by default). `readChipIdentity` still reads the ISD, and so does the
  reset's registry check (`inspectInstallation` selects applets by AID and has
  no domain to take), so `resetOwnedCard` takes the ISD alone: any other
  `sdAid` stops it `guarded` before its first APDU, where it would otherwise
  save `delete_intent` and then stop at the registry on every retry. Nothing
  threads `sdAid` through them until a security domain other than the ISD is
  needed ([D182](#d182)).

**Why.** The J3R452 opens SCP03 only, and both cardkits spoke SCP02 only. D27's
revisit clause ("Revisit if a later chip ships a factory AES set") has fired: the
J3R452 ships three AES-128 keys (key type `88`), and since 2026-11-08 the test
card is on the public default `40` to `4F` at key version 01. The owner's
`gp -d` captures of it under that key, `scp03-07` to `scp03-10` in
`tools/cardkit/gp/test/fixtures`, fix the wire: every session key, both
cryptograms and all 49 commands under the C-MAC replay byte for byte, as do the
INSTALL [for load], the LOAD blocks and the INSTALL of a probe package. The
fake card gained an SCP03 mode (the 32-byte reply, the counter every
INITIALIZE UPDATE advances, the full-CMAC chain, AES PUT KEY with the check
value enforced), so the install, the rotation with its lost-reply path, and the
reset run under both protocols, and the seller's four applets
(`sellerApplets`), whose GET STATUS of the applications is the J3R452's own
bytes in `scp03-07`, so the install also runs on the card as it came.

**AES from a package, where D27 wrote its own DES.** D27 rejected unmaintained
DES packages for a cipher that fits in a page of tables. AES is the other way
round on both counts: `@noble/ciphers` is maintained and was audited (Cure53,
2024, by its README), pure JavaScript with no dependency and no native build,
from the author of the `@noble/curves` and `@noble/hashes` cardkit already uses;
and an AES of cardkit's own would be more code, and more ways to get a key
schedule wrong, than the CMAC (NIST SP 800-38B) and the KDF (NIST SP 800-108 in
counter mode, as Amendment D uses it) written on top of it in `gp/scp03.ts`. The
tests hold the AES to FIPS 197, the CMAC to SP 800-38B's four AES-128 examples,
and all three to node:crypto (`testing/node-aes.ts`, which shares no code with
them). The pin is exact, `1.3.0`: the last 1.x, CommonJS, with types that build
under the TypeScript 5.0.4 both consumers pin; 2.x is ESM-only and needs a newer
compiler.

**Proven, and not yet.** The captures prove the challenge (`02`), both
cryptograms (`00`, `01`) and S-MAC (`06`, through every C-MAC). S-ENC (`04`) is
the specification's alone: nothing at level 01 uses it. PUT KEY's AES-ECB under
the static DEK rests on the specification and on the shape of the owner's one
SCP03 PUT KEY, which was made under the seller's keys and is not in this
repository: 70 bytes of data, three `88 11 10` entries, answered with the new
version and three check values. In-place replace (P1 the current version), the
path `rotateKeys` and the reset take, was never traced on a J3R452: slice 3 runs
the rotation and the reset on the spare before any field card. A wrong DEK is as
invisible before EXTERNAL AUTHENTICATE as under SCP02; the card's check value
catches it at PUT KEY, and the fake card enforces that check.

**The two cardkits (the J3R452 brief's D11).** cashu-card's and fedimintcard's
copies of cardkit have drifted. As of cashu-card `69fd69c` and fedimintcard
`4301b0a`: `gp/bytes.ts` and `gp/des.ts` are identical and `gp/scp02.ts` differs
by one comment; `gp/provision.ts` differs in fedimintcard's multi-set key
candidates (one INITIALIZE UPDATE checked against each set, `keySet` reported),
checks that expect a status word, and `Guard`, `Run` and `expectOk` exported for
its reset; `gp/reset.ts` is two designs (cashu-card's journaled owned-card reset
with registry evidence, fedimintcard's level-triggered factory reset with a
`beforeWrite` hook); `gp/identity.ts` is cashu-card's parse with fedimintcard's
`CHIP_ID_PATTERN` and `getCplc`; each `gp/aids.ts` names its own applet. This
change adds what fedimintcard's port (ENG-838) has to carry: `gp/apdu.ts`,
`gp/scp03.ts`, the hub in `gp/scp02.ts`, `putKeys` from the session, `sdAid`,
`testing/node-aes.ts`, the fake card's SCP03 mode and the replay's dispatch. It
also adds `apps/provisioner/__tests__/cardkitCopy.test.ts`, fedimintcard's
guard: the provisioner bundles yarn's copy of `tools/cardkit`, and the test
fails when that copy is stale. The multi-set candidates and the rest of the
alignment wait for ENG-838; a shared package waits for the dual card's key
owner.

**Not done here.** cardkit's version stays 0.2.0 although `putKeys` and
`openSession`'s return type change. Moving it to 0.3.0, as cardkit's README asks
of an incompatible change, would stop `tools/outbox-spike/run-compact.cjs` and
`run-probe.cjs`, which refuse any cardkit but the reviewed 0.2.0, and
`run-compact.cjs` is a protected source of the pending `recover-unset-up-v3`
audit, so moving their pin fails that plan's admission. The owner decides the
bump with the review of those runners. *3.0: cardkit is 0.3.0; the two runners keep
their pin to the reviewed 0.2.0 and refuse 0.3.0 until they are reviewed against it
(`tools/outbox-spike/reviewed-cardkit.test.cjs`).* Also not here: protocol choice in the
apps, first contact with a seller-keyed card (PUT KEY with P1 = 00 at version
255) and what becomes of the seller's tag (slice 2, since decided in
[D182](#d182) for a card whose shipped set is known; an install that does not
ask for the tag's delete still stops `guarded` with nothing deleted on a J3R452
that holds it), R-MAC, S16 and security levels above 01, AES-192 and AES-256.

**Rejected.** A second entry point beside `openSession` for SCP03 (every caller
would choose, and choose wrong on the other chip); accepting a random card
challenge (i without `10`), which no card here opens and no capture covers, and
whose cryptogram proves the MAC key but not the ENC key or the security domain;
`putKeys` taking a key type or a raw DEK from the caller; `@noble/ciphers` 2.x
(ESM only, and a compiler upgrade for both consumers); an AES written here; a
native cipher (D27's reasons stand).

## <a id="d182"></a>D182: first contact moves a J3R452 from key version FF to 01, and the tap deletes the seller's tag

**Decided (ENG-837, 2026-11-09):** a J3R452 ships at key version FF with the
seller's NDEF tag at the tag's AID, `D2760000850101`. After one tap it installs,
rotates and resets as a J3R180 does:

- **First contact is the tap's rotation.** `rotateKeys` reads the version
  INITIALIZE UPDATE answers. On an SCP03 card at `SHIPPED_KVN` (FF) it sends
  PUT KEY with P1 `00` and new version `FACTORY_KVN` (01), as
  `gp --lock … --new-keyver 1` did to the test card, which answered with the
  new version and three check values and then listed version 01 alone. A
  caller does not steer that PUT KEY: a `putKey` option at first contact
  stops the run `guarded` before EXTERNAL AUTHENTICATE. The reopen then checks
  that the card did what the test card did. After its SELECT it reads the key
  information with GET DATA `E0`, plain, the read the test card answered with
  no secure channel before first contact (keys 01 to 03 at FF, AES, 16 bytes
  each) and after it (the same three at 01, and nothing else); it needs no
  key, so it costs no login. The answer must be 9000 and that second template:
  no key at FF, our three at 01 alone. Then the reopen must prove the new set
  at 01. Any other answer to the first, or the new set at another version,
  stops the run `guarded`: a card that kept the FF set beside ours, whichever
  set it then picks for P1 `00`, or put ours elsewhere, is not reported
  rotated by that run. `RotateResult.firstContact` says when it was. A pull
  after the PUT KEY and before those answers leaves the next run to find the
  new set at 01, as after any lost reply, and that run does not read the key
  information: it cannot tell the card from one rotated in place. GET DATA
  `E0` and its reader are cardkit's `getKeyInformation` and
  `parseKeyInformation`, which the H0 test holds to the J3R180's `gp -i`
  capture. Every other card has its set replaced in place with the APDUs it
  got before, byte for byte (`rotate.test.ts` pins them at 1382268). Each of
  these stops `guarded` with nothing sent after INITIALIZE UPDATE: the new set
  already proved at FF (only an in-place rotation of a shipped card puts it
  there), FF under SCP02 (never measured), a caller's `putKey` at first
  contact, and P1 `00` on any card but one at first contact, a card at version
  00 included. Wrong bytes for the shipped set stop at `wrongKeys`, as before,
  because the card's proof is checked offline. A lost PUT KEY reply leaves the
  card at 01 under the new set, which the next run finds with no second PUT
  KEY; P1 `00` needs an observed FF, so a card that drops the FF set never
  gets it twice.
- **The seller's tag goes inside the sweep, behind an option.**
  `ProvisionOptions.replaceSellerTag`, off by default, makes an SCP03 install
  whose sweep names the tag's AID read GET STATUS of the applications first
  (`readForeignTag`). Only an instance in the seller's shape (`scp03-07`) is
  deleted: made from a load file other than the Cashu package, in the
  security domain named, selectable (07), with no privileges. The DELETE names
  that AID alone (P2 `00`, already on the whitelist) and must answer 9000;
  `6985` ends the run `refused` with the tag in place. Any other shape stops
  the run `guarded` with nothing deleted. The strict registry read of
  [D181](#d181) then runs as before and proves the delete; when it still fails,
  the guard says the seller's tag went and nothing else did. The seller's
  package, `D276000085`, stays: it is not on the whitelist, and what it holds
  in memory is unmeasured. The delete cannot be undone, so the run reports it
  to its caller: `ProvisionResult.sellerTagRemoved`, true only for a DELETE
  answered 9000, and a `sellerTagRemoved` run event, confirmed for that answer
  and unconfirmed for a DELETE whose answer never came, after which the tag
  may be gone. A lost DELETE reply is found by the next run, which sees no
  foreign tag. No phase, journal stage or service change.
- **The provisioner passes it on every reserved tap, with no prompt** (the
  owner's decision), and tells the operator what went: when the attempt then
  loses the card or stops for review, or the operator stops it, the screen
  says the seller's tag was removed and cannot be restored, or may have been,
  beside the stop's own message; after a Stop that is the Stopped notice,
  whether the delete was reported before the Stop or after it. The notice is
  held in memory only and goes when the screen moves on or the app restarts:
  the attempt's journal does not hold it, and a journal field is a schema
  change this slice does not make, so the support details do not carry it
  either. That record is ENG-846. The bench, and every other caller of
  `provision`, sends the APDUs it sent before. The bench's rotation makes
  first contact on a card at FF, as any caller of `rotateKeys` does.
- **The reset refuses FF** before EXTERNAL AUTHENTICATE, as it refuses 00, so
  it never reaches first contact. Elsewhere it restores the public default in
  place at the version observed: 01 on a J3R180, and 01 on a J3R452 after first
  contact. Like the 00 guard, this one follows the saved `delete_intent`, so a
  card at FF that reaches a reset stops there on every retry; none is known
  (the test card reports 01 since 2026-11-08).
- **The reset stays on the ISD**, which both chips use. Nothing threads
  `sdAid` through `readChipIdentity`, `inspectInstallation` or the reset's
  registry read until a security domain other than the ISD is needed: the
  J3R452 brief's D9, a card carrying both products, which is parked.

**Why.** A J3R452 reaches the tap only when an operator reserved it for a Cashu
card, and the seller's tag holds the AID the card's tag must take, so the card
cannot be installed while it is there. The owner chose to delete it without a
prompt. The strict shape keeps the delete to that one object: an instance in
any other shape is not the tag the test card came with, and is left for a
person to look at. First contact belongs in `rotateKeys` because it is the
rotation the tap already journals (`rotation_intent`), with the recovery that
rotation already has: one INITIALIZE UPDATE checked offline against both sets.

**Proven, and not yet.** The fake card models PUT KEY P1 `00` at FF as the test
card behaved, and answers GET DATA `E0` from the sets it holds, in the bytes
the test card gave, so with `keepsShippedSet`, a card that keeps the FF set
beside ours, it lists both, and the reopen stops it whichever set the card
picks for P1 `00`. The tests run first contact, a pull at every APDU of it, the
other answers to the key information read, the tag's delete with a pull at
every APDU of the install, the guards, and first contact followed by a reset
and a second install. The reopen's check is a read the test card answered: GET
DATA `E0` with no secure channel, the card manager selected, listed the three
keys at FF before first contact and the three at 01 alone after it. Silicon is
unmeasured for the DELETE (P2 `00`) of the seller's instance under SCP03 (only
a package delete with P2 `80` is traced, `scp03-10`), for our tag installing
beside the still-loaded `D276000085`, and for in-place PUT KEY at 01 on a
J3R452. First contact rests on one `gp` run on one card, which is not in the
repository, so no transcript test covers it, and an agent never writes a
fixture. Slice 3 (ENG-839) runs these on the owner's go, first contact on an
untouched card among them. A J3R452 still on the seller's keys stops at
`wrongKeys` and is quarantined (`authentication-failed`), its reservation used:
importing the seller's key file waits until a seller-keyed batch is bought (the
brief's D2). cardkit stays 0.2.0, as [D181](#d181) left it; the bump moves with
the review of the outbox-spike runners (3.0: it is 0.3.0; the runners keep their 0.2.0 pin, and refuse it,
until that review).

**Rejected.** Deleting the seller's tag by default in cardkit (the delete
cannot be undone, so a caller asks for it); a `firstContact` flag from the
caller (the card's answer to INITIALIZE UPDATE is the evidence, and a flag
would let a caller send P1 `00` to a card that is not at FF); a new phase for
the tag's delete (it is part of clearing the card before the load, so the
phase table, the screens' labels and the phase-order tests stay as they are);
first contact as its own step before the install (it would need a journal
stage of its own, where the tap's last rotation already has one); a reset that
accepts version 01 alone (it would strand a card recorded at any other
version, and the app records the version it observes).

---

## <a id="d183"></a>D183: The card finishes its own change (3.0: GET_CHANGE bound to the mint's key, LOAD_CHANGE at 27)

**Decided (protocol 3.0, 2026-11-12; closes [D28](#d28)'s gaps 2 and 3).** Only the
card can finish its own change, and it writes a change piece only when the mint's
DLEQ proof holds under the key named at the payment.

- **`SPEND_ALL_CHANGE` (`26`) names the mint's key.** The data is the amount (4),
  the mint's key `K` for that amount (33, compressed) and the keyset the change is
  signed in (8): 45 bytes, a keyset the card holds and was taught ([D194](#d194): the
  37-byte form, which took the first input's keyset, is `6700`). The card keeps the
  opening bound to `K`. The 4-byte form of 2.2 is `6700`.
- **`GET_CHANGE` (`19`) lists what is owed, and nothing that finishes it.** Each
  opening is 83 bytes: its number (1), amount (4), keyset (8), date (4), `B_` (33)
  and `K` (33). The nonce and the blinding factor `r` stay on the card while the
  change is owed.
- **`LOAD_CHANGE` (`27`) takes the mint's answer.** P1 is the opening's number; the
  data is `C_` and `K` uncompressed (65 each) and the mint's NUT-12 `e` and `s` (32
  each), 194 bytes. The card checks `K` against the bound key before any arithmetic,
  checks that both points are on the curve, checks the DLEQ proof against its own
  `B_`, unblinds `C = C_ − r·K` with its own `r`, and writes the piece as `LOAD_PROOF`
  does, the status byte last, with `e`, `s` and `r` kept as its proof. It answers the
  slot, whether the proof was kept, and the piece's 81 bytes.
- **Any reader, in any tap, with no PIN,** on a locked card and a blocked one too:
  receiving what the card is owed changes no setting. No tap is "the tap after a
  payment"; the change of an earlier payment goes on as well as the last's.
- **While change is owed,** `SET_CARD`, `RESET_CARD` (P1 = 0), and on a card with no
  owner `SET_PIN` and `SET_LIMIT_PIN`, answer `6A8D`: the mint, the unit and the
  refund key stay as the change's secret was built with them.
- **`RESET_CARD` P1 = 1 gives one opening up** (P2 its number), for an opening nothing
  can load: the owner's proof over `CashuCard/reset` and the number, or on a card with
  no owner the PIN in a held tap ([D189](#d189)). The money of that opening is gone,
  so it is the holder's choice and never the card's. The log marks the tap (bit 4).
- **`GET_INFO` byte 29** says whether change is owed, to anyone. In 2.2 it said
  whether this tap might load the change with no PIN.

**Why.** In 2.2 `GET_CHANGE` gave every reader each opening's nonce and `r`, so
anyone who saw the mint's answer could finish the piece, and the card checked
nothing when the change was written: a reader that wrote a wrong `C` left the holder
without that change. With the opening bound to `K` and the proof checked on the card,
the one piece a reader without the PIN can write is the one the mint signed for this
opening, and a key made up after the payment is refused.

**Why `27`.** `53` is `REFRESH` ([D20](#d20)); `27` is free and sits with the
payment commands whose change it finishes.

**What the card still cannot see.** That `K` is the mint's key. A reader that binds
an opening to a key of its own makes change the mint's answer cannot fit; the opening
stays owed until the holder mends it ([D190](#d190)) or gives it up. NUT-CCP's core
says so, and leaves both to profiles.

**Rejected.** Keeping 2.2's 80-byte openings beside the new ones: it keeps `r` on the
wire for any reader that asks. Checking nothing and trusting the reader that writes
the change: that is 2.2. Taking the proof at `LOAD_PROOF` with a flag: change is not
an ordinary load, its gate is different (no PIN), and a separate instruction keeps
`LOAD_PROOF`'s rule simple ([D185](#d185)).

**Cost accepted.** A reader that pays with change sends the mint's key at the payment
and, later, `C_`, `K`, `e` and `s` instead of a finished piece: two more fields it
already has from the mint. A 2.2 reader cannot finish a 3.0 card's change ([D193](#d193)).
The card keeps each opening's `B_` and `K` (66 bytes more for each of 8 openings),
reserved at the first `SET_CARD`, and `LOAD_CHANGE` costs about two signatures'
work on a chip.

**Built (applet).** The openings' `B_` and `K` are `openKeys` (8 × 66 = 528 bytes; 8 × 67 = 536 with [D190](#d190)'s shown mark),
reserved once at the first `SET_CARD` that goes through, outside any transaction and
behind its own null guard, after the store of the mint's proofs and the settlement
record ([D17](#d17), [D176](#d176)); the constructor is unchanged (29,841 persistent
bytes, 940 cleared on deselect in 15 arrays). A card refused the room makes no change
for itself (`SPEND_ALL_CHANGE` answers `6A84`) and is set up all the same, so an
opening that is owed always has its `B_` and `K`. `SPEND_ALL_CHANGE` checks that `K`
is a point of the curve (an x under p whose `x³ + 7` has a root, by the chip's RSA over
p·p, as the change's own point is found), and `LOAD_CHANGE` checks `C_` and `K` (x and
y under p, `x³ + 7` a square, y one of its roots) before the chip is given either. The
change's piece is written by `loadOne`, as `LOAD_PROOF` writes one, with `e ‖ s ‖ r`
as its proof. The payment's settlement record ([D175](#d175)) gives the card's own
change its opening's keyset (found by its `B_` among the openings owed) and the till's
outputs the first input's. `GET_INFO` byte 29 is `01` while any opening is owed
(signed for and not let go). The let-go form on a card with no owner checks the PIN and
the time in the field and then wants a held tap ([D189](#d189)).

**Writes outside a transaction ([D23](#d23)), and why a tear is safe.**

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSpendAllChange` | the opening's `K`, amount, keyset (the first input's or the one named) and date, then (after `blindChange`'s nonce and `r`) its `B_`, then its state byte `DRAFT` | The state byte is the opening's commit. Torn before it, the opening is `EMPTY` with bytes in it: `GET_CHANGE`, `LOAD_CHANGE`, the settlement record and the owed gates read only owed openings, and the next change writes every field before its state byte (`SlotWriteOrderTest.aTornChangeLeavesKeysThatAreNeverServed`). |
| `letGo` | one byte, an opening `EMPTY` | One byte is whole. Called for a piece already on the card (`GET_CHANGE`, `LOAD_CHANGE`, the owed gates, a load's `clearOpening`) and, inside its transaction with the log entry, by the let-go form. |
| `processLoadChange` | through `loadOne` (record, hex, data, status byte last), then the opening let go, then the log in a transaction | Torn before the status byte: the place is `EMPTY` and the opening owed, and the same answer goes on again into the same place. Torn after it and before the letting go: the piece is on the card, the opening owes nothing, and the next `GET_CHANGE`, `LOAD_CHANGE` (`6A94`) or owed gate lets it go (`SlotWriteOrderTest.aTornLoadChangeIsFinishedByTheSameAnswer`). Torn before the log: the piece is on the card with no entry, as for `LOAD_PROOF`. Nothing is written before the piece. |
| `processLetGo` | none: the log entry with bit 4 and the opening let go are one transaction | All or nothing. |
| `processSetCard` | one byte per opening, a draft let go, before the record's transaction | A draft is owed nothing; one left by a tear is let go by the next `SPEND_ALL_BEGIN` or `SET_CARD`. |
| `processResetCard` | `openKeys` zeroed with the other bulk wipes | Before the four-byte transaction, as the openings already were: torn before it, the card is still its owner's, who resets it again. |
| `SchnorrHW.addTo`, `mul` | the signer's temporary key's generator and scalar | Every use sets the generator and scalar it means before the chip is given the key; `sign` multiplies the point it is handed, not the key's generator. |

`SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed` counts them;
`SchnorrHWMathTest.ONCE_ONLY_ALLOCATIONS` lists the reservation.

---

## <a id="d184"></a>D184: Units in the core, two units on one card, and one SET_LIMIT layout

**Decided (protocol 3.0, 2026-11-12).**

- **Unit codes are core** (NUT-CCP, "Units"): `00` sat, `01` usd. On a usd card every
  amount, the balance and every limit is in cents. Other codes are reserved.
- **Two units on one card** is a profile: `sat` and `usd` pieces at the card's one
  mint, told apart by keyset in a **keyset table** the first `SET_CARD` reserves (six
  entries: the keyset's 8 bytes, a state byte with the unit, the holder's mark and
  whether its keys are known, and the top of its keys' tree, [D190](#d190)). A card
  whose table holds a keyset of the other unit says format `05` (`GET_INFO` byte 8,
  `GET_CARD` byte 0), worked out at each asking; a reader that knows only format 4
  refuses it, and so never reads cents as sats. A load names its pieces' unit
  (`LOAD_PROOF` P2 = 1); one payment is of one unit (`6A9A`); a new keyset of the other
  unit is the holder's to start (`6A9D`); at most two live entries lack the holder's
  mark (`6A9C`). New forms: `GET_INFO` P1 = 3, `GET_CARD` P1 = 2, `GET_BALANCE` P1 = 1,
  `GET_LOG` P1 = 2 and 3.
- **Limits are in the card's unit.** A payment in the other unit is counted at a
  **rate**, sats to the dollar, rounded up against the holder; with a limit set and no
  rate it is refused (`6A99`), and so is a load of the other unit's pieces, and a
  `SET_LIMIT` that would leave a limit and no rate on a card holding the other unit's
  pieces (before anything is written), so that no card holds pieces no payment could
  take off.
- **One `SET_LIMIT` layout** for the owner's form (`34`) and the PIN form (`33`):
  daily limit (4), payment limit (4), no-PIN allowance (4), rollover budget (1),
  rate (4), and with [D186](#d186) the no-PIN window's switch (1). A value of 4, 8, 12,
  13, 17 or 18 bytes sets the fields it carries and leaves the rest. 2.2's 13 bytes are a prefix of it, so every 2.2 write means on 3.0 what it
  meant on 2.2.
- **`GET_CARD`'s record offsets are settled for 2.x:** 76 rolls, 77 budget, 78 armed
  ([D20](#d20)); 79 to 82 the rate, answered as zeros (`GET_INFO` P1 = 3 tells it to
  whom the limit on one payment is told); 83 to 86 the no-PIN window's start
  ([D186](#d186)); 87 the no-PIN window's switch ([D186](#d186)); 88 to 104 zeros. In
  the card's record these are offsets 156 to 167, where 2.2 had zeros, so the
  constructor asks for nothing more.

**Why.** A holder who keeps dollars and sats wants one card. The keyset is the only
thing on a piece that says its unit, so the card keeps the table and never chooses a
unit itself. Limits in the card's unit keep a sat card's numbers what they were in
2.2; the rate turns only the other unit's payments. One layout with the budget before
the rate means no length means two things and no wallet's earlier writes change
meaning: 13 bytes end with the budget, as in 2.0, and the rate only ever follows it.

**Rejected.** Every limit in cents whatever the card's unit: it would
make every sat card need a rate before any limit worked. A unit per piece in the slot:
it moves the 82-byte slot that every reader parses. Two mints on one card: a record
names one mint, and the change's secret is built with its refund key.

**Cost accepted.** 267 bytes reserved at the first `SET_CARD`. A card of six live
keysets takes no seventh until a reclaim frees one. The rate is only as fresh as the
owner's phone made it; it is rounded against the holder.

**Built (applet).** The table is `book` (6 × 41 + 1 + 4 + 16 = 267 bytes: each entry the
keyset's 8 bytes, its state at 8 and the top of its keys' tree at 9 to 40; then the last
payment's unit at 246, the other unit's count at 247 and the receipts' units at 251),
reserved once at the first `SET_CARD` that goes through, outside any transaction and
behind its own null guard, after the openings' keys ([D183](#d183)); the constructor is
unchanged. Every use is safe while it is null: such a card is of one unit, its pieces
its own unit's, and a load labelled the other unit is `6A9C`. The holder's say that
marks an entry is the owner's grant; on a card with no owner it is the held tap
([D189](#d189)). A payment in the other unit is turned into the card's unit at the
rate by hand on bytes (`turn`: the product by shift and add, then sixty-four steps of
shift and subtract, rounded up, past four bytes `FF FF FF FF`), in scratch the
payment does not use while it signs, at the first `SIGN` and again at the last; the
log, the counts and the receipt keep the payment's own unit. The settlement record's
unit byte ([D175](#d175)) is the payment's. `SPEND_ALL_CHANGE`'s 45-byte keyset is
entered without the mark where it is new, and runs no reclaim (the reclaim runs at
`CLEAR_SPENT`, at a load and at `SET_CARD`). The rate is kept at record offset 159
(`GET_CARD` 79), after the arming.

**Writes outside a transaction ([D23](#d23)), and why a tear is safe.**

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `enter` (from `loadOne` and `processSpendAllChange`) | a free entry's keyset (8), then its state byte | The state byte is the entry's commit. Torn before it, the entry is still free (state `00`) and its bytes a keyset nothing reads. Torn after it, the entry is live and nothing names it: the piece's status byte or the opening's state byte comes later, and the next reclaim frees it (`UnitsTest.aTornEntryIsFreed`). |
| `reclaim` (at `CLEAR_SPENT`, a load that finds no entry, `SET_CARD`) | one state byte `00` for each entry no unspent place and no opening (drafted or owed) names | One byte each is whole. Torn halfway, some dead entries are freed and the next reclaim frees the rest. A live entry is never freed: every place and opening that names it is looked at first. |
| `processResetCard` | the table zeroed with the other bulk wipes | Before the four-byte transaction, as the log and the receipts are: torn before it, the card is still its owner's, who resets it again. |
| `processSpendAllSign` | none new: the other unit's count, the last unit and the receipt's unit are written in the payment's and the receipt's transactions | All or nothing with the payment and its receipt. |
| `processSetCard` | none new: the last unit is forgotten in the record's transaction; the reclaim before it is the reclaim's | A record and its last unit change together. |

`SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed` counts them;
`SchnorrHWMathTest.ONCE_ONLY_ALLOCATIONS` lists the reservation.

---

## <a id="d185"></a>D185: PIN before money; the core no longer asks that the tap after a payment may load

**Decided (protocol 3.0, 2026-11-12; closes [D28](#d28)'s gaps 1 and 6).** A card is
given its PIN before anything goes on it or leaves it.

- A card with no PIN refuses `LOAD_PROOF`, `CLEAR_SPENT`, `LOAD_CHANGE`, `KEYSET_KEYS`,
  the payment commands `22` to `26`, an owner's claim and the let-go form of
  `RESET_CARD`, with a word of its own, `6A97`. `SET_PIN` stays open on a card with no
  owner and nothing on it.
- `LOAD_PROOF` and `CLEAR_SPENT` want the PIN given in this tap, and nothing else opens
  them: not the owner's grant (`ALLOW_LOAD` now grants reading, telling and binding,
  never loading) and not the tap after a payment (the change grant is gone: the card's
  own change comes back by `LOAD_CHANGE`, [D183](#d183)).
- No card has an owner and no PIN: an owner is claimed only under the PIN
  ([D187](#d187)), and `SET_PIN` on an owned card is `6A91` (2.2's ADD PIN under the
  grant is gone).
- The holder's numbers on a card with no owner (`SET_LIMIT_PIN`) are the PIN's, with
  nothing unspent or owed.
- NUT-CCP's core drops "A card SHOULD let the reader of a payment load that payment's
  change in the same tap or the next one", and says instead that a card MAY want its
  PIN for every `LOAD_PROOF`, and MUST NOT want anything for `LOAD_CHANGE` under the
  bound key.

**Why.** In 2.2 a card with no PIN took loads from any reader, and the tap after any
payment opened loading and `CLEAR_SPENT` with no PIN: a reader could fill places, or
free spent ones, with nothing the holder gave. A piece written by a stranger is not
money the holder can trust, and a freed place loses the record of a payment that may
still be settling (NUT-CCP's spent-slot rule). With the change its own business
([D183](#d183)), nothing a reader legitimately does after a payment needs a load.

**Rejected.** A card with no PIN that pays for whoever holds it, as 2.2 allows: it is
cash, and a card that holds cash with no PIN cannot tell its holder from a finder. An
issuer that wants that card sets an allowance instead ([D186](#d186)). Keeping the
owner's grant as a load key: the grant says the owner's phone was in the tap, not
that the holder chose what is written; the PIN is the holder's own.

**Cost accepted.** Every top-up asks for the holder's PIN, Flash's and Foxy's alike.
A card cannot be handed out with money on it and no PIN. A 2.2 reader that loads
under the grant, or in the tap after a payment, is refused and writes nothing.

**Writes (the tear review, [D23](#d23)).** This decision adds no write outside a
transaction and takes one away:

| Site | Writes outside | Why a tear there is safe |
|---|---|---|
| `loadOne` | the proof record, the hex text, the data, then the status byte | Status byte last ([D14](#d14), [D17](#d17)): a tear leaves an EMPTY place, which nothing serves. Nothing of the load is written after the status byte: the persistent note of a payment that opened the next tap (2.2's `changeDue`) is gone, and with it D23's tear that left it standing. |
| `processSpendAllSign` | unchanged | The payment's transaction no longer sets that note: it holds the day, `burnPending`, the log and the last signature. |
| `processResetCard` | unchanged | Its one transaction holds four bytes (the lock, the PIN state, the owner, the tag's switch), where 2.2's held five. |

The constructor makes one persistent byte fewer (29,841 bytes in all) and one
transient byte fewer (940 cleared on deselect, in 15 arrays):
`SchnorrHWMathTest` and `CashuAppletTest` pin both. `OwnerPinRemovalTest` keeps its
two concerns: its card with a PIN state of none, set by hand, now loads and pays
nothing (`6A97`), and the owner gives it a PIN by `CHANGE_PIN`, `SET_PIN` being
`6A91` on an owned card.

---

## <a id="d186"></a>D186: The no-PIN allowance counts whole pieces in a window of its own (amends D20 and D26)

**Decided (protocol 3.0, 2026-11-12; closes [D28](#d28)'s gap 4).**

- **Whole pieces.** A payment signed with no PIN counts against the allowance as the
  whole of its pieces, the card's own change included. The day's limit still counts
  what leaves the card.
- **A window of its own.** It begins at the first payment with no PIN while none runs,
  at the card's clock (a card that has taken no header begins it at the first header it
  takes), and `GET_INFO` P1 = 4 (bytes 51 to 54, a new 57-byte form) and `GET_CARD`
  bytes 83 to 86 say when. It ends at the owner's next good proof, whatever the command
  and even where the command is then refused for something else, and at a
  `SET_LIMIT_PIN` that carries the allowance (in the card's first set-up only, since
  [D195](#d195)); or at a payment with no PIN that finds the
  allowance **armed** and, with the window of 24 hours, the clock 24 hours past the
  window's start (with no window, the arming alone).
- **Arming.** An owner's good proof, a `SET_LIMIT_PIN` that carries the allowance (in a first set-up, [D195](#d195)), or a
  `VERIFY_PIN` in a time in the field in which no payment has been or is then signed: a
  payment's commit takes back an arming a `VERIFY_PIN` gave earlier in the same time in
  the field, and never one the allowance had from an earlier time in the field (a
  `VERIFY_PIN` that finds the allowance armed arms nothing, and so has nothing to take back).
  The payment with no PIN that begins a window, whether one ran before it or not, spends
  the arming: one allowance for each arming. 2.2 armed on every `VERIFY_PIN`.
- **The switch: the window of 24 hours, or none.** One byte of the record (offset 167,
  `GET_CARD` 87), `SET_LIMIT`'s eighteenth byte in both forms: `00` the window of 24
  hours, in which an arming brings the allowance back no sooner than 24 hours after the
  window that runs began; `01` none, in which an arming brings it back at the next
  payment with no PIN, whatever the clock says. `6A80` for any other value, with nothing
  written. **Default `00`**: a new card's record and one after `RESET_CARD` are zeros,
  every 2.2 wallet and every shorter `SET_LIMIT` leave the byte as it is, and of the two
  it is the tighter (it renews no more often than `01` does), so a card whose wallet never
  heard of the switch keeps the rule of this decision as first written. **Who sets it:**
  the owner's proof on an owned card (`SET_LIMIT`, `34`); on a card with no owner the
  PIN (`SET_LIMIT_PIN`, `33`, with that form's rules); never a till, which has neither.
  `SET_CARD` never touches it. **A card with no owner** (a holder with no phone) keeps
  the default until a phone with its PIN writes 18 bytes; with either setting its
  allowance is armed only by a `SET_LIMIT_PIN` that carries it or by its PIN in a tap
  that pays nothing, since it has no owner's proof. **What Foxy writes:** `01`, in an
  18-byte value (daily limit ‖ payment limit ‖ allowance ‖ budget ‖ rate ‖ `01`), by the
  owner's form on an owned card and by the PIN form on a card with no owner: its no-PIN
  amount is what the card spends without a PIN before it is next seen by the holder's
  phone or the holder's PIN, never renewed by time.
- **The word.** Past the allowance a payment with no PIN is `6A9E`, "limit reached,
  enter the PIN", written in the log as a refusal over a limit; with the PIN the same
  payment goes through. An allowance of 0, or a blocked PIN, stays `6A94`.
- `GET_INFO` bytes 38 to 41 are the running window's count; `GET_CARD` byte 78 is still
  "armed".

**Why.** Counted as what leaves the card, a reader with no PIN could name a large
piece, take nearly all of it as change and never swap: the whole piece out of the
holder's reach for the price of a few sats of allowance. Counted whole, what a reader
with no PIN can put out of reach is the allowance and no more. And a PIN the holder
types at a reader to pay opened the allowance again in 2.2 for whoever tapped the card
next; now only the owner's phone, or the holder's own phone in a tap that pays nothing,
opens it.

**Rejected.** Renewing on the clock alone: a reader with no PIN that holds
a card whose clock is behind the network can walk it with real headers and take the
allowance for each day it walks. Keeping 2.2's window, shared with the day's: the
holder's phone could not say when the no-PIN money comes back.

**Cost accepted.** A holder who only ever pays with no PIN, and whose phone never sees
the card, gets one allowance until the owner's phone or a PIN in a tap that pays
nothing arms it again. A thief gets one allowance per arming, as in 2.2. With the
switch at `01`, a holder who types the PIN in a tap that pays nothing gets a new
allowance at once, without waiting a day: the PIN-holder could pay with the PIN anyway.

**Built (applet).** The window's start is record offset 163 (`CARD_NOPIN_START_OFFSET`,
`GET_CARD` 83, after the rate), the switch 167 (`CARD_NOPIN_DAY_OFFSET`); the count stays at 205 and alone
says whether a window runs (0: none, and `GET_INFO` P1 = 4 answers zeros at 51 to 54).
`requireAllowanceOrPin` is held to the whole of the pieces in the card's unit (`X_CONV`,
[D184](#d184)) and answers `6A94` (allowance 0, a blocked PIN) with nothing written or
`6A9E` through `refuseOverLimit`; `noPinBegins` says whether a payment with no PIN begins
a window; the commit writes the start and spends the arming when it does, and takes an
arming back when this time in the field's `VERIFY_PIN` gave it (`TAP_ARMED`, set only where
`armAllowance` moved the byte from 0, a third byte
of the CLEAR_ON_RESET `tapOpen`: 7 bytes on reset in all, under the 8 of D22's budget).
The day's window is the daily limit's alone: a payment with no limit set begins none, and
`SET_LIMIT` no longer clears the no-PIN count when the day's number changes. `SET_HEADER`
anchors a window begun with no clock. `GET_INFO` P1 = 4 answers 57 bytes, the profile bits
`FF 01` at 55 and 56, every profile of 3.0 (since [D196](#d196) 59 bytes, the loads left today
after them, and `FF 03` with keys per load, [D197](#d197)). The constructor is unchanged.

**Writes outside a transaction ([D23](#d23)), and why a tear is safe.**

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `endNoPinWindow` (from `requireOwnerProof` and `writeLimit`) | the count to 0, then the start to 0 (only where a window runs), then `armAllowance`'s one byte | The count alone says whether a window runs. Torn after it, none runs and the next window's beginning writes its own start; torn before the arming, the next payment with no PIN begins a window anyway (none runs) and finds nothing to spend. The owner's proof (or the PIN's `SET_LIMIT_PIN`) is what asked for the end, and asks again. |
| `armAllowance` | one byte | Whole. |
| `writeHeader` | the start of a window begun with no clock, beside the day's window | In the header's transaction (`SET_HEADER`, `REFRESH`, the anchor): every caller holds one. |
| `processSpendAllSign` | none new: the start, the count and the arming are written in the payment's transaction | All or nothing with the payment. |

`SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed` counts them.

---

## <a id="d187"></a>D187: An owner is claimed slowly, under the PIN

**Decided (protocol 3.0, 2026-11-12; closes [D28](#d28)'s gap 5).** `SET_OWNER` on a
card with no owner is a claim (*amended by [D202](#d202): the claim may bring the owner's c,
sealed in a `SET_OWNER` P1 = `01` just before it, and its check at the end of the data*): the PIN set and given in this tap, the card in its first
set-up ([D196](#d196): a card set up with no owner is never claimed, `6A91`), no payment
signed in this time in the field, an empty card (nothing unspent and no change owed,
`6A8D`, as 2.2 had it; see [D195](#d195)), and the same data asked six times in a row.
Each of the first five askings is answered `6A98`, keep holding, after a signature's
work of the card's own, thrown away (some three seconds in all on a chip); the sixth
sets the owner. Other data, or any other command between, begins the count again.
After a claim, no payment command is taken for the rest of that time in the field
(`6985`). The anchor of [D20](#d20) rides
with the claim, checked before any asking counts. An owned card is handed over at once
with the old owner's proof, as before.

**Why.** In 2.2 an open card took an owner at once, from any reader: a reader that had
just been handed a card, or its PIN for a payment, could make itself the owner in the
same instant. Under the PIN, held for seconds, and never in a tap that paid, a claim is
something the holder does on purpose. A time in the field ends when the reader's field
does, so "never in a tap that paid" binds only a reader that keeps its field on; the claim
wants an empty card as well, and since [D196](#d196) the card's first set-up, which only
the card's first PIN or a reset begins. A holder with no phone who later wants a phone as
owner moves the money to that phone, resets the empty card by the PIN, and sets it up again
with the phone, which claims it there.

**Rejected.** A claim with no PIN on a card with nothing on it: no card holds anything
with no PIN ([D185](#d185)). `9000` with "not yet" bytes for the early askings, as a
payment's wait: a phone that asks once would take `9000` for done.

**Cost accepted.** Set-up takes three seconds more. A phone that sends `SET_OWNER` once
and stops sees `6A98` and nothing set.

**The owner's key is a point.** The card checks the owner's key itself, on a claim and on
a handover alike, last of every check and before the key is written: `x` and `y` under
P-256's `p` and `y² = x³ − 3x + b`, `6A80` otherwise. A chip's key object may take a key
that is not on the curve without a word (the simulator does), and a card whose owner's
key is no point could never be given the owner's proof again. The check is the chip's
RSA, as the change's field arithmetic is ([D183](#d183)): its modulus is now
`N = p₁ · p₂`, secp256k1's prime times P-256's (512 bits, as before), so one power mod
`N` serves both fields. Three times the curve's equation is gathered mod `N` as
`(y + 1)³ + (p₂ − y)³ + 3(p₂ − x)³ + 3(p₂ − y) + 9x − 1 − 3b`, which is 0 mod `p₂` exactly
on the curve, then raised to `(p₁ − 1)/2`: on the curve the answer is 0 mod `p₂` and 0, 1
or −1 mod `p₁`, that is `T` or `N − T`, where `T` is `p₂` raised to the same power (or 0,
where the sum is 0 mod `p₁` as well: a chance of 2⁻²⁵⁶ that no key can be chosen to make,
and refused).

**Built (applet).** `CLAIM_ASKINGS = 6`. The count is a second byte of the
CLEAR_ON_DESELECT `nonceLive` (941 bytes of deselect RAM in all, the figure of the build
that installed on a slower chip), its top bit set while it counts a history's askings
([D189](#d189)); `process` sets it to 0 before any command but the one it counts, a
`SELECT` among them. The same data is a SHA-256 of the key and the anchor kept in
`allSlots` between askings. Each early asking is `holdOn`: one signature's work thrown
away (`work`, which the payment's wait shares), then `6A98`. The time in the field's marks
are three bits of the CLEAR_ON_RESET `tapOpen[2]` beside D186's arming: `TAP_PAID` (set at
a payment's commit), `TAP_CLAIMED` and `TAP_READ`; `RESET_CARD` clears none of them, so a
time in the field that paid or claimed stays so through a reset. Every payment command
answers `6985` while `TAP_CLAIMED` or `TAP_READ` is set. A claim checks the anchor at every
asking (`6A93`, `6A80`, neither counting nor ending the count) and takes it at the sixth
in the key's transaction with the rolls at 0. A claim asks for an empty card
(`requireNothingOwed`: nothing unspent, then no change owed). No write is new outside a transaction:
the key, the flag and the anchor are one transaction, as in 2.2.

---

## <a id="d188"></a>D188: Every payment waits a floor

**Decided (protocol 3.0, 2026-11-12).** Every payment, within its limit or not, is at
least four signatures of the card's work from `SPEND_ALL_BEGIN` to its signature, its
own among them (`WAIT_FLOOR_SIGNS`): the card answers `00 01` to `SPEND_ALL_SIGN` until
then. The change outputs the card made in the payment count toward it, two waits for
every three, as they already do toward the limit on one payment. 2.2's waits for a
payment over that limit, and for a second payment in a time in the field, come on top:

    waits = max(0, (WAIT_FLOOR_SIGNS − 1) + W − ⌊2 × outputs / 3⌋)

with W 2.2's wait.

**Why.** In 2.2 a payment within the limit was signed at once, so a reader could take
one in the moment a card passed near it. A floor of about two to three seconds is a
time a holder notices, and a reader cannot shorten it, whatever it sends. NUT-CCP
already requires every reader to send `SPEND_ALL_SIGN` again on `00 01`, so no reader
breaks.

**Rejected.** A second wait shape (two signatures for each further limit's worth, where
2.2 has four): one wait shape is enough, and 2.2's is the one Flash's readers are timed
for. A wait counted in the reader's clock: the card has no clock that runs.

**Cost accepted.** Every payment takes about two seconds longer on a fast chip and
three on a slower one.

**Built (applet).** `WAIT_FLOOR_SIGNS = 4`. `waitsFor` answers W (2.2's wait, 0 within
the limit; a sum that wraps is `WAIT_SIGNS_MOST`); `SPEND_ALL_SIGN` adds
`WAIT_FLOOR_SIGNS − 1` and takes off two waits for every three of the card's change
outputs, never below 0, at the first `SIGN`. The log's bit 1 ("waited past the floor")
is set where W is above 0. The waits write nothing that lasts, as 2.2's did.

---

## <a id="d189"></a>D189: A holder with no phone: the PIN and a held tap stand for the owner

**Decided (protocol 3.0, 2026-11-12).** A card with a PIN and no owner is the card of a
holder with no phone of their own. It is set up, loaded and freed under its PIN
(`LOAD_PROOF` no longer asks for an owner), and its numbers are set under its PIN
(`SET_LIMIT_PIN`: in its first set-up, and after it none, [D196](#d196)). Its history is the PIN's, and **held for**: `GET_LOG` answers `6A98`,
keep holding, to the first nine askings in a row, a signature's work each, and the
history at the tenth; never in a time in the field in which a payment was signed, and no
payment is taken for the rest of a time in the field that read it (a **held tap**). On
such a card a held tap stands where the owner's grant or proof stands: to mark a new
keyset, to bind an opening to another key, to give an opening up, to change a used card's
PIN (`SET_PIN`; `SET_CARD` and `SET_LIMIT_PIN` go only in the first set-up, [D196](#d196)), to reset
an empty card ([D196](#d196)), and to send `REFRESH`, whose new P1 = 1 takes
the header with no proof and sets the rolls to 0. A set-up card keeps its PIN: a new one
wants the PIN it has. The guest is told the limit on one payment and the rate in a held
tap.

**A factory record.** An issuer may write a record whose mint is `-` alone, to carry the
card's design to it before a holder sets it up. It counts as no record: `LOAD_PROOF`
answers `6A8C`. (Until [D196](#d196) a PIN set on such a card did not make it set up, and the
holder's own `SET_PIN` replaced it with no PIN asked; since D196 the first PIN on a card
begins its first set-up whatever its record, a factory record goes only on a card that has
never had a PIN, and a card set up by someone else is reset by its holder.)

**Why.** Some holders have no phone. Their card still needs someone's phone to load it,
and that phone must not become its owner. The hold makes reading the history, or
rewriting the card, something done on purpose and never in the tap a reader was handed
the PIN to take a payment. `REFRESH` P1 = 1 gives such a card the way out of a spent
rollover budget that an owned card has, under the same say. The factory record rule
stops a PIN put on a card before its holder has it from locking the holder out.

**Rejected.** Making the loading phone the owner: the holder would depend on a phone that
is not theirs. Letting the PIN alone stand for the owner: a reader has the PIN.

**Cost accepted.** A reader that keeps a holder's PIN can hold a tap of its own and do
there what the holder can, the same as reading the history; what it writes is in the
card's record for the holder's next phone to see. It loosens no number and claims no card
([D196](#d196)). Reading the history takes five seconds.

**The numbers go with a stranger's PIN** (until [D196](#d196), which took this out: a card set up
by someone else keeps its numbers until its holder resets it). On a card with no record of the holder's (no
record, or a factory record) a `SET_PIN` that replaces a PIN takes with it the numbers that
PIN could write with `SET_LIMIT_PIN`: the limit on one payment, the no-PIN allowance and
its count, the rate, the rollover budget and count, the arming and the no-PIN window's
start and switch. The day's limit, which only tightens, stays. Otherwise a stranger who
put a PIN on a card on its way to its holder could leave it a large allowance that the
holder's own set-up, writing a shorter `SET_LIMIT`, would keep.

**Built (applet).** `HISTORY_ASKINGS = 10`. `requireHistory` reads the history: on an owned
card as 2.2 had it (the grant for both, or the PIN for the log), on a card with no owner the
PIN, no `TAP_PAID`, then the held count with `HELD_HISTORY` in its top bit, `TAP_READ` at the
tenth; a `GET_LOG` with a P1 over 3 is refused before it and leaves the count alone. The
holder's say is `holderSays` (the grant, or the PIN in a held tap: `GET_INFO`'s limit on one
payment and rate, a load's new keyset) and `requireSay` (`KEYSET_KEYS` with another key);
the let-go and `REFRESH` P1 = 1 want `requireHeld` after the PIN (`6985` with `TAP_PAID`,
`6982` without `TAP_READ`); a set-up card's `SET_PIN` wants a held tap once the log has taps in it (`SET_CARD` and
`SET_LIMIT_PIN` wanted it too until [D196](#d196) held them to the first set-up), before anything
is written. `holderRecord` says a
record is the holder's (written, and its mint not `-` alone). `LOAD_PROOF` asks for no owner
and answers `6A8C` to a factory record.

**Writes outside a transaction ([D23](#d23)), and why a tear is safe.**

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSetPin` | a blocked PIN's log and receipts zeroed (since [D196](#d196) the whole history, by `forget`); until D196, on a card with no record of the holder's, the record's 156 to 167 and 197 to 208 zeroed; all before the PIN's transaction | Torn anywhere among them, the PIN is as it was: blocked (nobody reads a blocked card's history: it wants the PIN), or a PIN on a card with no record of the holder's, which holds no piece (`LOAD_PROOF` wants such a record). The holder's `SET_PIN`, sent again, clears the rest and writes the PIN. |
| `processSetOwner`, `processRefresh`, `processLetGo` | none new | The claim's key, flag and anchor, `REFRESH` P1 = 1's header and rolls, and the let-go's log and opening are each in one transaction. |

`SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed` counts them.

---

## <a id="d190"></a>D190: The card holds the keys it writes change under to their keyset's ID

**Decided (protocol 3.0, 2026-11-12).** `KEYSET_KEYS` (`38`) teaches the card a keyset's
keys, under the PIN (the owner's grant alone since [D194](#d194) teaches nothing): P1 = 0 names the keyset (one in the card's
keyset table) and the bytes NUT-02 hashes after the keys; P1 = 1 sends the keys in order
of amount, six to a command, 64 at most; P1 = 2 finishes. The card works the keyset's ID
out from the keys as NUT-02 says, and keeps the top of a hash tree of them (leaves
`SHA-256(0x00 ‖ amount ‖ K)`, nodes `SHA-256(0x01 ‖ left ‖ right)`) in the keyset's entry
only where the ID's first 8 bytes are the keyset's. P1 = 3 shows that an opening's key is
one of its keyset's keys, by its path in the tree, from any reader; `LOAD_CHANGE` writes
nothing under a key not shown (`6A9F`). P1 = 3 with another key binds the opening to that
key and shows it, under the PIN, in a tap that paid nothing, with the holder's say: this
is how a holder mends an opening a reader bound to a key that is not the mint's.

**Why.** [D183](#d183) binds the change to the key named at the payment and checks the
mint's proof under it, but the card cannot tell by itself that the key is the mint's: a
proof holds for any key whose private key its maker knows. A piece on the card should be
one the mint signed, since every payment that names it stands or falls with it. The
keyset's ID is a hash of all its keys, so a key in the tree of keys that hash to the ID
is one the mint published. A tree keeps 32 bytes
a keyset on the card and a path of at most 192 bytes on the wire.

**The bound.** The card holds a keyset by the 8 bytes a piece holds: 56 bits of the ID's
hash; but any 8 bytes can name an entry (a piece of them loaded under the PIN), and keys
whose ID begins with them are made with no search, so the 56 bits bound nothing against a
reader that teaches. The gate is the PIN alone ([D194](#d194)); a reader with the PIN can
already pay to the card's limits. Keeping the whole 33-byte ID would need it to come from the
holder, since a piece names only 8 bytes; that is left until a load carries it.

**Rejected.** Keeping every key of every keyset (about 2 KB a keyset). Checking the key
at `SPEND_ALL_CHANGE`: a payment's tap is a reader's, and the keys may not be known yet;
the check at writing is the one that matters, and it is made before anything is written.
Mending through `LOAD_CHANGE` with another key: one place binds keys, and it checks them.

**Cost accepted.** A phone that pays with change, or loads it, may first have to teach the
keyset and show the key: a few commands, and the mint's keys, which it already fetches.
Change in a keyset the card has not been taught waits for a phone with the PIN.

**Built (applet).** `KEYSET_KEYS` keeps each keyset's top in its entry of the keyset table
(the 32 bytes after the state byte, [D184](#d184)) and sets the state's bit 1 with it, in one
transaction. NUT-02's two hashes are the ones Nutshell 0.20.3 and cashu-ts make: version
`00`, `00` and the first 7 bytes of SHA-256 of the compressed keys end to end; version `01`,
`01` and SHA-256 of `<amount>:<key in lowercase hex>` for each key, joined with `,`, then the
tail (`|unit:<unit>`, then `|input_fee_ppk:<fee>` where the fee is not 0 and
`|final_expiry:<time>` where the keyset has one). The CI's two Nutshell 0.20.3 mints' keysets
(one of each version, the same 64 keys) are the tests' fixtures, and the card answers both
IDs. Amounts are eight bytes and need not be powers of two. An amount of 0, one not above the
one before, a 65th key and an ID version other than `00` and `01` are `6A80`; a tail after a
version `00` keyset is `6700`. The tree is folded as the keys come, one pending node a height;
its room is RAM a payment uses (four nodes in the places' list, two in the scratch beside the
tail and a key's hex, the last amount and an amount's text in the first output's room), and the
ID's hash is the payment's own SHA-256 object, the leaves' and nodes' the card's other one: a
teaching and a payment give each other up, and the constructor is unchanged (no new object, no
new RAM). An opening's shown mark is one byte after its `B_` and `K` (`openKeys` is 8 × 67 =
536 bytes); `SPEND_ALL_CHANGE` takes it off before it writes `K`. On a card with no owner the
holder's say for another key is the held tap ([D189](#d189)).

**Writes outside a transaction ([D23](#d23)), and why a tear is safe.**

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSpendAllChange` | the opening's shown mark off, before its `K` (one more write in D183's row) | The opening is `EMPTY` until its state byte, and nothing reads the mark of an opening not owed. |
| `showKey` | an owed opening's mark off, its new `K`, then the mark on, last; with no new key, the mark alone | Torn after the mark is off, the opening is bound to the old key, the new one or a mix of the two, and is not shown: `LOAD_CHANGE` answers `6A9F` to any answer, and the holder's binding sent again finishes it (`KeysetKeysTest.aTornBindingIsNeverLoaded`). The mark alone is one byte. |
| `processKeysetKeys` | none: the top and the state's bit 1 are one transaction | All or nothing. An entry entered again (`enter` writes the keyset and the state byte alone) has its old top ignored while its state lacks bit 1. |

`SlotWriteOrderTest.everyWriteOutsideATransactionIsReviewed` counts them.

---

## <a id="d191"></a>D191: The paid list: a piece the card signed for is not signed again

**Decided (protocol 3.0, 2026-11-12).** The card keeps the first 8 bytes of the nonce of
each of the last 1,024 pieces it has signed for, in a ring of 8,192 bytes the first
`SET_CARD` reserves. The rows are written for every place a payment burns, after the
payment's commit, as the burn is (rows written twice are the same rows, so a tear is
finished by the next command); the ring's next row moves in the payment's transaction.
`LOAD_PROOF` refuses a piece whose nonce begins with a row (`6A94`, the word for a piece
already on the card). The list outlasts `CLEAR_SPENT`, and `RESET_CARD` where the card
keeps its key ([D192](#d192)).

**Why.** A nonce refused only while a place holds it says nothing about a piece whose
place has been freed. A reader that takes a card's payment offline, and any certificate
scheme, rests on a promise that the card gives one signature for a piece, and the mint
honours only one.

**Rejected.** A list without a bound: memory is fixed at install. A list by date that frees
rows as the clock passes them: the clock is a reader's to move ([D20](#d20)), and the
list's job is not to free anything. 256 rows (2 KB): a card that pays in many small pieces
goes round 256 in a few weeks; 1,024 rows fit the slower chip's memory with room to spare
(about 8 KB of some 80 KB free on a blank card), to be confirmed in the hardware report. A
shorter row (4 bytes of a hash): half the memory, for a refusal by chance 2^32 times as
often.

**Cost accepted.** 8,195 bytes. A piece signed for more than 1,024 pieces ago can come back.
A holder with the PIN can push 1,024 made-up pieces through the list (no mint's proof is
checked at `LOAD_PROOF`, and one would not help: the holder can teach keys of its own,
[D194](#d194)), and since [D195](#d195) a card loads at most 300 pieces a day by its clock,
so a flush takes a little over three days; the list stops a reader handed the PIN for one
tap, and slows a holder who means to pay one piece twice. A list that never forgets was
rejected: a card must never become unusable because a list is full. NUT-CCP's offline reader still checks each DLEQ
proof and posts first. Closing the list's old way back (`CLEAR_SPENT` and a reload of a
piece the mint still holds unspent) is paid for by the signatures kept beside the receipts
([D194](#d194)). Two nonces that
share 8 bytes cost a harmless refusal, once in 2^54 with a full list. A load looks at up to
1,024 rows for each piece: on the bench J3R180 a `LOAD_PROOF` with its proof took about
226 ms with the list nearly empty (2026-11-13); a full list's time is still to be measured.

**Built (applet).** The list is the first 8,195 bytes of `paid`: 1,024 rows of 8
(`PAID_ROWS`, `PAID_ROW`), then the next row (2, at `PAID_NEXT`), then a byte that is 1 once
the ring has gone round (`PAID_ROUND`); the sixteen signatures kept beside the receipts
([D194](#d194), 65 bytes each, at `PAID_SIGS`) follow in the same array, so `PAID_LEN` is
9,235 bytes. The ring fills from row 0, so the rows in use are
those before the next row until it goes round, and all of them after: a row the ring has
not reached is never read, and a nonce that begins with eight zero bytes (what an unwritten
row holds) is no piece signed for.

- **Reserved** at the first `SET_CARD`, once, before the other stores, in the same guarded
  form as [D176](#d176)'s record. A card refused the room takes no piece (`LOAD_PROOF` and
  `LOAD_CHANGE` answer `6A84`), so every piece the card signs for is on the list.
- **The payment.** `SPEND_ALL_SIGN`'s transaction moves the next row on by the number of
  places, and sets the round byte when it passes the end: one short and one byte more in it.
  `finishBurn`, after the commit and at the start of the next command after a tear, works
  out the payment's rows as the `n` before the next row and writes each place's nonce there
  before the place's status byte. A place in the list is never freed before `burnPending`
  is cleared (`CLEAR_SPENT` and `RESET_CARD` run after `process` has finished the burn),
  so its nonce is still in its place.
- **The load.** `loadOne` reads the rows in use after the places (a nonce in any place) and
  before anything is written.
- **`RESET_CARD`** empties the list by putting the next row and the round back to 0, in its
  last transaction, after the new key is made: torn before it, the card has the old list
  with the new key, which refuses only pieces it need not. The rows are left as they were
  and are not read. ([D192](#d192) keeps the list on a card whose certificate is sealed.)
- **A hand-over** (`SET_OWNER` replacing an owner, [D197](#d197)) empties it the same way,
  after its commit (`forgetOwed`), on every card: the new c means the card never signs for a
  piece locked to the last c's keys again, so the list has nothing left to stop, and kept it
  would tell the next owner which of the last owner's pieces the card paid.

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `finishBurn` | each place's row of the paid list, then its status byte (as before) | Only while `burnPending` is set, which the payment's commit set with the next row moved on: the rows are the `n` before it, and each is the nonce of its place, so writing them again after a tear writes the same bytes. Torn before the commit, nothing reads them and the next row has not moved. |
| `processSpendAllSign`, `processResetCard` | none new | The next row and the round are written inside the payment's transaction and the reset's last one. |
| `processSetCard` | none new | The reservation is an allocation, not a write; a refused one leaves `paid` null. |

---

## <a id="d192"></a>D192: The certificate profile; RESET_CARD keeps a certified card's key

**Decided (protocol 3.0, 2026-11-12).** A certificate for the card key, kept on the card for any
reader to fetch, in NUT-CCP's
[certificate profile](https://github.com/cashucard/nut/blob/main/profiles/certificate.md) format.
No single certifier: each card maker vouches for its own cards, and each reader decides whom it
believes.

- **On the card.** `CERT_WRITE` (`54`) writes a container in pieces and seals it, only on a
  card that has never had a PIN (a mark the first `SET_PIN` sets for good), with no owner and
  nothing on it. The seal checks that the container is well formed and names the card's own
  key: its 33 bytes (form `01`), or a leaf made from it that folds up a path of at most 16
  nodes to the container's top (form `02`). Then it commits the length and one byte in a
  transaction. A sealed certificate is never written again. `CERT_READ` (`1C`) answers it to
  anyone, in pages of 256 bytes, and P1 = `FF` says whether one is sealed.
- **What the card does not do.** It reads neither the statement nor the signature, and checks
  no signature; either may be empty, and so may the chain. Whether a reader trusts a key or a
  top is the reader's certificate profile, outside this command set. The reader checks the
  certificate and asks `AUTH` under the key it names in the same tap.
- **`RESET_CARD` keeps a certified card's key.** A card whose certificate is sealed keeps its
  card key, its certificate and its paid list through a reset ([D191](#d191)), and is given a
  new PIN key; every other setting goes. A card with no certificate sealed (none, or one
  written and never sealed) makes a new key and empties its paid list, as in 2.2 and D191.

**Why a certifier.** Nothing a reader can do from outside shows what code a card runs or that
its key never left the chip: `AUTH` shows only that the card holds a key now. Someone has to
vouch for how the card was made, and a certificate on the card key, checked with a live
signature under that key, is how that is carried to the reader; a copied certificate is
useless on another chip. A reset is how a holder hands a card on, and a reset that made a new
key would end the certificate, so the card could never be checked again. Keeping the paid list
with the key keeps a piece signed under that key from being loaded and signed again by the next
holder.

**What a certifier takes on.** It vouches only for cards made by the process it states; it
keeps the records that let it say which cards it vouched for; and it acts when a card or a
batch it vouched for turns out bad, so that readers stop believing it. Its keys are what make
its word checkable: whoever holds them can vouch as it, so a key that leaks puts every card
it vouched for in doubt. [`CERTIFIER.md`](CERTIFIER.md) is the guide for someone who means
to become one.

**The risks of a card with no certificate, or one from a certifier the reader does not know or
trust.** To the holder: whoever made the card may hold its key or have changed its code, and
may spend what is loaded on it; its PIN and its limits may not hold. To a receiver offline:
the pieces it is paid with may be copies, or may be taken back by whoever holds the key, and
nothing on the card can show otherwise. A wallet weighs this before it loads a card or takes a
payment from one offline.

**Rejected.** A second permanent key that signs each new card key: a name for the card that
every reader would see, for good. The card checking a signature: the scheme is the
certifier's, and the card would carry code for every one. A certificate on uncertified cards'
resets: nothing to keep.

**Cost accepted.** A certified card keeps one key across its holders, so any reader of
`GET_PUBKEY`, `AUTH` or the certificate can link one card across holders; and every card
keeps its installation across a reset, which its payment records carry. A mint does not see
that key: every piece is locked to the card's key for its date ([D197](#d197)), so a mint
links the spends of one date to each other and to no other date or holder. Ecash locked to a
certified card's date keys and not loaded before a hand-over is not the next holder's: the
reset draws a new c, and the card builds other keys for that date, so it can never spend it.
A dated piece comes back to the old holder's refund key after its date; an undated one is
lost; so the holder refunds or loads what is owed before a hand-over. 1,027 bytes reserved at the first `CERT_WRITE` (1,024 for the
container, three for the seal), only on a card that is written one. One persistent byte made
at install. A certificate shows where a key was made, not that the chip is honest.

**Built (applet).**

- `hadPin` (1 byte, made in the constructor: 29,842 bytes of persistent arrays there when it
  was built, one more than before; 30,052 with the rest of 3.0) is set in `SET_PIN`'s transaction, beside the PIN's state byte, and nothing
  clears it.
- `cert` is `CERT_LEN` = 1,027 bytes: the container at 0 to 1,023, the seal's byte at 1,024 and
  the length at 1,025. It is reserved at the first `CERT_WRITE` that passes the checks of state
  and length, guarded so that it happens once in a card's life, and listed in
  `SchnorrHWMathTest.ONCE_ONLY_ALLOCATIONS`. A card refused the room answers `6A84`.
- The seal's fold runs in the scratch's first 33 bytes (the node's `01`, then the node) with the
  card's one `MessageDigest`, and reads nothing an earlier command left there.
- 1,024 bytes hold a path of 16 nodes and a signed statement: such a container, with the
  longest statement the profile allows and a 65-byte signature, is 890 bytes, which leaves 134
  for the chain.
- `RESET_CARD` asks `certSealed()` once: a sealed card skips the new card key and the emptying of
  the paid list in its last transaction; the new PIN key and every other wipe are the same.

**Tear review (D23).**

| Site | Writes outside a transaction | Torn, the card is |
|---|---|---|
| `CERT_WRITE` P1 = 0 | one copy of 1 to 240 bytes into `cert` | a container with part of a write, which counts for nothing until the seal: the issuer writes it again |
| `CERT_WRITE` P1 = 1 | none: the length and the seal's byte in one transaction | sealed or not, whole |
| reservation of `cert` | the allocation, once, as D176's | a store or none; the next write reserves it |
| `SET_PIN` | none new: `hadPin` in the PIN's transaction | the PIN and the mark together, or neither |
| `RESET_CARD`, certified | none new: the new card key is not made; the paid list is not emptied | as any reset torn before its last transaction: still its owner's |

---

## <a id="d193"></a>D193: Version 3.0: SELECT answers 03 00; the instruction and status map

**Decided (2026-11-12, as protocol 2.3 answering `02 03`; renumbered 3.0 by [D205](#d205)
before the merge).** `SELECT` and `GET_INFO` answer `03 00`. New
instructions: `1C` `CERT_READ`, `1D` `GROUP_KEYS`, `1E` `INBOX` ([D199](#d199)), `27` `LOAD_CHANGE`, `38` `KEYSET_KEYS`, `54` `CERT_WRITE`; `2E`
and `2F` kept for a later profile. New status words, in the `6A9X` range NUT-CCP leaves to
profiles: `6A97` no PIN, `6A98` keep holding, `6A99` no rate, `6A9A` two units in one payment,
`6A9B` the other unit, `6A9C` no room in the keyset table, `6A9D` the holder's say needed for a
new keyset of the other unit, `6A9E` limit reached, enter the PIN, `6A9F` keys not shown. New
forms: `GET_INFO` P1 = 3 (51 bytes) and P1 = 4 (59 bytes: two bytes of profile bits, `FF 03` for
this card, then the loads left today), `GET_CARD` P1 = 2 and 3, `GET_BALANCE` P1 = 1, `GET_LOG` P1 = 2
and 3, `LOAD_PROOF` P2 = 1 and 2, `RESET_CARD` P1 = 1, `REFRESH` P1 = 1, `SPEND_ALL_CHANGE` 45 bytes,
`SET_LIMIT` 17 and 18 bytes. The core changes go to cashucard/nut first (`CCP.md`, the vectors and the
certificate profile), as CONTRIBUTING requires.

**What a 2.2 reader sees** ([`spec/APDU.md`](../spec/APDU.md#what-a-22-reader-sees)): a reader
that holds to the major refuses the card at `SELECT` ([D205](#d205)). One that goes on meets a card it
can read and not pay from (`SPEND_ALL_BEGIN` without P1 bit 1 is `6A86`, [D197](#d197)), nor load
(`LOAD_PROOF` without P2 bit 1 is `6A86`, after a 2.2 loader has swapped to the card key: an
undated top-up so swapped is lost); a 4-byte `SPEND_ALL_CHANGE` is `6700`, 83-byte openings it
cannot finish, and a claim that answers `6A98`. Nothing it sends writes a wrong piece or burns one. flash-pos and flash-mobile,
which check the major alone, refuse a 3.0 card at `SELECT` until they move to the 3.0 wire for
change, set-up and top-up.

**The cards.** A 2.2 card moves to 3.0 as a 2.1 card moved to 2.2: swept, then a new
install, which makes a new key.

**The size.** A load file of 36,953 bytes by refcheck's measure (89 past a multiple of 256),
against 21,631 for 2.2. On 2026-11-13 a J3R180 installed earlier source, numbered 2.3 then,
padded to 33,647 and 35,213 bytes and refused the card's applet padded to 32,777 (`6F00`,
twice), so refcheck refuses a build from 32,700 to 32,850. This file is not padded. On the same
day the same J3R180 installed the file this source made before [D200](#d200) (35,466 bytes,
load file sha256 `48b8597c…`, answering `02 03`), and that file's chip run had real signatures
and real change verified at a test mint ([`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md)):
refcheck keeps its size and its hash. On 2026-11-14 the same J3R180 installed the file with
D200 to D204, still numbered 2.3 (load file `f216644a…`), and its chip run had real signatures
and real change verified too: refcheck keeps its size and its hash. This file is that one with
the version moved to 3.0 ([D205](#d205)), of the same size, and is not yet tried on a chip:
its own chip run comes before it ships.
The constructor asks for 30,056 bytes of persistent memory, 214 more than 2.2's 29,842
(the PIN's marks and the day's loads, the receipt's figures kept with the last signature, c,
the refund key's y and the count of the owners' c); the openings' keys, the keyset table and the paid list are
reserved at the first `SET_CARD`, and the certificate's store at the first `CERT_WRITE`, as
[D176](#d176) does for the settlement record. The install and a payment on a real card are
recorded in a hardware report before the tag.

**Rejected.** A major version 3: the AID, the slot, the secret and the signed message are 2.x's,
and a reader that checks the major still reads and pays. Profile bits in the capabilities byte:
all eight are taken.

## <a id="d194"></a>D194: A payment and its change come back; the keyset table is the holder's; the day counts change; less to a stranger and to software of 2.2

**Decided (protocol 3.0, 2026-11-13).** Amends [D175](#d175), [D183](#d183), [D184](#d184),
[D185](#d185), [D186](#d186), [D190](#d190), [D191](#d191), [D192](#d192) and [D26](#d26).

- **The signature of every kept receipt is asked for again.** The paid list closed 2.2's way
  back for a payment whose answer was lost (`CLEAR_SPENT`, then a reload of the piece the mint
  still holds unspent), and `SPEND_ALL_AGAIN` kept only the last signature, so a lost answer
  followed by a payment elsewhere stranded the first payment's pieces. The card now keeps the
  signature of each payment beside its receipt (16, the receipts' ring, 65 bytes each in
  `lastSig`'s form, after the paid list in the same reservation), written in the receipt's
  transaction and let go with the receipts by `RESET_CARD`. `SPEND_ALL_AGAIN` P1 = 1 takes the
  SHA-256 of the payment's `SIG_ALL` message, the receipt's own hash, and answers that payment's
  signature (`6A88` for none); P1 = 0 is the last, as before. Sixteen is the receipts' ring: a
  signature exists exactly as long as its receipt, with no index of its own. Asked for by the
  message and not by the receipt number: the till whose answer was lost holds its swap and can
  always work the hash out, where it learns no receipt number; a holder's phone that reads the
  receipts has the hash too. The PIN gate is the signature's own (`02`, given with no PIN, is
  given again with none).
- **A swap no mint takes is not signed.** The outputs and the card's change are added up as
  they come (in `allNet`, until the last `SIGN` writes what leaves the card there) and an output
  or a change that takes them past the pieces is `6A80`, the payment given up, at
  `SPEND_ALL_OUTPUTS` (among `SIGN`'s waits as well) and `SPEND_ALL_CHANGE`.
- **The change's keyset is named, held and taught.** `SPEND_ALL_CHANGE` takes the 45-byte form
  only (`6700` for 37); the keyset named must be in the table with its keys taught (`6A9F`) and
  of the payment's unit (`6A9B`); nothing is entered in the table there, so a reader with no PIN
  writes nothing in it. A card with no table makes no change (`6A84`), and the first `SET_CARD`
  reserves the table before the openings' keys.
- **The holder's mend moves an opening.** `KEYSET_KEYS` P1 = 3 with another key may name a
  keyset after it (41 bytes in all after the path): the path is folded to that keyset's top, one
  of the opening's unit (`6A9B`) and taught (`6A9F`), and the opening's key and keyset and its
  shown mark are written in one transaction. This takes back change the mint signed in another
  keyset (posted after the mint moved on: the `SIG_ALL` message names no output's keyset).
- **The till's outputs carry a keyset in the record.** `SPEND_ALL_OUTPUTS` P1 = 1 names the
  keyset of the reader's outputs (8 bytes before them), staged after the outputs (`outStage`, 8
  bytes more) and written for each of the reader's outputs in the payment's record; with none
  named, the first input's, as in 2.2.
- **Teaching is the PIN's.** The owner's grant alone teaches nothing: a keyset taught is a key
  the card writes change under, and the grant alone never put a piece on the card ([D185](#d185)).
  A version 01 ID's tail names its unit first and it must be the entry's; a version 00 ID hashes
  the keys alone, so the n-th key's amount is held to 2^n (rather than refusing version 00, which
  the CI's mint still serves).
- **The day counts the change until it is back.** The day's limit is held to the pieces whole
  (`SPEND_ALL_SIGN`), and `LOAD_CHANGE` gives the change back to the day's count, to no less than
  nothing, in one atomic copy after the piece; change of the other unit stays counted until the
  day ends. A reader handed the PIN that asks for nearly all of a large piece as change and keeps
  the mint's answer strands at most a day's worth. The wait is still held to what leaves the card,
  and the no-PIN allowance to the whole pieces ([D186](#d186)). A payment of nothing is still no
  roll ([D26](#d26)).
- **What software of 2.2 meets.** `ALLOW_LOAD` gives the grant and answers `6200`: ISO 7816-4's
  warning that lasting memory is unchanged (the grant is the tap's alone), so a 2.2 wallet that
  waits for `9000` before it swaps an owner's top-up to the card key stops before swapping, and a
  3.0 wallet reads the warning as the grant given. A payment in the other unit than the card's is
  begun only with `SPEND_ALL_BEGIN` P1 = 1 (`6A9B` otherwise), so a reader that reads no unit
  never pays cents as sats. `LOAD_PROOF` checks that C is a point of the curve itself (`6A80`).
- **The sealed PIN.** `unseal` checks the reader's point is on the curve before the agreement,
  and sealed `CHANGE_PIN` and `SET_PIN` answer an envelope that does not open with the word of
  one that opens (`6A91` and `6700`), so that the answer says nothing of the PIN key.
- **History to a stranger.** `GET_OUTBOX` P1 = 1 is answered in the time in the field that
  signed the payment and to the holder's say (`6982` otherwise); `GET_PROOF` answers a spent slot
  as empty, and `GET_INFO` says zeros for 21 to 28, 50 and 51 to 54 (and, until [D196](#d196), counted
  spent slots as empty: a wallet frees spent places by that count, and the slots' states say it
  anyway), to a reader that has given neither the PIN nor the grant in its tap. Still visible to
  anyone: the counts of places, the scope and receipt count (`GET_OUTBOX` P1 = 0), the slots'
  states and the spent places whole (`GET_SLOT_STATUS`, `GET_PIECES`), the openings owed, the
  keyset table, the no-PIN window's start (`GET_CARD`) and the card key; the installation is in
  the payment's packet, which a stranger is not given. (Since [D198](#d198): the spent places
  are not listed and answer as empty in `GET_PIECES` too, `GET_CARD` says zeros for the last
  header's hash, the rolls, the arming and the no-PIN window's start, and the scope is the
  paying reader's, the PIN's or the grant's. The counts and the slots' states stay.)
- **The certificate and the claim.** The seal takes the container's SHA-256 after its length and
  refuses a container that is not the one hashed (`6A80`). A claim wants a record of the holder's
  (`6A8C` for none or a factory record).
- **The PIN.** A locked card whose PIN is blocked takes its owner's `CHANGE_PIN` (it stays
  locked). A card whose PIN's tries are all gone under a state of 1 (a last try torn before the
  state byte) writes 2 before any command reads the state.
- **Tears.** Every write outside a transaction is reviewed below, now with the settlement
  record's arrays and with any NonAtomic copy or fill inside a transaction counted as outside one
  (a chip does not roll it back); the three such sites (the log's new entry, `SET_CARD`'s design
  and ratchet) and the receipt's empty output use the atomic copy now.
- **Limits.** The same day's number sent again, in any form, begins no new day. `SET_CARD` to a
  new unit turns the daily limit and count, the limit on one payment, the allowance and its count
  into it at the rate, rounded up, and is `6A99` on a card with a limit and no rate: turning keeps
  the holder's limits worth what they were, where clearing them would leave a card with none and
  keeping the numbers would make 100,000 sats 100,000 cents.

**Rejected.** A mint's proof checked at `LOAD_PROOF` against a taught keyset, to make the paid
list cost a mint's signature per piece: any 8 bytes name an entry and the holder teaches keys of
its own under the PIN, so the made-up pieces would come with good proofs, and the list would
stop the same readers it stops now. It would also cost a second command (the key and its path do
not fit beside the piece and its proof) and about the code of `unblind` and `blindChange`'s hash
to the curve (JVM bytecode 493 and 479 bytes; 400 to 500 bytes of load file after sharing).
Refusing version 00 keysets. Clearing the limits on a new unit. A receipt number for
`SPEND_ALL_AGAIN`.

**Cost accepted.** Change is made only in a keyset the holder's phone has taught, which needs a
piece of it on the card: after a mint moves on, a till pays exactly until the phone loads and
teaches the new keyset. 1,040 bytes more in the paid list's reservation and 8 in the staging.
Two RSA powers more for each piece loaded (the curve check). A 2.2 wallet's top-up stops at
`ALLOW_LOAD`; a 2.2 reader cannot pay pieces of the other unit. Load file: 963 bytes more
(31,448; 665 left under 32,113).

**Built (applet).** `PaymentRecoveryTest`, `ReaderChecksTest`, `HistoryPrivacyTest`; the
tear harness (`TearLoader`, `TearHook`: the applet's bytecode rewritten so that every
persistent write can be torn, with a chip's transactions) and its sweeps (`TearSweepTest`:
every write of 21 commands and flows torn, then every read and the money checked) and the
parser's (`ParserFuzzTest`: every instruction over P1, P2 and lengths in 21 life states: no
`6F00`, no refusal that writes first, no transaction left open); the existing suites updated
to the words and rules above.

| Site | Writes outside | Why a tear there is safe |
|---|---|---|
| `process` | `pinState` 2 where the tries are 0 and the state 1 | One byte, written once, before any command reads the state; torn, the next command writes it. |
| `processSpendAllBegin` | the staging's count and the reader's keyset to nothing (with the drafts let go) | Read only by this payment's `SIGN`; a tear drops the payment. |
| `processSpendAllOutputs` | the reader's keyset into the staging, after every refusal | The same. |
| `processSpendAllChange` | an opening's mark, `K`, amount, keyset and date, `B_`, then `DRAFT` (7; one fewer: the keyset is always the one named) | As [D183](#d183): the state byte is the opening's commit. |
| `stageOutput` | an output's amount and `B_`, then the count | Read only by this payment's `SIGN`. |
| `writeOutbox` | the record's body, after its status was cleared in a transaction of its own | Marked whole, with its length, only in the transaction that ends it: torn, no record, never a mix ([D175](#d175)). |
| `ensureDescriptor` | the descriptor after the body | Its flag is set in a transaction of one byte after it: torn, it is signed again at the next read. |
| `processSpendAllSign` | `burnList`; and the record's status byte where writing the record failed | As before; one byte. |
| `processLoadChange` | the day's count with the change given back | One atomic copy after the piece: torn before it, the day still counts the change, which stops a payment early and loses nothing. |
| `processResetCard` | as before, and the record's status bytes, the staging count, the generation (one atomic copy) and the signatures kept beside the receipts | As before: who the card is, last, in one transaction. |
| `CashuApplet` | the generation set to 1 | Install time. |
| `showKey` | none now: the key, the keyset and the mark in one transaction | Torn, the opening is as it was or as it is now. |

---

## <a id="d195"></a>D195: A claim wants an empty card; the PIN alone only tightens; a PIN with no owner waits and never blocks; 300 loads a day; eight pieces of change

*Amended by [D200](#d200): a payment's change is counted in the day of loads when the payment is
signed, and its `LOAD_CHANGE` is never refused for the count; `RESET_CARD` begins the day of loads
again.*

**Decided (protocol 3.0, 2026-11-13).** Amends [D186](#d186), [D187](#d187),
[D189](#d189) and [D191](#d191).

- **A claim wants an empty card, as 2.2 had it** (and, since [D196](#d196), a first set-up: a card
  set up with no owner is never claimed, and the way to a phone owner is a reset by the PIN). `SET_OWNER` on a card with no owner answers
  `6A8D` with anything unspent or any change owed, after the PIN, the record and the tap that
  paid are asked. "Never in a time in the field that paid" is a mark in RAM, and a time in the
  field ends when the reader's field does; on an empty card a claim moves nothing, whoever sends
  it. A holder with no phone who later wants a phone as owner moves the money to the phone,
  claims the empty card with it, and loads the money again.
- **With the PIN alone a number only tightens** (superseded by [D196](#d196): after the first
  set-up the PIN form sets nothing, `6A91`). `SET_LIMIT_PIN` checks each field the value
  carries against the card's, before anything is written, and answers `6A91` (the owner's proof
  is wanted) for one that is looser: a day's or payment limit above the card's, or `0` (none)
  where the card has one; an allowance above the card's (`0` is none); a budget above the card's
  (`0` on the card read as the default, 7); any other rate than the card's (the rate counts the
  other unit, and a lower one on a sat card, or a higher one on a usd card, counts it for less;
  the rate is set in the first set-up or by the owner); the no-PIN window's switch from `00` to
  `01`.
  With the PIN alone the no-PIN window and its count stay where they are: ending the window
  would hand the allowance back sooner. The rule is still under the old ones: no owner, the PIN
  given, nothing unspent or owed, a held tap on a used card.
- **A first set-up sets any number.** The selection in which `SET_PIN` gave a PIN to a card with
  no PIN or no record of the holder's (a new card, a card reset, a factory record) is the card's
  first set-up (since [D196](#d196) a card with no PIN alone: a new card or a card reset; a factory
  record no longer begins one): there `SET_LIMIT_PIN` takes any value, and one that carries the allowance ends
  the no-PIN window and arms it, as before. It is told apart by a byte in lasting memory,
  `pinMarks[PM_FIRST]`, set in `SET_PIN`'s transaction and set to 0 by the applet's `select()`,
  which the runtime calls at every selection, a `SELECT` or the chip's own at power-up. Nothing in
  RAM grants it: a reader that turns its field off and on, or selects again, ends a first set-up
  and starts none. A `SET_PIN` that replaces a PIN on a card with the holder's record (a blocked
  PIN, or one with three wrong tries in a row, below) starts none: that card's numbers stay, and
  only tighten.
- **The PIN of a card with no owner never blocks.** Each wrong `VERIFY_PIN` makes the next one
  wait twice as long: after the w-th wrong try in a row the next try owes 2^(w−1) askings, each
  a signature's work of the card's own answered `6A98` (about 0.7 s on a chip): 1, 2, 4, 8 and 16
  askings, then 32, 64 ..., at most 16,384 (about three hours a try, from the fifteenth on). The
  answer to a wrong try is `63CX`, X the wrong tries in a row (`F` for fifteen or more). The
  count and what is owed are `pinMarks[PM_WRONG]` and `pinMarks[PM_OWED, +2)` in lasting memory.
  The card counts a try as wrong and writes the next wait in one transaction **before** it
  compares the PIN, as the chip takes a try before it compares; a right PIN sets both to 0 after.
  A card taken out of the field at any point has the try counted or never made. The wait is
  served in **stretches** of 16 askings (about ten seconds, what one tap is asked to hold): the
  asking after a stretch writes what is still owed, less the stretch, in a transaction, and
  answers `6A98` again while anything is owed. So the wait outlasts the power: a pull loses at
  most the stretch under way, never a stretch done, and a long wait is served over as many taps
  as it takes. The askings of a stretch are counted in RAM (`nonceLive[1]` with `HELD_PIN`, as a
  claim's and a history's are), and any other command, a `SELECT` among them, begins the stretch
  again. The chip's own counter is filled again before each try (`resetAndUnblock`), so it never
  reaches 0. After three wrong tries in a row the card counts as not set up for `SET_PIN`, which
  replaces the PIN with nothing unspent or owed (and the history goes with it), as it replaced a
  blocked PIN: the way back for a forgotten PIN on an empty card. A `SET_PIN` sets the count and
  the wait to 0.
- **A card with an owner keeps three tries**, a blocked PIN and the owner's `CHANGE_PIN`, as
  before. Its marks are never written. A card claimed has the count at 0 (a claim wants the PIN
  given in the tap, and a wrong try after it ends that), and its chip counter full; a card reset
  has no PIN, and its next holder's `SET_PIN` sets the count to 0.
- **A card loads at most 300 pieces a day** by its own clock, `LOAD_PROOF` and `LOAD_CHANGE`
  alike (`LOADS_A_DAY`), so the paid list's 1,024 rows ([D191](#d191)) take four days of loads to
  go round: a flush takes a little over three days of the card's clock, where it took minutes.
  A load past it is `6A8F` (the word of the day's limit: a reader already reads it as "come back
  tomorrow"), asked after every other check of the piece, with nothing written. The count and
  the day it began are `pinMarks[PM_LOADS, +2)` and `pinMarks[PM_LOAD_DAY, +4)`: a day of loads
  begins at the first load at or past a day after the last began (`windowIsOver`, at the card's
  `now`), and the count and its day are written in one atomic copy before anything of the piece,
  so a tear leaves a load counted and not made, never a piece not counted. A card that has taken
  no header (`now` = 0) begins no day: it loads 300 pieces and then nothing until its first
  header, the safe end of "one day's pieces before the clock". `RESET_CARD` leaves the count, as
  it leaves a certified card's list. `GET_INFO` P1 = 4 says the loads left today (bytes 57 and
  58: 300 less the count, or 300 where a day has passed since the day began) to a reader told
  the history (the PIN or the grant; zeros to anyone else), so that a wallet swaps for no more
  than the card will take today (with the free places, byte 5): a top-up swapped past them
  waits in the phone, locked to the card's keys, and is lost if the card is reset or lost first.
  Four bytes of the answer, 52 of the load file. **`LOAD_CHANGE` counts**: change is not exempt, because a
  payment's change, written back, is spent again, and a payment of eight pieces makes eight
  openings: a holder online at the mint could push rows through the list by payments to itself
  and their change alone, eight or more a payment, with no `LOAD_PROOF`. At the cap the change
  stays owed, and goes on the next day (the mint's answer is restored from its `B_`, NUT-09,
  where the reader that took it is gone). The days are the card's clock's, which a reader moves
  only up to the real chain's tip: a card whose clock has fallen behind lets the days it missed
  be loaded at once, so a reader that takes a payment offline sends the card a recent header
  first. 128 places on the card loaded before a payment count too: the rows after a payment can
  begin with up to 128 pieces already on the card.
- **Eight pieces of change.** The card makes up to eight change outputs in a payment, one
  `SPEND_ALL_CHANGE` each, as many as it has openings free (eight in all, those still owed among
  them). Nothing in the applet held a payment to four; this is now said and tested. A reader may
  make fewer: four, then the owed change of the rest by another payment.

**Why.** The marks of a time in the field are RAM that the reader's field ends, so nothing
a reader handed the PIN may do rests on them: a claim moves no money, and a number it writes
only tightens. Money on a card with no owner stays within reach of its holder's PIN, whoever
sends wrong tries: the waits keep guessing slow (a four-digit PIN takes years of contact) and
leave the holder's right PIN working.

**Rejected.** A paid list that never forgets: a card must never become unusable because a list is
full. A cap per time in the field on a card with no clock: a reader cycles its field. A PUK or an eight-digit unblock code: one more secret for a holder with no
phone to keep (the fallback if the waits had not fitted). A claim allowed under a day's limit
of money: the limit is the owner's to lift. A clock: the card has none that runs. Tightening
with money on the card: a day's limit under the smallest piece would strand it, with no owner
to loosen it.

**Cost accepted.** A holder with no phone cannot loosen a number after the first set-up
without making a phone the owner (since [D196](#d196): the card emptied, reset by the PIN and set
up again), nor change the rate (the rate of a value it sends must be the card's, `GET_INFO`
P1 = 3 in a held tap). A holder who loads more than 300 pieces in a day waits for the next. A stranger may make a card with no owner wait before its holder's next try (a wait it
has to hold for itself, 2^(w−1) askings for its own w wrong tries), and on an empty card may
replace the PIN after three wrong tries, as it could block and replace it before. `GET_INFO`
byte 9 on such a card is the chip's counter (2 or 3), not the wait. Ten bytes more of
persistent memory at install (29,852). Load file: 641 bytes more (32,089; 24 left under 32,113).

**Built (applet).** `ClaimWhenEmptyTest`, `TighterLimitsTest`, `PinWaitTest`,
`ChangePiecesTest`, `LoadCapTest`; `TearSweepTest`'s sweeps of a load counted with its day (and a
new day beginning) and of a wrong and a right `VERIFY_PIN` on a card with
no owner and of a wait of two stretches pulled at every write.

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `select` | the first set-up's mark to 0 | One byte. Torn, the mark is still set and the next selection clears it; no command runs in a selection whose `select` did not return. |
| `countTry` | the chip's counter filled again (`resetAndUnblock`), after the count and the next wait are written in a transaction | Torn before the transaction's commit, no try was made; after it, the try is counted, and a counter not filled is filled before the next check. |
| `loadOne` | the day's loads and the day they began, one atomic copy of six bytes, before anything of the piece | Torn before it, nothing of the load was made; after it, the load is counted and its piece may be missing, which only brings the day's end nearer. |
| `processVerifyPin` | the marks to 0 after a right PIN (one atomic copy) | Torn before it, a right PIN is counted as one wrong try more: the next try waits, nothing opens. |
| `waitOwed`, `processSetPin` | none new: what is owed after a stretch, and the first set-up's mark and the marks' 0, are written in transactions | |


---

## <a id="d196"></a>D196: Simple cards; no load over the day's limit; the receipt from the payment's commit; change back to the day that counted it; GET_INFO's counts

**Decided (protocol 3.0, 2026-11-13: simple cards).** Amends [D186](#d186),
[D187](#d187), [D189](#d189), [D191](#d191), [D194](#d194) and [D195](#d195).

- **A simple card.** A card with no owner has its limits, its no-PIN allowance and window
  switch, its rollover budget, its rate, its mint, its unit and its refund key set once, in
  its first set-up, and never again. After it `SET_LIMIT_PIN` and `SET_CARD` answer `6A91`
  (the word 3.0 gives what the PIN alone may not do), with nothing written; the PIN form's
  "only tighter" ([D195](#d195)) is gone with the rest. A claim (`SET_OWNER` on a card with no
  owner) is made only in a first set-up (`6A91` after it), after the PIN (`6A97`, `6982`)
  and the holder's record (`6A8C`), and, as before, never in a time in the field that paid
  (`6985`) and only on an empty card (`6A8D`). An owned card is as it was.
- **The first set-up, and how it is told apart.** It is opened by the `SET_PIN` that gives a
  PIN to a card whose PIN state is 0, and by nothing else. The PIN state is 0 on a card that
  has never had a PIN and on a card just reset; `RESET_CARD` is the one command that writes
  it to 0. The first set-up is a byte in lasting memory, `pinMarks[PM_FIRST]`, written in that
  `SET_PIN`'s transaction and set to 0 by the applet's `select()`, which the runtime calls at
  every selection: a `SELECT`, or the chip's own at power-up. A reader that turns its field
  off and on ends a first set-up, and nothing but a reset can begin another: a `SET_PIN` on a
  card that has a PIN (under that PIN, or after three wrong tries in a row) begins none, and a
  factory record no longer makes a card "not set up".
- **The factory record.** A record whose mint is `-` alone goes only on a card that has never
  had a PIN (`hadPin`) and holds no record of a holder's: `6A80` otherwise, on an owned card
  too. Before its first PIN a card's record is written by whoever holds it (it takes and pays
  nothing, [D185](#d185)); after its first set-up only a reset clears it.
- **The way back: a reset by the PIN.** `RESET_CARD` P1 = 0 on a card with no owner takes no
  data and no proof: the PIN given in this tap (`6A97` with none, `6982`), a held tap (`6985`
  in a time in the field that paid, `6982` with no hold, [D189](#d189)), no data (`6700`) and
  nothing unspent or owed (`6A8D`); then `RESET_ASKINGS` (60) askings of the same command in a
  row, each a signature's work of the card's own answered `6A98` (some forty seconds on a
  chip), counted in RAM as a claim's are (`nonceLive[1]` with both held marks, `HELD_RESET`);
  any other command between, a `SELECT` among them, begins the count again. The sixtieth
  resets the card as the owner's reset does: no PIN, no owner, no record, no limits, no
  history, every opening and entry free, a new card key and an empty paid list, or, on a
  certified card, the same key and the list kept ([D191](#d191), [D192](#d192)). The holder then
  sets it up again in a new first set-up, with a phone that claims it, or by the PIN alone.
- **The forgotten PIN** ([D195](#d195)) stays: three wrong tries in a row on an empty card with no
  owner, then `SET_PIN`. It begins no first set-up, so the card's numbers stay, and the
  history goes with the PIN it replaces: the log, the receipts, the last signature, the
  signatures kept for `SPEND_ALL_AGAIN` P1 = 1, the last payment's packet (`GET_OUTBOX`), and the
  keyset table's history (the last payment's unit, the other unit's count of what was signed for,
  the receipts' units; the entries are settings and stay). `RESET_CARD` clears the same through
  one helper, `forget`, which steps the packet's generation first, as the reset always did: the
  receipt count begins again at 0, and the next packet's payment id and generation are a pair no
  packet had.
- **No load over the day's limit.** `LOAD_PROOF` refuses a piece whose amount is above the
  day's limit, where one is set, with `6A8F` and nothing written: the day holds a payment's
  pieces whole ([D194](#d194)), so such a piece could never be paid, and on a simple card
  nothing could ever lift the limit. The amount is the card's unit's; a piece of the other
  unit is turned at the rate and rounded up, as a payment's figures are (a card with a limit
  and no rate takes none of the other unit, `6A99`). It is asked after the paid list, before
  the day's loads, so a batch stops at the first such piece. A piece above the limit on one
  payment goes on: it is paid with the wait ([D188](#d188)). `LOAD_CHANGE` is not refused: the
  card's own change is of a payment whose pieces the day held whole, and is never above the
  day's limit.
- **The receipt from the payment's commit.** The payment's transaction keeps, beside the
  signature in `lastSig` (now 101 bytes), what left the card (4) and the hash of the message
  signed (32). The receipt, the unit beside it (the last payment's, which the same commit
  writes in the table) and the signature kept for `SPEND_ALL_AGAIN` P1 = 1 are written from
  them in one transaction with the clearing of `burnPending`, by `finishBurn`, at the end of
  `SPEND_ALL_SIGN` or, where the card left the field first, at its next command, before
  anything reads a place. So a payment committed always has its receipt and its kept
  signature, and P1 = 1 finds it after a pull at any point and after other payments (up to
  sixteen, the receipts' ring). A receipt finished by the next command has zeros where the
  till's output and the time the terminal told were: they were RAM. What left the card and the
  hash are written beside the signature just before the payment's transaction, outside it, and
  the signature with its mark in it as one write: `finishBurn` reads them only while `burnPending`
  is set, which the commit sets.
- **Transactions a chip can hold.** A chip's commit buffer holds only so many writes and bytes
  (the card this runs on refused a payment's transaction of about 30 writes). The payment's is
  kept small: each count it adds to is worked out in RAM and written with one copy (not four
  bytes one by one), a new log entry is made whole in RAM and written once, and the entry's
  figures and flags are one write; at its worst (a day that rolls, a no-PIN payment that begins
  a window and takes the arming, a new tap, the paid list going round, eight openings of
  change, a payment that waited) it is 17 writes and 132 bytes, against 2.2's worst of about 27
  and 112. Should a transaction not fit all the same: the payment's answers `6A96` with nothing
  burned (as before); `SET_CARD`'s answers `6A96` with nothing of the record written; and the
  receipt's is given up, the note that it is owed taken down in a transaction of one byte, so
  the card works on: the payment stands, its pieces spent and on the paid list, the till has the
  signature in the answer (and from `SPEND_ALL_AGAIN` P1 = 0 while no later payment is signed),
  and only that payment's receipt, kept signature and settlement record are lost
  (`SPEND_ALL_AGAIN` P1 = 1 and `GET_OUTBOX` answer `6A88`): the record's payment id is the
  receipt count, which that payment did not step, so `SPEND_ALL_SIGN` leaves no record rather than
  one with another payment's id (`finishBurn` answers whether the receipt was written). Without
  that, a receipt that did not fit would have been asked for again at every command, `SELECT`
  among them. `SET_OWNER`'s transaction (the owner's flag, a new c and the settlement record's status
  set to none on a replacement, the anchor, the key last) answers `6A96` the same way, with nothing written, and a claim is asked again; the
  key is written last, so that a chip whose key writes take no part in a transaction has not
  written it where the rest did not fit.
- **A forgotten PIN's history goes after the new PIN's commit.** The `SET_PIN` that replaces a
  forgotten PIN marks the history owed (`pinMarks[PM_FORGET]`, one byte more at install) in the
  PIN's transaction, and `forget` runs after the commit, here or at the card's next command
  (`process`, after a payment's owed burn). Torn before the commit: the old PIN and all of the
  history. After it: the new PIN, and the history gone before anything reads it.
- **A simple card's numbers before its record.** In the first set-up, `SET_LIMIT_PIN` before
  `SET_CARD`: a set-up cut between the two leaves a card with no record, which takes nothing
  (`LOAD_PROOF` `6A8C`) until it is set up again. In the other order the cut leaves a card that
  loads with no limits, for good. The numbers are in the unit the record names: `SET_CARD` on a
  card with no record of a holder's (new, reset, or a factory record) turns nothing by the rate
  and asks for none, so a usd card's limits are sent in cents and kept as sent. Then `SET_HEADER`
  gives the card its clock in the same set-up, and the phone reads `GET_INFO` P1 = 4 and
  `GET_CARD` back before the first load.
- **The reset by the PIN takes the hold with the PIN.** It clears the held tap's mark and the
  arming (`TAP_READ`, `TAP_ARMED`), keeping the marks that a payment was signed or an owner
  claimed in the time in the field: a new PIN given in the same selection has no hold until it
  holds for one.
- **Change given back to the day that counted it.** `pinMarks[PM_COUNTED]` has a bit an
  opening: set by the payment that made its change, in its transaction, on a card with a day's
  limit; all cleared by a payment that begins a new day and by a day's limit that changes.
  `LOAD_CHANGE` gives the change back to the day's count only where its opening's bit is set,
  and its status byte, the opening let go and the give-back are one transaction, begun in
  `loadOne` after every refusal and committed by `LOAD_CHANGE`. Change from an earlier day, or
  made before the limit, gives nothing back. The bit stays after: it is read only for an
  opening owed, and a payment that makes change in that opening sets it again.
- **`GET_INFO` says the counts of places as they are** (bytes 3 to 5), to anyone: a wallet
  frees spent places by byte 4, and `GET_SLOT_STATUS`, `GET_PROOF_COUNT` and `GET_PIECES` say as
  much. The day's window and count (21 to 28), the last unit (50) and the no-PIN window's start
  (51 to 54) stay zeros to a reader with neither the PIN nor the grant.

**Why.** Every number the PIN alone could write after a card's first set-up was a number a
reader handed the PIN for one payment could write too, on the card it had just emptied: a
looser limit, a claim of the card, or a day's limit under the holder's next top-up. A simple
card has no such number. The reset is the holder's way to change them, and it is slow, so
that a reader that took one payment cannot do it in the moments the card is in its field.

**Rejected.** A first set-up that lasts until the first load: a card set up and never loaded
would stay open to whoever holds it next. Numbers that only tighten after the first set-up: a
tight number set on an empty card strands what is loaded next. A reset by the PIN with no
wait. Refusing a load above the limit on one payment: such a piece is paid with the wait, and a
reader that may load would learn the limit, which is the holder's, by trying. The whole receipt
in the payment's transaction: about 150 bytes more in a commit a chip holds only so much of.

**Cost accepted.** A set-up cut short (the card out of the field before its numbers or its
claim) is finished only after a reset by the PIN. A holder with no phone who wants other numbers
empties the card, resets it and sets it up again. Whoever sets a new card up first has it: a
card set up by someone else on its way to its holder answers its holder's `SET_PIN` with
`6982`; the holder resets it (three wrong tries, `SET_PIN`, a held reset) unless it was claimed,
and a card claimed is the claimer's (nothing was on it). A reader handed the PIN that holds an
empty card for the reset's minute can set it up again with the holder's PIN and numbers of its
own; the card it leaves has a new card key (unless certified), a new c, a generation one more and
no history. **This is a risk accepted**: about 45 seconds of holding (the history's nine askings
and the reset's sixty) with the PIN, on an empty card; no till takes that long to take a payment.
The reader can set the card up with the holder's PIN and mint and with numbers, a refund key or
an owner of its own, refund key included, and the holder's next top-up is under them. The
holder's own phone sees it before a top-up: `GROUP_KEYS` for the next load's date answers other
keys than the P + t·G and R + u·G it works out from what it keeps ([D197](#d197)). A guest wallet
that has never seen the card cannot tell. Persistent memory at install: 37
bytes more (29,889). Load file: 32,066 bytes (47 left under 32,113).

**Built (applet).** `SimpleCardTest`, `LoadLimitTest`, `KeptSignatureTest`, `ChangeWindowTest`,
`TearSweepMoreTest` (sweeps of a payment torn and another after it, the ring going round, the
forgotten PIN, the first set-up, `LOAD_CHANGE` giving the day back, a reset by the PIN), and
`HistoryPrivacyTest`'s counts.

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `forget` | first the packet's generation, worked out in RAM and written with one atomic copy; the keyset table's tail (the last unit, the other unit's count, the receipts' units); the log, the receipts, the last signature and the signatures kept, filled with zeros; then the last packet's status byte | The generation first: torn anywhere after it, a card has at worst a larger generation, never a receipt count of 0 under the old one; sent again after a tear it steps again, which is only a larger number. Torn later, part of the history is gone and the command, sent again (or `process`, for an owed forget), takes the rest; nothing is given that was not before, and the PIN or the reset that follows is in its own transaction. |
| `processResetCard` | as before ([D23](#d23)), the generation and the history now by `forget` | Torn before the last transaction, the card is still its own (owner or PIN), and the reset is sent again. |
| `loadOne` | for the card's own change, nothing new: its status byte is written in the transaction `LOAD_CHANGE` commits, with the opening let go and the day given back | Torn, the change is on the card with its opening let go and the day given back, or none of it. |
| `finishBurn` | as before, the paid list's rows and the status bytes, then the receipt and the note's clearing in one transaction | Torn before that commit, the next command does it all again: the same rows, the same bytes, and the receipt once. A receipt the chip cannot hold: the note cleared alone, in a transaction of its own. |
| `processSpendAllSign` | what left the card and the message's hash beside the last signature, before the payment's transaction | Read only by `finishBurn`, only while `burnPending` is set, which the commit after them sets; torn before it, they are a payment's that nothing reads, written again by the next payment. |
| `logEntry` | a helper, as before ([D23](#d23)): the count of taps and the new entry, made whole in RAM, one copy each | Every caller holds a transaction around it. |
| `processSetPin`, `forgetOwed` | the history (`forget`), now after the PIN's commit, then its mark (one byte) | Owed from the commit: torn before it, nothing of the history is gone; after it, `process` takes the rest down at the next command, before anything reads it. |

## <a id="d197"></a>D197: Keys per load: every piece is locked to the card's key for its date

**Decided (protocol 3.0, 2026-11-13: privacy from the mint).** Amends [D175](#d175),
[D184](#d184) and [D192](#d192). *Amended by [D202](#d202): the owner's phone gives the card a c made
from its words at the claim or the hand-over (`SET_OWNER` P1 = `01`, then the check), with the card's
count of the owners' c in it; a card with no owner, a reset and a claim or hand-over that brings none
draw or keep the card's own, as below.*

- **The card's secret c.** 32 random bytes, drawn at install, at every `RESET_CARD` (written in
  the reset's last transaction, with who the card is) and when `SET_OWNER` replaces an owner
  (written in that command's transaction, with the new key; only with nothing unspent and no
  change owed, `6A8D`, so nothing locked to the old c's keys is on the card or still to come to
  it; the last owner's settlement record goes in the same transaction, so that no packet is
  signed at its first read with t from the new c while it names the old date-0 key), kept in lasting memory beside the refund key's y. `GET_CARD` P1 = 3 gives it, never in the
  clear, after `GET_NONCE` P1 = 1 (whose sixteen bytes it uses up):
  - on a card with a refund key R, sealed to R: the card draws a fresh k and answers K = k·G and c
    XOR block 1 of the seal's sum over the x of k·R (with K in E's place, the sixteen bytes and the
    instruction). Only the holder of r opens it (r·K = k·R), so it is given at any tap to the
    holder's say: the owner's grant, or on a card with no owner the PIN given in this tap. A phone
    restored from its words, or one that missed the set-up tap, reads c again so.
  - on a card with no refund key, sealed as a PIN comes to it: the reader sends its key for the
    message, E, and the answer is c XOR block 1 of the seal's sum over the x the PIN key and E
    share. Whoever runs that tap opens it, so it is given to the owner's grant, or on a card with no
    owner to the PIN given in its first set-up ([D196](#d196)) and in no later tap; such a card
    never gives c again until a reset.

  `6982` otherwise. A listener on the air gets K (or E) and c XOR a block it cannot work out; a
  relay in the tap after the holder's PIN or grant gets one more sealed answer, which it opens only
  holding r, or, on a card with no refund key, being the reader of the first set-up. A wallet keeps
  c with the refund key's private key r: a refund needs both.
- **A date's keys.** For a date D, the four bytes every piece carries (`00000000` for an undated
  piece): t = SHA-256("CashuCard/key" ‖ c ‖ D) mod n and the card's key for D, P + t·G; where the
  record has a refund key R, u = SHA-256("CashuCard/refund-key" ‖ c ‖ D) mod n and the refund key
  for D, R + u·G. The labels are distinct and c is of fixed length, so the two hashes never meet.
  An undated piece's secret names no refund key, so for the date 0 the card answers R + u·G as
  zeros (`SPEND_ALL_BEGIN`, `GROUP_KEYS`).
- **The load date.** D is the pieces' NUT-11 locktime, from which the refund key can spend them:
  a wallet picks it in the future, at the refund date it wants, never the time of the load (which
  would open the refund at once, while the pieces are still on the card). Top-ups share one date
  for 7 days: a wallet reuses the date of the week's first load for every load within 7 days of
  it, then takes a new one; so D is at least 7 days and a margin ahead at its first use (for
  example 30 days; *amended by [D203](#d203): at least 8 days and the time to move*). Nothing on the card changes for this: the card does not read dates, and its
  change keeps the payment's date. The holder's wallet moves a date's pieces to a new date before
  D (*amended by [D203](#d203): before D less a day, less the time the move takes*), and a reader, online or not, leaves out of a payment a dated piece whose locktime is less than a
  day after its own time, which the refund key may spend first (*amended by [D203](#d203): a day's
  margin, the owner taking back only a day after D*). A payment is of one date, so a week's pieces pay together;
  the mint ties the spends of one week's money to each other, never across weeks nor to the card.
  Undated pieces are one date, the date 0, for the card's life (until a reset or an owner
  replaced); a card with no refund key takes only those (`6A8E`) and so gains nothing from keys
  per load.
- **Part of the 3.0 card format.** Keys per load is not a profile a card may leave out: every 3.0
  card keeps it (`GET_INFO` byte 56 bit 1), and a reader of 3.0 cards loads and pays only this
  way. Nobody may lock ecash to P itself, the key `GET_PUBKEY` answers and a certificate names:
  the card signs a payment only with d + t, never with d alone, so such ecash is never the card's
  to pay; undated it is lost, dated it is the refund key's after its date. The proof format byte
  stays `04` (`05` with two units): a reader of 2.2 that reads it is stopped at `SPEND_ALL_BEGIN`
  and `LOAD_PROOF` (`6A86`), and a 3.0 wallet checks the version and byte 56 before it swaps.
- **The pieces and the payment.** A piece of date D is the card proof secret with `data` P + t·G
  and, dated, `["refund", R + u·G]`; the card builds every secret of a payment so, signs it with
  d + t mod n (BIP-340 sets the parity, as for d), and makes its own change in the payment's date,
  so under the same keys. A payment is of one date already (`SPEND_ALL_BEGIN` refuses a place of
  another date, `6A80`), so every input of a swap has one key, as NUT-11 `SIG_ALL` wants. No mint changes.
- **The wire.** `SPEND_ALL_BEGIN` takes P1 bit 1 (`02`): the reader's word that it builds the
  secrets with the keys per load. Without it the card answers `6A86` before it reads a place or
  writes anything, so a reader that builds the secrets with P never has pieces burned for a swap
  no mint takes. [D184](#d184)'s P1 = 1 is bit 0 beside it: a reader of 3.0 sends `03` where it
  reads units, `02` otherwise. It is the bit `GET_INFO` byte 56 says keys per load with, so a
  reader sends back the bit the card shows. `SPEND_ALL_BEGIN` answers 69 bytes: the worth (4), t
  (32), R + u·G (33, zeros with no refund key or for the date 0). `LOAD_PROOF` and `LOAD_CHANGE`
  take P2 bit 1 (`02`) the same way: the loader's word that each piece is locked to the keys of its
  date. Without it the card answers `6A86` before the data is read, with nothing written, so a
  loader that locked a piece to P never leaves a piece on the card that no payment could spend
  (the card cannot check a lock itself). P2 bit 1 because `LOAD_CHANGE`'s P1 is the opening's
  number and `LOAD_PROOF`'s P1 = 1 is read whole, while P2 bit 0 is already `LOAD_PROOF`'s unit
  first: the same value, `02`, as `SPEND_ALL_BEGIN`'s bit, on every command that touches a date's
  keys. `GROUP_KEYS` (`1D`, new) answers a date's t, P + t·G and R + u·G (98) to a reader with the
  PIN given in its tap or the owner's grant (`6982` otherwise), worked out in working memory: it
  writes nothing of the card's state (the chip's key object for the point addition is set, as at
  every payment). A loader has the PIN in its tap ([D185](#d185)); a till has its
  payment's t from `SPEND_ALL_BEGIN` and needs no other date's. `SET_CARD` takes only a
  refund key whose x is a point of the curve (`6A80` otherwise), and keeps its y beside c in the
  record's transaction. The settlement record names the card's key for the date 0 (its pieces are
  undated) and its descriptor is by that key; the card works t for the date 0 out again from c
  when it signs the descriptor, so a payment begun since changes nothing. `GET_INFO` byte 56 bit 1
  says the card keeps keys per load.
- **Certificates.** Unchanged: a certificate vouches for P. A reader checks it over P, then checks
  the payment's key is P + t·G with the t the card answered. A known tweak weakens nothing: anyone
  can work out P + t·G, only the card can sign for it. Ecash locked to a certified card's keys for a
  date before a hand-over is not the next holder's: the reset draws a new c, so the card builds other
  keys for that date and can never pay it; it is the old holder's to refund (r + u of the old c,
  after its date), and an undated one is lost.
- **The check before a top-up.** A wallet that keeps P, R and c compares `GROUP_KEYS` for the date
  it is about to load with the keys it works out itself. A card reset since, or whose owner was
  replaced, answers other keys (a new c). The generation (`GET_OUTBOX` P1 = 0) is not that check: it is the PIN's or the grant's,
  and a card with no record answers it `6A88`.

**Who can link what.**

| Who | Before | With keys per load |
|---|---|---|
| The mint | every spend of the card, for its whole life, to one key P, and its refunds to R | the spends of one date to each other (a date is a week's loads); no date to another, nor to P or R, which it never sees, and it cannot work out t or u without c. Amounts, times and keyset ids remain patterns |
| A till paid with no PIN | P, the certificate, every piece on the card | the same, and the t of every date with a piece on the card (`SPEND_ALL_BEGIN` answers it before any PIN): with the mint's help it ties those dates' spends to the card; not the dates no longer on it (`GROUP_KEYS` wants the PIN) |
| A reader given the PIN (a loader, or a till handed it) | everything | P, every piece on the card, the history ([D198](#d198)), and the keys of any date (`GROUP_KEYS`): with the mint's list of the dates and keys it saw, every spent date of the card since its c was drawn; not c |
| A stranger holding the card | everything a till learns, and the history | what a till paid with no PIN learns: P, the pieces on the card and the keys of every date among them (`SPEND_ALL_BEGIN`), and so, with the mint's help, every spend of those dates (a week's loads already spent, and every undated spend); r of each piece on the card (`GET_DLEQ`), which ties the swap that made it (a payment's change, or a top-up loaded with its proof); and the card's no-PIN payments among the last sixteen (`SPEND_ALL_AGAIN` P1 = 1). Not c, not the keys of dates no longer on the card, not the spent places ([D198](#d198)), not the payments under the PIN. This is the honest limit of the card's privacy against someone holding it: a till needs t and r before it has the PIN. Since [D199](#d199), also the inbox name of each week from the card's last header up to now (`INBOX`, on a card that is not locked, the clock moved by real headers), and so whether money waited for the card in those weeks |
| The holder's phone | everything | everything: it holds c |
| The mint and a till paid with no PIN, together | every spend of the card | the spends of every date with a piece on the card when the till held it |
| The mint and a reader given the PIN, together | every spend of the card | every spend since the card's c was drawn (its last reset) |
| A listener on the air at the set-up, or at a later reading of c | (c did not exist) | nothing of c: it leaves the card sealed to the refund key the record names now, or to the PIN key; after a hand-over, never to the last owner's refund key, which goes with it |
| The reader of a first set-up, on a card with no refund key (a kiosk setting up a card for a holder with no phone, or a relay in that tap after the PIN) | (c did not exist) | c, and so every date's keys: what a reader given the PIN learns, for good, until a reset |
| The last owner, after `SET_OWNER` replaced it | (c did not exist) | nothing of the new owner's spends, and no key to its money: <ul><li>the replacement draws a new c, or takes the next owner's, made from its words ([D202](#d202)), which the last owner cannot work out;</li><li>the record's refund key goes with the hand-over, so c is never sealed to the last owner's key, and no dated piece is taken until the new owner names its own (`SET_CARD`, `6A8E` before it);</li><li>the PIN the last owner knows opens nothing (`VERIFY_PIN` answers `6982`) until the new owner's `CHANGE_PIN` sets one of its own.</li></ul> |
| The new owner, after `SET_OWNER` | (c did not exist) | nothing of the last owner's spends: <ul><li>the hand-over clears the history as a reset does: the log, the receipts, the kept signatures, the settlement record, the spent places and their kept proofs;</li><li>it clears the day's counts (the window and what it signed for, the no-PIN window's start and count, the day of loads), the clock's last header hash, the rolls and the arming, the paid list and every keyset entry nothing names;</li><li>c is new.</li></ul> |
| The mint, for a card with no refund key | every spend, to P | every spend, to the date 0's key: undated pieces are one group, so such a card gains nothing |

**Why.** A card's key was in every secret it ever spent, so the mint (and anyone the mint told)
could list every payment of a card for its life. The date is already the one thing a payment's
pieces share, so the key follows it: nothing new can stop a payment, and a mint is unchanged.

**Rejected.** A key per piece: NUT-11 `SIG_ALL` takes one key a swap, and a signature per piece
(`SIG_INPUTS`) would let a reader move the outputs, the card's change among them. The card key
signing each date's key: a signature per payment, and it ties the date to the card as t does. A
secret only the card holds: the phone could not refund a lost card's pieces. A counter instead of
the date: a table on the card, and a payment could no longer take two loads' pieces of one date.
`SPEND_ALL_BEGIN` as 2.2 had it, with no word from the reader: a reader of 2.2 would have the
card sign and burn for secrets the mint refuses, and the money would wait for a reader of 3.0 or
the date. `LOAD_PROOF` with no word: a loader of 2.2 locks to P, and the card would take a piece
it could never pay. `GROUP_KEYS` to anyone: with the mint's list of dates and keys, one tap would
tie every spent date to the card. `GROUP_KEYS` to the tap that paid: a payment within the no-PIN
allowance would open every date. Gating `GROUP_KEYS` to dates the card holds now: 40 to 60 bytes
more, and a reader with the PIN reads the spent pieces whole anyway. c in the clear: the set-up
tap heard on the air would tie every payment of the card. c to the PIN in any held tap in a form
the PIN's reader opens: a guest phone, or a till that learned the PIN, would keep it; sealed to the
refund key, only the holder of r opens it. c kept across an owner replaced: the last owner and the
next would each tie the other's spends to the card. A replacement that keeps the history and the
PIN: the next owner would read the last owner's payments, and the last owner, who knows the PIN,
would read every date's keys of the next. Telling the next owner to hand over with `RESET_CARD`
instead: a card carries its owner's settings and its key through `SET_OWNER`, and the text must be
true of the command as it is. A format byte for keys per load: the readers of
2.2 that exist check the major version (and, in this repository's tools, the format only in a
self-test), so it would stop none of them before a swap. A fresh date for each load: a payment of
more than one load's pieces took one signature a date, each after the first slowed as a second
payment in the tap.

**Cost accepted.** A reader of 2.2 does not pay a 3.0 card: it sends `SPEND_ALL_BEGIN` with P1 =
`00` and is refused (`6A86`) with nothing begun, written or burned. Nor does it load one: `LOAD_PROOF`
with P2 = `00` or `01` is refused (`6A86`) before the data is read; but a 2.2 loader swaps to P
first, so its undated top-up is lost (a dated one is the refund key's after its date): a 3.0 card
is loaded by a 3.0 wallet. A reader given the PIN can link every date since the last reset with the
mint's help (it reads the spent pieces whole as well). A wallet that loses c reads it again with r
and the holder's say on a card with a refund key; on one with none it cannot refund a lost card's
dated pieces (and that card takes none). A reader that sets bit 1 and
still builds its secrets with P has the pieces burned and the swap refused; they are not lost (the
signature is over the right message: the till and `SPEND_ALL_AGAIN` keep it, an undated
payment's packet carries it, and a dated piece is refunded after its date). A wallet must read c again
after any reset or owner replaced, and checks `GROUP_KEYS` before a top-up: pieces locked to an old c's keys are not
the card's to pay, and are refunded with r + u after their date. c leaking ties a card's dates together; it moves no money. Undated
pieces are all one date. Time: `SPEND_ALL_BEGIN` two SHA-256 and two point additions of the chip
(one each with no refund key), some 0.2 s on a payment of about 3 s; `GROUP_KEYS` the same;
`SET_CARD` with a refund key three powers of the chip's RSA, once. Persistent memory at install:
162 bytes more (30,051: c and the refund key's y, 64; the payment's keys, 98). Deselect RAM: none.
The P1 bit: 15 bytes of the load file, nothing in memory. The loads' P2 bit: 31 bytes. The gate on
`GROUP_KEYS`, c sealed and given in the first set-up only, the date 0's refund key as zeros and
`SPEND_ALL_AGAIN` by hash ([D198](#d198)): 192 bytes. `GET_CARD` P1 = 3 one key agreement of the
chip's and one SHA-256 (two scalar multiplications and one SHA-256 sealed to the refund key: 127
bytes of the load file). A new c when an owner is replaced: 33 bytes.

**Built (applet).** `PerPaymentKeyTest` (among them a `SPEND_ALL_BEGIN` without bit 1 refused
with nothing written, whatever it names); every test sends `SPEND_ALL_BEGIN` through one helper,
`spendBegin`, which sets bit 1; every suite that rebuilds a payment's message does it
through one helper, `DateKeys`, which works the keys out from c by the rule; the change vector of
NUT-CCP (`testTheChangeVectorOfNutCcp`) is of a card with a known c.

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSpendAllBegin` | the payment's keys (98 bytes) into `group`, after every refusal | Read only by the payment's own commands, which a tear drops (the payment in hand is RAM), and written again by every `SPEND_ALL_BEGIN` before anything reads them. |
| `CashuApplet` (the constructor) | c's 32 random bytes | Install time: no card exists until install returns. |
| `blindChange` | the opening's nonce (counted now with r: the inventory sees the random number generator's writes) | Before the opening's state byte, as r is ([D183](#d183)). |
| `forgetOwed`, after an owner replaced | the spent places freed (`freeSpent`), the mint's proofs, the staged outputs' count and the openings filled with zeros; the record's refund key and its y, the day's window and count, the no-PIN window's start and count, the day of loads, its count and the change it counted, the clock's last header hash with the rolls (one fill) and the arming filled with zeros; the paid list's round byte and next row put back to 0; the keyset entries nothing names let go (`reclaim`); then `forget`, then the owed mark (one byte, the new PIN owed kept) | After the transaction that made the new owner and set the mark: torn anywhere, the card is the new owner's with the mark still set, and the next command (`process`, a `SELECT` among them) does it all again before anything reads; torn again inside that, the command after it does it all again (`SetUpAndResetTest`, every pair of cuts). Nothing unspent or owed is on the card (`6A8D` otherwise), so nothing of value is freed, and nothing reads the refund key, the counts, the clock's hash or the paid list before they are whole (`checkHeader` reads the time and the bits, never the hash). |

**An owner replaced.** `SET_OWNER` on an owned card is a hand-over. It clears, for privacy and
so that the last owner keeps no key to the next owner's money, what `RESET_CARD` clears, but for
the card's key and its settings (the mint, the unit, the limits, the rate, the allowance, the
budget, the design and the clock's time and hardest bits), which stay.

- **In its one transaction:** the owner's flag, a new c, the settlement record's status, the owed
  mark with `FORGET_HISTORY`, `FORGET_PLACES` and `PIN_OWED`, the anchor, and the key last; 9
  writes and 138 bytes at the most, with a header (8 and 137 before [D201](#d201)'s byte).
- **After it** (`forgetOwed`, here or at the next command, before anything reads):
  - the history and the spent places, as a reset;
  - the record's refund key and its y. Until the next owner's `SET_CARD` (its proof, on an empty
    card) names its own, `GET_CARD` P1 = 3 seals c to the PIN key, to the next owner's grant, and
    a dated piece is refused (`6A8E`). Undated pieces load and pay: their keys name no refund key;
  - the day's counts: the window and what it signed for, the no-PIN window's start and count, the
    day of loads, its count and the change it counted;
  - the paid list (its next row and its round), on every card, a certified one too: the card
    signs only with d + t of its c, so a piece locked to the last c's keys is never signed for
    again whatever the list says (a piece the last owner paid can be loaded, and a payment of it
    is signed under keys its secret does not name, which no mint or reader takes);
  - every keyset entry nothing names (`reclaim`), so a dead entry of the other unit does not keep
    the card in format 5;
  - the clock's last header hash, the rolls and the arming ([D198](#d198)'s history). The
    clock's time, its hardest bits and the roll budget stay, so a later header is taken and an
    older one moves nothing; the rolls begin again as at a `REFRESH`; the no-PIN allowance waits
    for the next owner's arming.
- **The PIN.** `PIN_OWED` makes `VERIFY_PIN` answer `6982` before it looks at the PIN, so nothing
  the PIN alone opens is open: the history (`GET_LOG`, `GET_PROOF` of a spent place, `GET_PIECES`'
  spent places), the date keys (`GROUP_KEYS`), teaching a keyset (`KEYSET_KEYS`), the scope
  (`GET_OUTBOX` P1 = 0), `GET_INFO`'s and `GET_CARD`'s history fields, a payment over the
  allowance, loads, `CLEAR_SPENT` and `LOCK_CARD`. The tap's verified PIN and grant end with the
  replacement. The next owner's `CHANGE_PIN` (its proof over the new PIN) takes the mark down in
  the PIN's own transaction; `RESET_CARD` takes it down with the owner. It survives power cuts and
  every `SELECT`.

**Rejected, for the refund key.** A command that sets only the refund key: `SET_CARD` under the
owner's proof already does it on an empty card, and a new instruction would cost load-file bytes
for nothing `SET_CARD` cannot do. Keeping the last owner's key until the next owner's `SET_CARD`:
c would be sealed to it, and a dated piece loaded first would be refundable by the last owner.
Refusing undated loads until `SET_CARD`: nothing of an undated piece depends on the refund key.

**Built (applet), the hand-over.** `HandOverTest` (the refund key and its y gone, c sealed to the
PIN key, a dated piece refused with nothing written, an undated one loaded and paid, the next
owner's own refund key; the day's counts; the clock's hash, rolls and arming, and a later header
taken after them; the paid list; the dead entry); `SetUpAndResetTest`
(the hand-over torn at each of its 51 writes, and torn twice: after the commit, then inside the
next command's taking down, at each of its writes).

c at a reset and the refund key's y at `SET_CARD` are written in the transactions those commands
already end with, and c when an owner is replaced in `SET_OWNER`'s. The refusal of a
`SPEND_ALL_BEGIN` without bit 1 writes nothing, nor that of a `LOAD_PROOF` or `LOAD_CHANGE` without
P2 bit 1. `GET_CARD` P1 = 3 writes nothing of the card's state: the sixteen bytes it uses up are
RAM, and sealed to the refund key it sets the chip's key object for k, as `LOAD_CHANGE` does.

**Built (applet), the loads' word and the gates.** `LoadWordTest` (a load without P2 bit 1 refused
with nothing written, a piece locked to P never taken, `LOAD_CHANGE` the same), `LinkingTest`
(`GROUP_KEYS` to the PIN or the grant and not to the tap that paid with no PIN; `SPEND_ALL_AGAIN` by
hash and zeros; c sealed, in the first set-up only on a card with no refund key, and to the
refund key at any tap on one with a refund key; a new c when an owner is replaced, and the
replacement only with no change owed; the date 0's refund key as zeros); `StrangerHoldingTheCardTest`
(what a reader with no PIN and no grant learns: the keys of every date on the card from
`SPEND_ALL_BEGIN`, r from `GET_DLEQ`, the no-PIN payments from `SPEND_ALL_AGAIN` P1 = 1, and the
seal's point checks); every test loads through helpers that set P2 bit 1.

## <a id="d198"></a>D198: History behind the PIN: spent places, the clock's last header, the rolls, the arming, the no-PIN window's start and the last payment's scope

**Decided (protocol 3.0, 2026-11-13: privacy in 3.0).** Amends [D194](#d194) and
[D196](#d196).

To a reader that has given neither the PIN nor the owner's grant in its tap:

- `GET_PIECES` P2 = 0 does not list a spent place (it lists the unspent ones, as before), and
  P2 = 2 answers a spent place as an empty one, 82 zeros, as `GET_PROOF` answers it `6A88`.
- `GET_CARD` P1 = 0 says zeros for the last header's hash and the rolls (44 to 76), the arming
  (78) and the no-PIN window's start (83 to 86); the answer keeps its length.
- `GET_OUTBOX` P1 = 0, the last payment's scope (its payment id, generation and hash), is answered
  only in the time in the field that signed the payment or to a reader with the PIN or the grant
  (`6982`), as P1 = 1, the packet, is to the paying tap or the holder's say. The `6982` comes
  before the record is looked at, so a reader not told gets it whether a record is kept or not,
  and learns nothing from it; `6A88` (no record) is said only to a reader that may read that form.
- `SPEND_ALL_AGAIN` P1 = 1 with the PIN not given in this tap (on a card that has one) looks only
  among the signatures given with no PIN, and answers `6A88` for every other hash: a payment under
  the PIN, another card's swap and 32 zeros (an empty receipt) all answer alike, so a reader with
  the mint's list of swaps learns of no payment under the PIN that it is the card's, nor how many
  payments the card has kept. It does learn the card's no-PIN payments among the last sixteen:
  their hashes answer `9000`. A till whose payment was under the PIN asks for it again with the PIN.
- `GROUP_KEYS` ([D197](#d197)) is answered to the PIN or the grant (`6982`): a date's keys held
  against the mint's swaps would tie them to the card.

A hand-over ([D197](#d197)) takes the last header's hash, the rolls and the arming with the rest
of the last owner's history; the clock's time and the hardest header's bits stay. A reset
(`RESET_CARD`) takes them too, with the hardest header's bits; the clock's time stays.

Left open, because a till or a loader needs them: the unspent pieces and their proofs, the
balance, the card key and certificate, the record, the clock (`GET_INFO` 17 to 20), the hardest
header's bits, the allowance and what is counted against it, the tag, the change owed
(`GET_CHANGE`: any reader may write it back, [D183](#d183)), and the true counts of places and the
slots' states ([D196](#d196): a wallet frees spent places by them, and a loader needs the free
count).

**Why.** A spent piece whole is the exact input the mint and the till saw: a stranger holding the
card would read what was paid and, with the mint, which swap. The last header's hash and
the window's start said when the card last paid.

**Rejected.** Gating `GET_CHANGE` to the paying reader or the PIN: it breaks the change written back
by any reader ([D183](#d183)). Hiding the counts: it broke loads and hid nothing ([D196](#d196)).

**Cost accepted.** A stranger still learns how many places are spent and which, the change owed
until it is loaded back, the clock and the allowance; and, with the mint's records, what a till
needs before the PIN gives it ([D197](#d197)'s table): the keys of every date with a piece on the
card, the swap that made each piece on it, and the card's last no-PIN payments. And where fewer than
8 loads are left today, how many ([D200](#d200)): `SPEND_ALL_CHANGE` refuses change past them
(`6A8F`) before any PIN is asked, and the payment, given up, owes nothing; eight or more reads only
as eight or more, so near the day's 300 it tells about how much the holder loaded that day.
`GET_INFO`'s bytes 57 and 58 stay zeros to such a reader, which MUST NOT read them as a number:
they say it was not told, not that no load is left. No writes.

**Built (applet).** `HistoryPrivacyTest` (the listing, the batch, `GET_CARD`, the scope), and the
suites that read spent places or the rolls as a stranger read them with the PIN or from memory;
`LinkingTest` (`SPEND_ALL_AGAIN` by hash without the PIN, `GROUP_KEYS`).


## <a id="d199"></a>D199: The inbox: where money waits for the card, read with no PIN

**Decided (protocol 3.0, 2026-11-13).**

A new command, `INBOX` (`1E`), answers anyone, with no PIN and no grant, 36 bytes:
SHA-256("CashuCard/inbox" ‖ c ‖ W) and W (4 bytes, big-endian), where c is the card's secret
([D197](#d197)) and W = floor(time / 604800) is the week of the card's own clock, the time of the
last block header it took. In order: P1 and P2 are `00` (`6B00`); a locked card answers `6986`,
as every command a lock stops; a card with no holder's record answers `6A8C` (out of its packet,
after a reset, or with a factory record: no holder has its c, and it takes no piece); a card whose
clock has taken no header answers `6985`. It answers whatever else the record holds, a card with
no refund key and a card with no owner too. The command's data is not read: the card answers the
week of its clock and no other. It writes nothing and counts nothing, and works the week out by
the same steps for every time.

**Why.** A till finds what was sent to the card before the holder gives it the PIN: the owner,
who keeps c, works out a week's name and has money waiting under it; the till reads the name from
the card and asks whoever keeps it what waits. The money goes onto the card only by a load with
the PIN (`LOAD_PROOF`), as any load. The PIN stays the holder's.

**What waits MUST be locked to the card, dated, with its refund key.** The name is only an
address: anyone who has it can find what waits, and it is the same to every reader for the whole
week. So knowing the name MUST never be enough to collect, and money the card never collects MUST
come back to the owner. Ecash that waits under a card's name MUST be:

- dated, never undated (never the date 0), and locked (NUT-11) to the card's key for its date D,
  P + t·G, with the card's refund key for D, R + u·G, which the owner works out from P, R and c as
  for any top-up ([D197](#d197)); never to P alone, and never to a key the keeper of the name or a
  till holds;
- of a date D 14 days after the time it is filed (the card's usual date), never less. The owner's
  phone gives no later date, and D is never moved at pickup: pickup stays open until 7 days before
  D, and a till reads back only two weeks. A filing's D is its own, never the date the owner's
  wallet shares among the week's top-ups ([D197](#d197));
- the card's exact proof secret (NUT-CCP's card proofs): its serialization, its tags and their
  order (`locktime`, `refund`, then `sigflag` `SIG_ALL`), as the card rebuilds it from the nonce,
  the date and the date's keys.

Only the card's owner's phone, which keeps c and the refund key's r, files under the name; a till
never files, and nor does anyone else who has the name. The owner files each piece under the name
of every week its pickup window touches (the week it files it in and the week of its day 7: two at
most), so that a reader that moved the card's clock on without reading `INBOX` hides nothing; a
piece found under two names is loaded once (`6A94`).

**Which cards.** The card answers `INBOX` whatever its record holds. A phone MUST NOT file for a
card with no owner (`GET_INFO` byte 16 `00`: no one keeps c and r for it) or with no refund key
(`GET_CARD` bytes 7 to 39 zeros), and reads both before it files. A card with no refund key takes
only undated pieces (`6A8E`), and an undated piece filed for it would be lost if the card were
lost, reset or handed over first. The holder of either loads in person. Refusing `INBOX` on such
cards was weighed and left out: it needs a change to the applet, and no money is lost by the
answer, since no phone files under it.

A keeper may then give what waits to whoever names the inbox: none of them can spend it, and only a
load with the PIN puts it on the card. A lock stops the inbox as it stops loads: the lock is the
owner's word that the card is out of the holder's hands, and a locked card takes no load, so
nothing that waits could go onto it.

**At pickup, a till checks each piece.** The till did not lock the waiting pieces, yet `LOAD_PROOF`
asks for its word that they are locked to the card's keys (P2 bit 1), and the card stores only the
nonce and the date and cannot check the lock. So before it gives that word for a waiting piece, a
till or phone MUST rebuild the piece's secret from the card's keys for its date (`GROUP_KEYS`,
under the PIN given in the tap) and its nonce, and check that it equals the filed secret byte for
byte; check that the piece's keyset is a keyset of the mint `GET_CARD` names, in the card's unit,
and that its DLEQ proof (NUT-12) verifies under that mint's key, never a key the filed token or
the keeper names (`LOAD_PROOF` keeps 8 bytes of the keyset and checks no mint's proof, and under
the PIN gives a new keyset a free entry: a piece of another mint would load, show in the balance,
and burn the real pieces paid with it when the mint refuses the swap); check, by its own time,
that at least 7 days are left before D (pickup closes then, so that the holder's wallet can move
the pieces to a new date before the refund opens); where it is online, ask that mint the piece's
state (NUT-07) and refuse a piece it does not answer `UNSPENT` for; and run a loader's checks
(free places less up to 8 for change, the loads left today, the day's limit, room in the keyset
table). It refuses the piece otherwise, and the piece waits, for a later pickup or until it comes
back to the owner after D.

**What the owner is told, and after D.** At the mint a piece on the card and a piece still waiting
both read `UNSPENT`. So a till that loads waiting pieces SHOULD leave the owner a pickup proof where
it found them, 20 seconds to 5 minutes after the tap at a random moment: k (1), the nonces it
loaded (32 each, in the order loaded), 16 random bytes of its own (rand16) and the card's `AUTH`
answer (80) to m = the first 16 bytes of SHA-256("CashuCard/pickup" ‖ the nonces ‖ rand16), in that
tap (`spec/vectors/pickup.json`). It shows only that the card was in the till's field at a tap
after those nonces were chosen: `AUTH` answers any reader with no PIN over any 16 bytes, so a pickup
proof never shows that anything was loaded. It tells the owner's phone where to look; what is on
the card, the card says (`GET_PROOF` lists the nonces). A picked-up piece reaches the card with 7 to
14 days left before D; the owner's phone moves picked-up pieces to a new date at its next tap with
the card, and nothing gives them a new date at pickup. Every reader, online or not, leaves a dated
piece out of a payment once its D is less than a day after the reader's own time ([D197](#d197),
[D203](#d203)), and an online reader asks the mint the state of every input before the card signs,
so one bad piece never burns good ones. So from a day before D the card pays no piece of that date,
and a day after D (by the network's tip the owner's phone has checked) the owner may take back by
the refund key every piece of it, picked up or not, once its phone has read the card at a tap
after that (and shown its holder which were on it), or at once where the card is lost: a day on
each side, for a reader's clock slow and the owner's fast ([D203](#d203)). A piece taken back while it is on the card is
one the card still shows and no reader pays; the owner's phone frees its place at its next tap, by
a payment of it that it does not take to the mint.

**What is lost, and what is not.** A card lost, broken, reset or handed over before a till picks
up what waits for it strands nothing. The pieces stay locked to the card's date key: after a reset
or a hand-over (each draws a new c) no card signs with it again, and a lost card signs for them only
once they are loaded onto it with its PIN. So no one else can take them before D: not the keeper,
not a till. After D they come back to the refund key, which the owner spends
with r + u, u worked out from the c they were filed under; so the owner keeps that c with r until
every piece filed under it is picked up or taken back. The same holds for a piece no till picks up
before its pickup closes. What the owner loses is the time until D, not the money.

**The week a holder can read.** The card answers the week of its own clock, and anyone holding
the card moves the clock forward with real block headers, which are free (`SET_HEADER` takes them
on a locked card too, and with no PIN). So a holder can read the name of every week from the card's
last header up to now, one header at a time; never a week ahead of real time, since the network
takes no block whose time is more than about two hours ahead (the one exception, a header made far
ahead at the floor's work, is below). A till (or a phone) that looks for waiting money reads `INBOX`
for every week from the later of the card's own week and the week two weeks before now, up to this
week: it gives the card a real header of each week in order and reads `INBOX` after each, so that
money filed in the week before, or at a week's edge (a block's time runs up to about two hours
ahead of a clock, and an hour or more behind), is found; and last it gives the card the newest
header it has. Two weeks cover the 14-day hold with pickup closing at day 7.

**The clock's limits, for the inbox.** The clock takes any header with the floor's work
([D24](#d24)) and moves back only as [D200](#d200) and [D201](#d201) say: to the anchor of an empty
card's reset or hand-over, and in `REFRESH`. One header made for a time far in the future moves the
clock there: from then on the card answers that far week, later real headers change nothing, and a
reset or a hand-over with no anchor keeps it, so the next holder's card answers it too. Tills then
find nothing under the names the card answers, so nothing waiting is picked up; what waits is not
lost by it, and comes back to the owner by the refund key after its date D, as above. The owner
reads the card's week back (W, the last four bytes of `INBOX`'s answer) at its own tap and so sees
it. Where the header was weak (at the floor's work, a quarter of a block's: less than half the work
of the hardest the card has taken), any `REFRESH` with a real header brings the clock back; where it
was not, the owner's `REFRESH` back form does, or the anchor of the empty card's reset or hand-over
([D201](#d201)).

What the same header does to the card's days is [D201](#d201)'s: a weak one begins and ends no day,
so it pauses the days until the `REFRESH`; one that is not weak begins a day that ends only when the
clock passes it by a day (never for a time at or after `FFFEAE80`). Owed change is never stranded:
a payment's change is counted when the payment is signed, and `LOAD_CHANGE` is never refused for the
count ([D200](#d200)). A reader MUST NOT give a card a header more than two hours ahead of its own
clock, and SHOULD give only headers of the best chain it checked itself; a reader told the loads
left makes no more change outputs than they allow, since the card refuses the rest. That binds
honest readers only, since `SET_HEADER` is open to anyone holding the card
([SET_HEADER](../spec/APDU.md#set_header-0x36)).

**What any holder of the card learns.** The name of the week of the card's clock, and so, from
whoever keeps what was sent under it, whether money waits for the card that week and how much;
by walking the clock, the same of each week since the card's last header, and, where a far header
was brought back by `REFRESH` to an older one ([D201](#d201)), of each week from that one. Never the
history, never a week ahead of real time but by a header made far ahead (above), nothing of c or of
a date's keys. A hand-over and a reset draw a new c,
so the last holder's names stop.

**What a keeper of the name learns.** That the card was sent something that week (and how much,
which it keeps), and, from any till that shows it the name, that the name is the card's: it ties
to the card's key P, which any reader reads with no PIN (`GET_PUBKEY`). Ecash locked to a date's
key also shows that key, which the mint sees when the card spends it ([D197](#d197)).

**Rejected.** A name for any week asked: a stranger could list the names of weeks the clock has
not reached. A name under the PIN: a till looks before the holder gives it.

**Built (applet).** `InboxTest` (the owner's derivation, a new week and the old one no longer
answered, no PIN, no write under the tear harness, a hand-over and a reset, a locked card, the
refusals).

---

## <a id="d200"></a>D200: A header far ahead: change counted when it is made, and the owner's anchor brings the clock back on an empty card

**Decided (protocol 3.0, 2026-11-13).** Amends [D20](#d20) (the clock moves only forward),
[D195](#d195) (300 loads a day, `LOAD_CHANGE` among them) and [D199](#d199) (the clock's limits).
*Amended by [D201](#d201): the far clock holds the day's limit too, and where no one can change the
limit the card cannot be emptied by paying ("Why" below); D201 makes a header at the floor's work
begin and end no day, and gives `REFRESH` the way back.*

One header at the floor's work with a time far ahead, which anyone holding the card can give
([D199](#d199)), moves the clock there, and every day the card counts begins at that time and ends
only a day later by the clock: for a time at or after `FFFEAE80`, never. Two rules keep that from
costing money, and give the owner a way back:

- **Change is counted when it is made.** The change outputs a payment makes (`SPEND_ALL_CHANGE`)
  count against the day of loads (300 pieces, [D195](#d195)) in `SPEND_ALL_SIGN`'s commit, the
  transaction that makes their openings owed: an opening is owed exactly when its piece is counted.
  A day of loads that is over begins again at `now` there, as at a load; a payment with no change
  leaves the day of loads as it is. `LOAD_CHANGE` counts nothing and is never refused for the day's
  count; everything else it checks, it checks as before. `SPEND_ALL_CHANGE` refuses change the day
  has no room for, with the change before it in the payment (`6A8F`, last of its checks, the payment
  given up, nothing written), and the last `SPEND_ALL_SIGN` asks again before it signs (`6A8F`, given
  up). So no change is owed that the card cannot load, and owed change is never lost to the count.
- **The owner's anchor brings the clock back on an empty card.** `RESET_CARD` P1 = 0 takes an
  anchor: a block header after the owner's proof and under it, or, in the reset by the PIN of a card
  with no owner, as its data. `SET_OWNER`'s hand-over takes one already. Both want an empty card,
  nothing unspent and no change owed (`6A8D`), and there the anchor, held to `SET_HEADER`'s checks
  (its own work, the floor, a quarter of the hardest taken) before anything is written, becomes the
  clock even where it is older than the card's, with its bits and its hash. The day of loads begins
  again: a hand-over clears it ([D197](#d197)), and a reset now does too, with its new c. A claim's
  anchor, `SET_HEADER` and `REFRESH` move the clock only forward, as before.
- **A day that cannot end is not over.** A window whose end is past what four bytes hold is not
  read as over; the anchor is the way back from it.

**Why.** Counted at the signature: the commit is the one place an opening becomes owed, so the count
and the owing are one transaction, and a tear leaves both or neither. Counted at `SPEND_ALL_CHANGE`,
the count would be a write outside any transaction, and a payment given up after its change (any
reader can begin one and make change with no PIN: the PIN is asked only at `SIGN`) would spend the
day's loads for change never made, a way to stop a card's loads for free. The anchor: the far clock
stops only the days of what the card holds, and the owner can always empty the card (pay its pieces
out, its change loaded first, which the first rule keeps possible). An empty card holds nothing those
days count: a hand-over clears the day's counts, a reset clears the record, and both draw a new c,
so no piece loaded under the far clock is one the card signs for again. The anchor is the owner's
(its proof covers it) or, on a card with no owner, the holder's, under the PIN and the reset's hold;
it carries the floor's work and a quarter of the hardest header's, so the clock goes back only to a
recent real block. The reset's day of loads: [D195](#d195) counts loads so that the paid list goes
round no faster than a little over three days; after a reset no piece loaded before it is one the
card signs for, so the count has nothing of the last c's to guard, and its zeros are written in the
reset's last transaction with the new c (torn before it, the card keeps the old c and its count).
Not over when it cannot end: read as over, every load, payment and refusal at such a clock would
begin a new day, and the day of loads would bound nothing (the paid list gone round in minutes, so a
holder could pay one piece to two readers offline), the day's limit would roll its budget's days at
once, and a run of refusals would never make three.

**Rejected.** Counting change at `SPEND_ALL_CHANGE` (above). Any real header moving the clock back:
a reader would walk it back and forth for new days. A reset that zeroes the clock: the card would
spend a first day on trust, and its clock would be the next reader's to set. Back for a claim's
anchor too: a claim follows a reset, whose anchor does it. A day past four bytes read as over (above).

**Cost accepted.** What remains: a hostile reader with one such header (about 2^77 hashes; one serves
every card) still stops a card's loads, and its change, until the owner empties the card and resets
it or hands it over with an anchor; on a card with no owner, until the holder's reset by the PIN,
and its day's limit stands the same way. A payment the day has no room for makes no change: the
holder pays with pieces that need none, or waits a day. On the day change counted the day before is
loaded, the card may take up to 8 pieces more than 300 (one for each opening), so the paid list still
goes round in a little over three days. One write more in the payment's transaction where change is
made (the change counted byte goes into it: the worst payment 17 writes and 138 bytes, from 17 and
132). A reset with an anchor runs one transaction more (the time, the bits and the hash: 3 writes,
40 bytes). An owner that sets the clock back hands the next holder a clock behind real time, which
the next reader moves on with the newest header, as it does any clock.

**Built (applet).** `roomToLoad` stages the day of loads, its count with the pieces asked and the
change counted (`X_LOADS`, seven bytes as `pinMarks` has them from `PM_LOAD_DAY`), a new day's where
the day is over; `loadOne` asks it for `LOAD_PROOF`'s pieces only; `processSpendAllChange` asks it for
the change before and this one; `processSpendAllSign` asks it before it signs and writes the seven
bytes in its transaction where change was made. `checkHeader` takes `back` (the anchor of a hand-over
or a reset). `FarHeaderTest` (owed change on a frozen card, the run with real loads, the change
refused at `SPEND_ALL_CHANGE` and at `SPEND_ALL_SIGN`, a day begun by change, the owner's reset and
hand-over bringing the clock back, a clock past four bytes, the holder's reset by the PIN, no anchor
taken on a card that holds money, the anchor's checks, nothing else moving the clock back),
`LoadCapTest` (`changeCounts`, `aResetBeginsTheDayAgain`), `TransactionSizeTest` (printed).

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSpendAllSign` | none new | The day of loads, its count and the change counted are one copy in the payment's transaction, with the openings made owed. |
| `loadOne` | none new | As [D195](#d195): the day and the count in one atomic copy before the piece; `LOAD_CHANGE`'s piece writes neither. |
| `processResetCard` | none new | The anchor (the time, the bits, the hash) is a transaction of its own after the record is cleared: torn after it, the card has its owner and c still, and a clock that ends no window sooner (the record's windows are cleared, and the day of loads is as it was). The day of loads goes with `PM_FORGET` in the last transaction. |
| `processSetOwner` | none new | The anchor is in the transaction it was in. |

---

## <a id="d201"></a>D201: A weak header begins and ends no day; REFRESH brings a weak clock back, and the owner's REFRESH any clock

**Decided (protocol 3.0, 2026-11-13).** Amends [D20](#d20) (`REFRESH` moves the clock only
forward), [D186](#d186) (the no-PIN window), [D195](#d195) (the day of loads) and [D200](#d200) (the
way back from a header far ahead).

A header far ahead holds the day's limit as it holds the day of loads ([D200](#d200)). On a card
whose limit no one can change (a card with no owner, past its first set-up; an owned card its owner
has locked), the money above what that day has left could not otherwise be paid out, and the reset
that brings the clock back wants an empty card. Three rules:

- **Weak.** A header is weak when it carries less than half the work of the hardest the card has
  taken (its target over twice that one's; before any, the floor's: *amended by [D203](#d203):
  before any, twice the floor's work, and a weak header is never the hardest*). The card keeps whether the
  header that set its clock was: one byte of the record, written with the clock in every header's
  transaction, kept by a reset with the clock's time, and said as zero by `GET_CARD`. A header at the
  floor's work is weak to any card that has taken the network's (the floor is a quarter of the
  network's work, [D24](#d24)); the network's own are not, its difficulty never having fallen by half.
- **At a weak clock no day ends, and none begins at it.** The day's limit's window, the no-PIN window
  and the day of loads end only by a clock that is not weak. A day begun at a weak clock (an owner's
  new number for the day, a no-PIN payment's window) begins with no clock (0), and the next header
  that is not weak anchors it, as a day begun before any header is. So a far header at the floor's
  work gives no one a day and freezes none: what each day counted stays counted, and the day ends by
  the clock once the clock is back.
- **`REFRESH` brings a weak clock back.** An older header that is not weak, in the owner's `REFRESH`,
  in the holder's `REFRESH` P1 = `01` (the PIN in a held tap, [D189](#d189)) or in a claim's anchor,
  becomes the clock, with its hash, and its bits where they are the hardest. The days stay where they
  were. And the owner may ask more, with the byte `01` after the header, under its proof (the back
  form): the clock goes back to any older header that is not weak, whatever the clock, and the day's
  limit's window, where it began after that header, begins again at it, keeping what it counted. The
  no-PIN window the owner's proof has already ended ([D186](#d186)). The day of loads is never moved
  (*amended by [D203](#d203): the back form brings it back too, with its count*).

**Why.** The card has no time but its headers. A far header with the network's own work is, to the
card, the network's newest block; any rule that lets a holder with no owner begin the day again
under such a clock lets a reader that has been given the PIN begin it again under a real one, at
every tap, and the day's limit is there to stop that reader ([D20](#d20)). What a far header made
by one party lacks is work: it costs a quarter of a block's at the floor, and the network's blocks
carry four times that. So the card judges the clock by the work of the header that set it. A weak
header begins and ends nothing, and the way back from it gives nobody anything: the clock comes back
to a real header, and each day ends by the clock as it would have. Half and not the whole: the
network's difficulty falls at times (by more than a quarter in one adjustment in 2021, by over
two fifths across two), and a card whose clock a real block set must not stop its days. The owner's
back form: the owner of a card that is not locked can move its limit anyway, and begins a day so
([SET_LIMIT](../spec/APDU.md#set_limit-0x34)); on a locked card the owner is the one who locked it.
The form is the owner's word, under its proof; a reader cannot give it, and the holder of a card
with no owner has none. The day of loads is never moved (*the owner's back form moves it, [D203](#d203)*): it bounds how fast the paid list goes round
([D191](#d191), [D195](#d195)); moved back, a reader could take the paid list round and a holder
pay one piece to two readers offline. A clock brought back to an older header only makes the days end
later, except where the owner's back form asks it.

**Rejected.** `REFRESH` beginning the day's windows again at any older real header, the first form of
this fix: a reader given the PIN, on a card with no owner, would walk the day back for a new one at
every tap. With a mark that allows one such day a day: a card idle for a month gives a reader with
the PIN the month's limits at once, and two far headers raise the mark past any real one. A day that
cannot end read as over ([D200](#d200)). A weak header refused: it changes nothing a weak header may
not do, and at a fall of half every card would refuse real headers. An older header raising the
hardest: `SET_HEADER` changes nothing for an older header, and that stays.

**Cost accepted.**

- A far header that is not weak (at least half the work of the hardest header the card has taken:
  twice the floor's, about 2^78 hashes at the floor's difficulty, a bar that falls against the network
  as its difficulty rises, [D204](#d204); one header serves every card) is
  what [D200](#d200) left. On a card with an owner, the owner's back form brings it back. On a card
  with no owner and a day's limit, the money above what that day has left stays on the card until
  the clock passes that time by a day (never, for a time at or after `FFFEAE80`), and its loads stop
  until the empty card's reset. A card whose hardest header is old is weak to less: the bar is half
  its own hardest, not the network's.
- A weak far header pauses the card's days until the `REFRESH`: a day at its limit stays at it. A
  wallet that finds the card's clock later than the newest header it has sends the `REFRESH`.
- Should the network's difficulty ever fall by half, a card's days would stop ending until it rose
  again (an empty card let the ratchet go with `SET_CARD`, which [D203](#d203) ends), as at a fall by three quarters every card
  would stop taking headers ([D24](#d24)). It has not fallen by more than about two fifths.
- Where a `REFRESH` brings a far clock back to an older header, the card answers `INBOX` for the
  weeks from that header again.
- One byte in the record, and one write more in every transaction that takes a header (in jCardSim:
  `SET_HEADER` 4 writes and 41 bytes; the owner's `REFRESH` back form at its worst 6 and 46; a claim
  with a header 7 and 108; the hand-over with a header 9 and 138, from 8 and 137). The payment's
  transaction is as it was (17 writes and 138 bytes at the worst).

**Built (applet).** `checkHeader` takes how a header may move the clock (`HEADER_ON`, `HEADER_LIFT`,
`HEADER_OWNER`, `HEADER_BACK`) and answers what taking it does (`HOW_CLOCK`, `HOW_HARDEST`,
`HOW_WEAK`, `HOW_WINDOWS`); `writeHeader` writes whether the clock is weak, anchors the days begun
with no clock only at a header that is not weak, and brings back the day's window for the back
form; `dayEnded` (the three days' ends) and `beginAtNow` (a day begun at a weak clock begins with
none); `REFRESH`'s back form; `RESET_CARD` keeps the weakness with the clock's time; `GET_CARD`
says it as zero. `WeakClockTest` (a card with no owner and one with an owner, locked and not, paid
to empty past a far header at the floor's work; the owner's back form past one with the network's
work; the day of loads never moved; the holder's `REFRESH` bringing back only a weak clock, and the
cost above pinned; no day ending or beginning at a weak clock; weak and not weak headers; the
weakness through a reset and a claim; no day gained from a weak header again and again),
`TransactionSizeTest` (the back form's transaction), `HistoryPrivacyTest` (`GET_CARD`), the owner's
vectors (the anchored reset and the back form, `spec/vectors/owner.json`).

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `writeHeader` | none new (one more inside its caller's transaction: whether the clock is weak) | The clock, its weakness, the days it anchors or brings back, the hardest bits and the hash are written in the caller's one transaction: all new or all old. |
| `beginAtNow` | none new (a helper inside the payment's commit and `SET_LIMIT`'s transaction) | One atomic copy, the clock or zeros, as the copy it replaces. |
| `processResetCard` | one fill more (the record cleared in three runs, stepping over the clock's time and its weakness) | The fills are the record's, outside any transaction as before; torn between them, the card still has its owner and c, and a clock that ends no day sooner. |
| `processRefresh` | none new | The back form's writes are in `REFRESH`'s one transaction, with the rolls. |

---

## <a id="d202"></a>D202: The card's secret c comes from the owner's words

**Decided (protocol 3.0, 2026-11-13).** Amends [D197](#d197) (c drawn at install, at every reset
and when an owner is replaced) and [D187](#d187) (the claim).

A wallet keeps nothing but its words. A phone restored from them has the refund key's private key r
and the owner key of every card, but not c, which the card drew: with the card in hand it reads c
again (`GET_CARD` P1 = `03`), but a lost card's dated money, which r + u spends after its date, would
need a c that is nowhere. So the owner's phone gives the card a c made from its words when it becomes
the owner, and a card with no owner still draws its own.

- **s, the owner's for one card.** s = HMAC-SHA256(key = the 64-byte BIP-39 seed, message =
  "CashuCard/c" ‖ `00` ‖ P (33, compressed)), P the card's key (`GET_PUBKEY`). It is made as the
  owner key is ([The owner's proof](../spec/APDU.md#the-owners-proof)), under a label of its own: it
  is no BIP-32 path and no key of the wallet's money, its messages or the owner's proofs, and none of
  them is made with this label, so s gives none of them and none of them gives s. Two cards of one
  owner have two s; two owners of one card have two s.
- **c.** c = SHA-256("CashuCard/c" ‖ s ‖ n), n the number of owners' c the card has taken, this one
  with them: four bytes, big-endian, 1 for the first. The card keeps n after c and the refund key's
  y, in lasting memory that nothing clears (a reset, by the owner or by the PIN, and a hand-over keep
  it), and writes it in the transaction that writes c.
- **To the card.** `SET_OWNER` P1 = `01` carries s sealed to the card's PIN key Q, the key a PIN is
  sealed to, which `GET_NONCE` P1 = `01` answers with the card key's signature over it: E (65, a key
  the phone makes for this one message), s XOR block 1 (32), and block 0's first sixteen bytes, block
  i = SHA-256("CashuCard/c" ‖ i (one byte) ‖ the x of e·Q ‖ E [‖ the 32 sealed bytes, for block 0]);
  block 0's first sixteen bytes are the tag. The card
  opens it with Q's private half (q·E = e·Q), refuses one whose tag is not block 0's (`6A80`,
  nothing kept), and keeps s in working
  memory for the `SET_OWNER` that comes next: any other command lets it go. That `SET_OWNER`, a claim
  or a hand-over, ends its value with the first sixteen bytes of SHA-256("CashuCard/c" ‖ s): on a
  hand-over under the last owner's proof, on a claim the same at every asking. `6985` where no s is
  kept, `6A80` where the check is not the kept s's, both before a claim's askings count; then c and n
  are written with the owner's key, in the command's one transaction.
- **As before.** `GET_CARD` P1 = `03` gives c sealed, and only so. A card with no owner keeps the c it
  drew at install or at its last reset. A claim that brings no check keeps the card's c, and a
  hand-over that brings none draws one. `RESET_CARD`, the owner's and the PIN's, draws c: a reset ends
  the ownership, and the next claim brings the next owner's c (the same owner's with a larger n).

**Why.**

- *The count is the card's.* The paid list ([D191](#d191)), the day of loads ([D195](#d195),
  [D200](#d200)) and the hand-over that empties the paid list ([D197](#d197)) rest on one fact: no
  piece the card signed for before a new c is one it signs for again. With c from the words alone, an
  owner that handed the card away and back, or to itself, or reset it and claimed it again, would get
  its old c back, and could load a piece the card had paid and pay it again offline. The card cannot
  tell how a phone made a c, so a counter the phone chose would hold the phone to nothing; the
  card's own n, which only goes up, makes every c it takes one it has not had, whatever a phone
  sends. Four bytes: a chip's lasting memory wears out long before one place is written 2^32 times.
- *A later owner never gets an earlier c*, nor works one out: an earlier c is of another s (other
  words) or of a smaller n, and a c says nothing of its s (a preimage of SHA-256). The last owner
  knows nothing of the next owner's s.
- *Sealed to the PIN key, with no nonce in it.* The card key agrees with no one (it signs; the PIN
  key is the one a sealed command is opened with, [VERIFY_PIN](../spec/APDU.md#verify_pin-0x40)), and the PIN key changes only at a reset, so
  a phone that has seen the card, or been given Q with its signature, has it. The next owner's phone
  makes the envelope where it is: a
  hand-over is the last owner's tap, and the next owner gives its key, its envelope and its check to
  the last owner's phone, which signs. Nothing in it is of one tap: a replayed envelope gives the same
  s, no more than the owner's own, and n has moved on, so a replayed claim or hand-over never sets an
  old c (and it still wants the PIN in its tap, or the last owner's proof over a fresh nonce). A
  listener on the air gets E and s under a block only q or e makes. (In jCardSim the PIN key and the
  card key are one pair, which the simulator draws twice the same; `OwnerCTest` makes them two.)
- *A command of its own.* A command carries at most 255 bytes; a hand-over with its proof (73), the
  key (65) and the anchor (80) is 218, and the envelope is 113. The check, under the proof, ties the
  two: a reader in the tap that sends an envelope of its own has its s refused by the check, and one
  that changes the check has the proof refused.
- *The owner's phone checks.* After the claim or the hand-over the phone reads c (`GET_CARD` P1 =
  `03` under its grant, sealed to its refund key once it names one) and checks that it is
  SHA-256("CashuCard/c" ‖ s ‖ n) for an n from 1 up, which it learns so, s worked out from the
  card's own key (`GET_PUBKEY` at its first tap, never a P it was handed: an envelope made away
  from the card at a hand-over is made from the P the last owner gave). A reader in a claim's tap,
  which has the PIN and can claim the card for itself anyway, could have the card take an envelope
  and a check of its own; so could the last owner's phone at a hand-over, which signs the check
  (and so would know every date key and inbox name of the next owner). The phone then finds no
  n, **MUST NOT** lock dated money to the card's keys or file for it, and resets the card (it is
  the owner) and claims it again.
- *A reset draws.* After a reset the card has no owner: an owner's c would be a c of a card it no
  longer owns, and the next claim, by anyone, brings its own.

**A restored phone.** From the twelve words alone a phone works out the seed, each card's owner key
and its s; with the card's key P and n it has c, every date's keys and, with r, the take-back key r +
u of every date. With the card in hand it reads c, and so n. Without it, it tries n = 1, 2, … for the
pieces it would take back (each names its date's keys, so a wrong n shows at once): n counts every
owner's c the card has taken, all owners together, so a card claimed once has n = 1. To take a piece
back the phone needs the piece itself (its secret and the mint's signature) and P: this decision
gives it c, not those. So the words alone are never enough to take a lost card's money back, and
every text that says what the words restore says so ([APDU.md](../spec/APDU.md#the-owners-proof),
NUT-CCP): a wallet keeps P and the dated pieces where its restore reaches them, which is app design
and not the card's.

**Rejected.** The phone sending c itself, or a counter of its own: the card cannot hold a phone to a
fresh c. c from the words with no count: the same owner gets an old c back (above). The record's
generation (`GET_OUTBOX`) as the count: it moves at a reset and a forgotten PIN as well, so a
restored phone has more to try, and not in a claim's transaction. Sealing under the tap's nonce:
the next owner's phone would have to be in the last owner's tap. Sealing to the card key P: the card
key would agree with readers, which nothing else asks of it. The envelope inside the claim or the
hand-over: past 255 bytes. Keeping `GET_CARD` P1 = `03`'s sealed answer somewhere
backed up: the wallet keeps nothing but its words. A reset taking an owner's c: the reset ends the
ownership. A claim or hand-over refused without a c: the card's own c stays the safe default for a
phone that reads c from the card, as before.

**Cost accepted.**

- Leaked words now give, with each card's key P, its c: every date's keys (with the mint's records,
  every spend since that owner's c, what a reader given the PIN learns) and, with r from the same
  words, the take-back of every dated piece after its date, from anywhere, with no card. The words
  already gave the owner key (the card's PIN, its limits, its reset, and with the card in hand the
  money on it) and r. Before its date a piece is still the card's alone: nobody pays it without the
  card.
- A card's c is no more secret than its owner's words. A phone that gives no c leaves the card's
  own, as before.
- Four bytes of lasting memory (30,056 bytes at install, within the +300 measured). One command more
  in a claim or a hand-over: a key agreement and two SHA-256, and two more in `SET_OWNER` (not yet
  measured on a chip). In jCardSim the claim's transaction, with a header and c, is 9 writes and 144
  bytes at a clock that is not weak and 10 and 148 at its worst (a weak clock, a day's window begun
  with no clock, a harder anchor) (7 and 108 with none), and the hand-over's 12 and 150 at its worst
  (10 and 142 with a header and c at a clock that is not weak); [D203](#d203) takes the hand-over's
  to 9 and 113 at its worst. The payment's, 17 and 138, is unchanged. Working memory: none new (s waits in the room a payment's first output uses,
  and no payment is in hand then).

**Built (applet).** `stageOwnerC` and `cBlock` (`SET_OWNER` P1 = `01`), `processSetOwner` (the check,
c and n), `process` (a kept s let go, and zeroed, by any other command). `OwnerCTest` (the claim and
the hand-over with the owner's c; a phone restored from the words alone, and its take-back key; the
same owner never given an old c, through a hand-over to itself and a reset; a replayed claim; the
kept s for the next `SET_OWNER` only; envelopes that do not open; the check bound to the envelope,
and under the proof; claims and hand-overs with no check as before; the claim and the hand-over torn
at every write; the vector, `spec/vectors/owner-c.json`), `TransactionSizeTest` (both
transactions), `SchnorrHWMathTest` (the four bytes).

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSetOwner` | none new (c on a claim that brings it, and n, inside the command's one transaction) | c, n and the owner's key are written together: all new or all old (`OwnerCTest`, torn at every write). |
| `stageOwnerC` | none (working memory only; the curve check of E uses the room a claim's askings keep their data's hash in, so a new envelope begins the askings again twice over) | Nothing lasting is written: torn, the card has kept nothing, and a `SET_OWNER` with a check answers `6985`. |

---

## <a id="d203"></a>D203: No header lowers the bar: a card with no hardest holds a far header to twice the floor's work; the owner's back form brings back the day of loads; a day's margin around D

**Decided (protocol 3.0, 2026-11-13); three of its choices are recommended and wait for the
keeper's word:** the hardest kept through `SET_CARD` and every reset; no older header raising the
hardest, the bar of a card with none fixed at twice the floor's work instead; and the owner's back
form giving the card a new day of loads each time. Their costs are below. Amends the header ratchet let go at `SET_CARD` and
`RESET_CARD` ([SET_CARD](../spec/APDU.md#set_card-0x32)), [D200](#d200) (the hand-over's anchor), [D201](#d201) (weak headers; the day of loads never moved by
the back form) and [D202](#d202) (what the words give), and [D197](#d197) and [D199](#d199) on taking
dated pieces back after their date.

- **Before any hardest.** A header is weak, to a card that has taken no header that is not weak (a
  fresh card), when it carries less than twice the floor's work: its target over half the floor's.
  That is the bar of a card that holds the network's own block from when the floor was set (the
  floor is a quarter of the network's work then, [D24](#d24)): half its work. With a hardest, the
  bar is half the hardest's work, as before. **A weak header is never the hardest:** a card's
  first hardest is the first header it takes that is not weak.
- **The hardest stays.** `SET_CARD`, and `RESET_CARD` by the owner or by the PIN, with an anchor or
  without, keep the hardest header's bits, as a hand-over keeps them. Nothing lowers them.
- **The owner's back form brings back the day of loads.** In `REFRESH`'s back form the day of loads,
  where it began after the owner's header, begins again at it, keeping its count and the change it
  counted, as the day's limit's window does. Nothing else moves it, but the empty card's anchored
  reset and hand-over, which begin it again ([D200](#d200)).
- **A hand-over's anchor writes the clock alone:** its time, whether it is weak and its bits where
  they are the hardest. The days it would anchor, its hash and the rolls are what the hand-over
  clears after its transaction, so they are not written in it.
- **P1 and P2.** `REFRESH` with a P1 other than `00` and `01`, and `SET_OWNER` with a P2 other than
  `00`, are `6B00`, before anything is read.
- **At set-up (readers).** A wallet reads the card's clock (`GET_INFO`, `GET_CARD`) before it sets the
  card up. A clock more than two hours past the tip it has checked was set by a header far ahead. If
  that header is weak, the claim's anchor or the holder's `REFRESH` brings it back; the card cannot
  say whether it is, so the wallet brings the clock back on the empty card first, with the reset and
  the tip as its anchor: by the PIN on a card with a PIN (a fresh card is given one in a first set-up
  for it, [SET_PIN](../spec/APDU.md#set_pin-0x41)), by the owner's proof on an owned one. Then it sets
  the card up. `cardctl setup` refuses such a card and names that way. (*Amended by [D204](#d204):
  the first set-up's anchor brings the clock back, so no reset comes first, and every set-up gives
  the tip.*)
- **A day's margin around D (readers and the owner).** The card does not read dates; a reader's and
  the owner's phone's clocks are their own. So a reader leaves out of a payment a dated piece whose
  D is less than a day after its own time (D − 86,400 or later), and the owner's phone takes a piece
  back by the refund key only once the network's tip it has checked is a day past D (D + 86,400).
  So the holder's wallet, an honest reader too, ends the move of a date's pieces before D less a day,
  starting it at least the time the move takes before that (a move begun later leaves them on the
  card until the owner takes them back), and a date's first use is at least 8 days and the time to
  move ahead: the week of loads, the readers' day, and the move.

**Why.**

- *Before any hardest.* The bar a header is held to was half the hardest's work, and the floor's
  before any. So on a card that had taken no hardest (a fresh card, and, as `SET_CARD` and the reset
  let the hardest go, every card after its set-up and after a reset with no anchor) a far header at
  the floor's work was not weak, and became the hardest. The set-up's tip, older than that clock,
  moved nothing, the holder's `REFRESH` could not bring back a clock that was not weak, and a card
  with no owner kept its money above a day's limit for good: the case [D201](#d201) accepted at
  half its cost. A second header at the floor's work did the same to a weak clock kept through a
  reset. Twice the floor's work is what a card holding the network's needed then. A weak header
  that became the hardest would set the floor's work as the bar for the next one, which would then
  not be weak.
- *The hardest stays.* `SET_CARD` let it go as a way out for a card whose network had fallen under a
  quarter of its best. `SET_CARD` takes an empty card, so that way out freed no money, and it left
  every set-up with a lower bar. Kept, the bar climbs with the network: half the card's own hardest,
  which only rises.
- *The day of loads.* [D201](#d201) left it where a far header began it, so that a reader could not
  go round the paid list ([D191](#d191)). On an owned card the back form freed the day's limit and
  left the day of loads at the far time: once 300 were counted, loads and change stopped until the
  owner emptied the card and reset it. Brought back to the owner's header with its count, the day
  ends a day after that header, never sooner than a day from when it began, and only at the owner's
  word: a reader cannot ask it, and the holder's `REFRESH` moves no day.
- *The hand-over's anchor.* Its anchor wrote the day's window and the no-PIN window it anchors, the
  hash and the rolls, and the hand-over cleared them all just after: writes in the transaction for
  nothing.
- *The margin.* A reader whose clock is slow pays a piece the owner's phone, whose clock is fast,
  has already taken back: the mint refuses the whole payment (one signature covers every input) and
  the card has burned every piece in it. A day on each side is far more than two honest clocks
  differ by, and a piece's date is weeks away when it is loaded.

**Rejected.** An older header raising the hardest (as [D201](#d201) rejected it): a real block from
before a fall of the network's difficulty, replayed, would raise any card's bar for nothing, and
with the rules above nothing needs it. The hardest kept but none counted as the floor, as before: a
fresh card would still take the floor's far header. The card judging the clock again when the
hardest rises: it would need the bits of the header that set the clock, four bytes more in every
header's transaction, for a case the rules above close. A far clock refused at `SET_CARD` by the card:
the card cannot tell a far clock from a real one.

**Cost accepted.**

- A card whose network falls under a quarter of its hardest takes no header again, and an empty
  one has no way to let the ratchet go: it is a card lost. It takes no header, so its clock never
  passes a day: it pays one day's limit, then nothing until its owner sets a limit (`SET_LIMIT`
  begins a new day); a card with no owner keeps the rest for good. The network's difficulty has never fallen by three quarters, and at
  such a fall the floor would refuse its headers anyway ([D24](#d24)).
- Should the network's difficulty fall under twice the floor's work, a fresh card would take every
  header as weak (its days paused, [D201](#d201)) until it rose again: a fall by half from when the
  floor was set, which it has not had.
- A far header that is not weak still costs what [D201](#d201) says: at least half the work of the
  card's hardest, and before any, twice the floor's. That last bar is fixed: about 2^78 hashes, half
  a block's work when the floor was set, and a smaller part of a block's as the network's difficulty
  rises, so it falls against the network ([D204](#d204) makes every set-up give the card the tip as
  its hardest before it holds anything).
- The owner's back form to an old header gives the card a new day of loads at once: 300 more each
  time the owner sends it (each proof is the owner's, for one nonce), and only at the owner's word,
  as `SET_LIMIT` gives a day's limit.
- In jCardSim: the owner's back form at its worst 7 writes and 50 bytes (6 and 46 before); the
  hand-over at its worst (a weak clock, a day's window begun with no clock, an anchor harder than
  the hardest, the next owner's c) 9 and 113 (12 and 150 before; [D202](#d202) gave 10 and 142, a
  case short of the worst), with an anchor and c at a clock that is not weak 8 and 109; the claim
  at its worst 10 and 148 (D202 gave 9 and 144, the same claim at a clock that is not weak; *11 and
  152 with a no-PIN window begun with no clock, which this count left out, and 12 and 156 with
  [D204](#d204)*); the
  payment's, 17 and 138, as it was. One fill more in `RESET_CARD`, outside its transactions.

**Built (applet).** `checkHeader` (before any hardest, the target doubled against the floor's; a
weak header never the hardest), `writeHeader` (`HOW_BARE`, and the day of loads brought back with
`HOW_WINDOWS`), `processSetOwner` (the hand-over's anchor bare; P2), `processRefresh` (P1),
`processSetCard` and `processResetCard` (the hardest kept). `NoHardestTest` (a fresh card's first
header, weak and not, at the floor and at twice it, and the real network's; a simple card set up
with no header and then given a far header at the floor's work; a fresh card given one before its
set-up; the reset and `SET_CARD` keeping the hardest; a weak clock kept through a reset staying weak
through a set-up and a second such header), `WeakClockTest` (the day of loads brought back by the
back form and by nothing else; an owned card freed by it loading and making change a day later;
`REFRESH` P1), `OwnerCTest` (`SET_OWNER` P2; the last owner's envelope at a hand-over, which the next
owner's check finds), `TransactionSizeTest` (the worst hand-over and claim: a weak clock, a window
begun with no clock, a harder anchor and the owner's c), the owner's vectors (`SET_LIMIT` of 8 and
18 bytes, `SET_OWNER` with the check, 81 and 161).

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processResetCard` | one fill more (the record cleared in four runs, stepping over the hardest's bits, the clock's time and its weakness) | The fills are the record's, outside any transaction as before; torn between them, the card still has its owner and c, and the hardest and the clock as they were. |
| `writeHeader` | none new (the day of loads, inside `REFRESH`'s transaction) | The clock, the day's window and the day of loads it brings back are written in one transaction: all new or all old. |
| `processSetOwner` | none new (fewer writes in its transaction) | The hand-over's anchor writes the clock, its weakness and the hardest in the command's one transaction; what it no longer writes, `forgetOwed` clears after it, here or first at the next command. |

## <a id="d204"></a>D204: The first set-up's anchor: the tip a card is set up with is its clock and its hardest

**Decided (protocol 3.0, 2026-11-14).** Amends [D203](#d203) (a card with no hardest; set-up) and
[D201](#d201) (the claim's anchor).

- **The first set-up's anchor.** In a card's first set-up (the selection of the `SET_PIN` that
  gives a card with no PIN its PIN, [D196](#d196)), while the card holds nothing (no unspent
  piece and no change owed), the header it takes is an anchor as the empty card's reset's is
  ([D200](#d200)): the claim's anchor (`SET_OWNER` on a card with no owner) and `SET_HEADER`. It
  becomes the clock even where the clock is later, and the hardest where it is harder, and the
  day's limit's window and the day of loads, where they began after it, begin again at it with
  what they counted. Outside a first set-up, or on a card that holds a piece, `SET_HEADER` and the
  claim are as before: an older header moves nothing (the claim of a card that holds a piece is
  refused, `6A8D`, as before).
- **Every set-up gives the tip (readers).** A wallet that sets a card up MUST give it, in its
  first set-up and before any load, the newest header of the best chain it has checked: as the
  claim's anchor on a card with an owner, with `SET_HEADER` on one with none. `cardctl setup`
  refuses to run without `--anchor`. The wallet no longer needs the reset before a set-up on a
  card whose clock a header far ahead set: the set-up's anchor brings it back.

**Why.** Round 13 found a card that has never taken a real header frozen by one cheap header. Before
any hardest a header is weak only under twice the floor's work ([D203](#d203)), a bar fixed when the
floor was set: about half a block's work then, and less and less of one as the network's difficulty
rises. Such a header, far ahead, set a clock that was not weak and became the hardest; the set-up's
tip, older, moved nothing and raised nothing; and a header just over the floor's work was then not
weak either. So a card set up with no owner after a stranger's header in its box held its money
above a day's limit for good, and so did one whose stranger's header was within two hours of the
tip (which the set-up's clock check let through), at the next cheap far header. With the anchor, a
card set up by the text has the network's own block as its hardest and its clock before it holds
anything: a far header then costs at least half that block's work, the keeper's option A, and a
header that costs less is weak (its days pause, and `REFRESH` brings them back).

**Rejected.**

- A build-time ceiling on a first header's time (a card with no hardest refusing, or holding weak, a
  header later than its build date and some years): a card that waits in a drawer past the ceiling
  could never take a real header, and an honest card must never be left so.
- The anchor lowering the hardest to its own bits: nothing needs it (the tip is harder than the cheap
  header), and nothing lowers the bar ([D203](#d203)).
- Refusing loads on a card with no hardest: it closes nothing a stranger's header does not open
  (the stranger's header is a hardest), and changes every load path.

**What is left.**

- A far header with at least half the work of the tip a card was set up with, or of a later hardest
  (option A, accepted): on a card with no owner it holds the money above what that day has left.
- A card set up against the text, with no tip, keeps whatever a stranger's header gave it; and a
  card whose stranger's header carried more than twice the tip's work (a far header of the
  network's own work, twice over) is set up at a weak clock whose days wait for a header with half
  that work.
- In jCardSim: the claim's transaction at its worst is 12 writes and 156 bytes (a far clock, the
  day's window and the day of loads begun at it, a no-PIN window begun with no clock, a harder anchor,
  the owner's c), one write of four bytes more than before ([D203](#d203)'s 10 and 148 left out the
  no-PIN window's write: 11 and 152). No set-up by the text reaches that state: the owner's limits
  come after the claim, and nothing is loaded before it. A claim whose transaction a chip cannot hold
  writes nothing (`6A96`), and an empty card is then reset by the PIN and set up again. `SET_HEADER`'s
  transaction as the first set-up's anchor is at most 7 writes and 53 bytes. Not yet run on a chip.

**Built (applet).** `processSetHeader` and `processSetOwner` (the claim) take `firstAnchor`
(`checkHeader` with `HEADER_BACK`, and `HOW_WINDOWS`) in a first set-up of a card that
`holdsNothing`. `FirstAnchorTest` (round 13a's probe: a card that never took a real header; round
13b's: the claim's anchor from a clock that is not weak; a card set up by the text after the cheap
header, with an owner and without, paid down to empty; the cheap header near the tip; what is left;
only the first set-up's, only empty or owed change; a weak first anchor), `AnchorTearTest` (the
first set-up's anchor in `SET_HEADER` and in a claim, and round 13a's hand-over with an anchor, each
torn at every write), `TransactionSizeTest` (the claim with the first set-up's anchor at its worst),
`CashuAppletTest` (the source read: the anchor only in a first set-up of an empty card),
`ClockWalkTest`, `FarHeaderTest` and `NoHardestTest` (a claim's or a set-up's older tip now brings the
clock back). `cardctl setup` wants `--anchor`, and says when the claim's anchor brought a clock back.

| Site | Writes outside a transaction | Why a tear there is safe |
|---|---|---|
| `processSetHeader` | none (the first set-up's anchor in `SET_HEADER`'s one transaction) | The clock, its weakness, the hardest, the window, the day of loads and the hash: all new or all old. |
| `processSetOwner` | none new (the claim's anchor in the command's one transaction) | As above, with the owner's key and c. |

---

## <a id="d205"></a>D205: The wire of D183 to D204 is version 3.0, and a minor never breaks a reader

**Decided (2026-11-14, before the merge).** The applet of [D183](#d183) to [D204](#d204)
answers `SELECT` and `GET_INFO` with `03 00`. Until this entry it was built and tested as
2.3, answering `02 03`; the entries above, the spec, the vectors, the tools and the tracked
file are renumbered, and nothing else on the wire moves. The file's name is
`cashu-javacard-3.0.0.cap`, and the release is `firmware-v3.0.0`.

The rule from here on: **the major is the line a reader holds to.** A reader takes every
minor of a major it was built for, and refuses any other major at `SELECT`, before it sends
a command that moves money. A minor adds to the wire: a new command, a new form of an
answer asked for by a new P1 or P2, a new status word in the range kept for profiles. It
never changes what a reader of an earlier minor of the same major sends or is answered. A
change that does is the next major.

**Why.** Readers already hold to the major. flash-pos (`getInfo`, `PROTOCOL_MAJOR`) and
flash-mobile (`checkVersion`) take any `02 xx` as a card they speak and answer any other
major with "needs an update"; cardctl's `connect` refuses by the major too. To such a
reader a card answering `02 03` is a card it knows, and what follows is the table of
[`spec/APDU.md`](../spec/APDU.md#what-a-22-reader-sees): a payment is refused before
anything burns, but a top-up is swapped to the card key first and then refused by the
card, and an undated top-up so swapped is lost ([D193](#d193), [D197](#d197)). The same
card answering `03 00` is refused by the same reader at `SELECT`, with nothing sent after
it. That holds for every build already on a phone, and for a reader someone else wrote to
the 2.x spec, with no change to any of them.

**Rejected.**

- *Keep 2.3 and have each reader refuse a minor of 3 or more.* It protects only the readers
  that are updated. The builds already installed, and readers this project does not know
  of, keep taking the card as one they speak.
- *Keep 2.3 and say in the spec that a 2.2 reader must check the minor.* The spec of 2.1
  and 2.2 told readers the opposite, "a reader takes any `02 xx` as the shared protocol",
  and readers were built on it.
- *A new AID for the new wire.* A reader would find no applet and could not tell an updated
  card from a blank one or from another product; the version is what the two bytes of
  `SELECT` are for.

**What it costs.**

- The tracked file is a new file. Its source differs from the file of the run of 2026-11-14
  (load file `f216644a…4440`) in the two version constants, and its CAP in those bytes and
  in the package's own version, which the converter writes into the Header component
  (`build.xml`, `version="3.0"`). The size is the same, 36,953 bytes. The new load file's
  sha256 is not on refcheck's `PROVEN` list: by that list's rule a hash goes on it only once
  the chip run that installs that exact file has had real signatures and real change
  verified on the chip. Until that run, the guides say of the tracked file what refcheck
  says of it: it has run only in a simulator. The reports of 2026-11-13 and 2026-11-14 stand
  as they were written, of files that answered `02 03`.
- NUT-CCP's revision is its own number and stays `03` (cashucard/nut#7).
- cardkit stays 0.3.0, not yet released: `CARD_VERSIONS` is 2.1, 2.2 and 3.0, and
  `CARD_VERSION` is `[3, 0]`.
- The Fedimint card's applet is also at 3.0. The two are different applets under different
  AIDs and nothing on the wire meets; in words, say which card.

**The cards.** No card was issued with a file that answers `02 03`. The bench card of the
two runs will be reinstalled with the tracked file for the run that proves it.
