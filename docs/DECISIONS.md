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

*Amended by [D26](#d26) (2.1): only a payment that moves value rolls the day, and
a `SET_LIMIT` without the budget's byte leaves the budget as it is. The text
below is 2.0's.*

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
about 3% more; [D25](#d25)). What this does not
reach: the modular reductions on the same signing path, which still branch on
values derived from the key and the nonce (`reduce512toModN` over e·d,
`addModN` over k + e·d, `reduceModN` over k, the `sub32` and `cmp32` they
call, and `mulSmallByDelta`'s overflow check; listed as open in SECURITY-MODEL item 5, and held to the source by
`SchnorrHWMathTest`): so the signing path as a whole is not free of
secret-dependent branches, and nothing in 2.0 says it is; the chip's own
`KeyAgreement` and RSA engines, which do the point multiply and the field
exponentiations, and whose timing is NXP's; and the JavaCard VM's own timing
of a multiply, which is not specified constant.

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
