# Security model

Threats, controls, residual risks and verification evidence for the card.
Hardware reports identify the tested card, software and commands; simulator
results cover applet logic.

<a id="the-one-guarantee"></a>

## Spending-key authorization

The card-locked payment path requires a signature from the card spending key.

Proofs are P2PK-locked
([NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md)) to a secp256k1 key
generated inside the secure element and never exported. The threat table
describes attacks on the surrounding reader, mint, custody and implementation
boundaries.

## Threat table

| # | Threat | Protected? | Notes |
|---|---|---|---|
| 1 | Passive read of card memory | **Partially** | An attacker gets keyset id, amount, nonce and `C`; the secret string is never stored on the card, but it is reconstructible from the nonce plus the card's key for the piece's date (`SPEND_ALL_BEGIN` answers any reader the t of a date with a piece on the card, before any PIN, 3.0), so treat it as leaked too. What does not leak is the private key, so the proofs stay unspendable. The balance leaks; since 3.0 the spent pieces, the clock's last header, the rolls and the last payment's scope are said only to a reader with the PIN or the owner's grant ([D198](DECISIONS.md#d198)), and how many places are spent still leaks. From software 1.20 a reader also gets the mint's proof for each unspent piece that has one, and so its blinding factor (#16). |
| 2 | Hostile reader spends the card | **Up to the owner's limits** (2.0) | A payment (`SPEND_ALL_SIGN`) needs the PIN given in this tap, or fits the no-PIN allowance; a card with no PIN pays nothing (`6A97`, #22, since 3.0); a failed PIN check ends the session. A blocked card has no allowance, by its state byte or by its counter ([D22](DECISIONS.md#d22)). What leaves the card is held to the daily limit, counted against a clock of Bitcoin block headers, and the window rolls at most the rollover budget's times between the owner's refreshes (#17, [D20](DECISIONS.md#d20)). Until 3.0 a card with no PIN was cash to whoever held it, under the same limits. |
| 3 | Card lost or destroyed | ❌ **By design** | The spending key remains on the lost or destroyed chip. See [D5](DECISIONS.md#d5). |
| 4 | Cloning the chip | **Yes** | Cloning EEPROM copies the proofs but not the key; a clone cannot sign. Cards should be CC EAL 5+ to resist invasive extraction. |
| 5 | Offline double-spend from copied data | ❌ **No** | Offline proof validation leaves its current redemption state unknown to the merchant. See below. |
| 6 | Replaying a signature on another proof | **Yes** | The card signs the NUT-11 `SIG_ALL` message of one payment: every input's secret and `C` and every output. A signature is good for that swap and no other, and the card rebuilds every secret from its own key for the piece's date and the slot, so a reader chooses nothing it signs. `AUTH` signs a tagged hash no secret can equal. There is no command that signs a reader's bytes (0.x's `SIGN_ARBITRARY` is gone, D18). |
| 7 | Malicious mint tagging users | **Yes** | NUT-12 DLEQ, verified client-side. See [D11](DECISIONS.md#d11). |
| 8 | Mint insolvency | **Operator monitoring; solvency trusted** | The mint is trusted for solvency. See below. |
| 9 | Malicious terminal | **Partially** | Cannot forge proofs or spend them elsewhere. Can lie about the amount, or take the tap and never settle; ordinary merchant risk. |
| 10 | Fault injection to recover the key | **Mitigated for a signature that leaves the card; not measured on a chip** | Aux randomness in the nonce prevents the two-signatures-same-`k` recovery ([D9](DECISIONS.md#d9)). That alone does not cover a fault in the signing itself: the key is in RAM and multiplied in software, `AUTH` signs for anyone as often as asked, and a signature with one faulted multiplication, or one flipped bit of the key, gives away a bit or a byte of it. Since 3.0 every signature that leaves the card is verified on the card first, under the key whose x went into its challenge, by the chip's own point arithmetic, and one that fails is not given (`6F00`, [D207](DECISIONS.md#d207)); the waits' signatures, which never leave, are not. What this does not cover: a fault that also defeats the check (two faults in one signature), and leakage by power or timing, which is #19's and unmeasured. No nonce or blinding factor outlasts the call that uses it: the signer's temporary key, and the key agreements given it, are put back to a public number on every way out of the call, a key in RAM is cleared, and the signer's RAM scratch is zeroed after every signature, a refused one too, before the key is put back. The key agreement given the PIN key for a sealed command is put back the same way. A PIN command zeroes the data it brought (the PIN, clear or sealed) on every way out, a refusal before the data is taken included, and a sealed one its shared secret and keystream; `GET_CARD` P1 = 3 zeroes its sealing scalar: RAM a chip keeps until it is next written. |
| 11 | Tear-off (card pulled mid-write) | **Yes, by write order**; not yet on silicon | Every multi-field persistent write commits a single byte last, or is one transaction ([D14](DECISIONS.md#d14)); every write outside a transaction is listed and reviewed in [D23](DECISIONS.md#d23), and a test fails on any new one. A torn `LOAD_PROOF` leaves the slot empty and a torn `CLEAR_SPENT` leaves it spent; neither is counted or signed for. A payment's places are burned by one committed byte (`burnPending`) and marked after it, at the next command if the card left. A torn `CHANGE_PIN` preserves the blocked state (D22). The orders are scanned in the source and the torn states set by hand in jCardSim; no card has been pulled mid-write. |
| 12 | Counterfeit physical cards | **Not a concern** | Value is bound to the chip's key. A look-alike with no valid chip holds nothing. |
| 13 | Supply-chain / pre-personalised cards | **Only as far as a certifier the reader trusts** (3.0) | Nothing a reader can do from outside shows what code a card runs or that its key never left the chip. Since 3.0 a card can carry a certificate for its key ([D192](DECISIONS.md#d192), `CERT_READ`): the card checks only that it names its own key, and the reader checks the certifier's signature over it and `AUTH` under that key in the same tap. A certificate is worth what the certifier behind it is worth ([`CERTIFIER.md`](CERTIFIER.md)); a card with none, or one from a certifier the reader does not know, carries the risks D192 lists, to the holder and to a receiver offline. A card that has never had a PIN (a card in the post) takes a certificate from whoever holds it: one sealed with a signature no reader trusts leaves the card uncertifiable, with its key and its paid list kept through every reset, as a certified card's are. A reader treats a certificate it cannot check as none, and knows the card's key will not change at a reset; an issuer seals before the card leaves its hands. |
| 14 | Hostile reader blocks the PIN (3 unauthenticated APDUs) | **Mitigated by the owner** (2.0); **no block on a card with no owner** (3.0) | On a card with no owner (3.0, [D195](DECISIONS.md#d195)) the PIN never blocks: each wrong try makes the next `VERIFY_PIN` wait twice as long, by the card's own work (2^(w−1) askings of about 0.7 s after w wrong tries in a row, at most about three hours a try), counted before the PIN is compared and kept through power cuts, and the holder's right PIN after the wait opens it; after three wrong tries in a row an empty card takes a new PIN by `SET_PIN` (its numbers kept, its history gone, and no first set-up begun, [D196](DECISIONS.md#d196)). On a card with an owner `VERIFY_PIN` needs no authentication, so three wrong PINs from any reader in range block the card. The owner's phone unblocks it: `CHANGE_PIN` with the owner's proof sets a new PIN with no old one, any state, any funds, and a wrong proof costs no PIN try. A card whose owner has lost their seed cannot be unblocked; its balance is stranded. The same loss strands a card with a daily limit even if its PIN works: without `REFRESH` the window stops rolling after the rollover budget, and only about (budget + 1) daily limits can still be paid (#17, [D20](DECISIONS.md#d20)). An owner key kept only in one phone's Keychain (the architect's fallback for a user with no backed-up seed) is lost with that phone. On a card with no owner, one wrong try by anyone makes the holder's right PIN wait in every tap until it is given once: the wait's askings are counted in the card's memory that a power cut clears, so each tap begins them again, and a reader that does not send `VERIFY_PIN` again on `6A98` (one of 2.2, or one built on the NUT core alone) takes it as a refusal in every tap until a reader that serves the wait gives the right PIN. No money moves. (0.6's PUK is gone with the 0.x wire, D18.) |
| 15 | Reading the NFC tag (software 1.19) | **Static public address only** | Any reader, with no PIN, gets the same bytes from every card: one web address. It names no card, key, owner or balance. A card on factory keys can have the tag's applet replaced by one carrying another address; rotating the card manager keys closes that. See below. |
| 16 | A piece on the card that the mint never made (software 1.20) | **Reader-side verification** | The card keeps the mint's NUT-12 proof for a piece and gives it back; it checks nothing. A reader that checks it, with the mint's keys, sees that a made-up `C` is not real, and a piece copied from another card is not real here. It does not show that a real piece is unspent. Reading the proof gives away `r`, which ties a piece to the request that made it if the mint is given it. See below. |
| 17 | A terminal with the PIN walks the card's clock with real block headers | **Bounded by the rollover budget** (2.0) | Real headers are free, so in 1.20 every header a day later began a new day and a new limit. In 2.0 the window rolls at most the rollover budget's times (default 7) between the owner's `REFRESH`es; past it the day stands. The no-PIN allowance renews only once per arming (an owner's proof, or on a card with no owner a held tap under the PIN; the PIN alone arms nothing since 3.0, [D208](DECISIONS.md#d208)), so a reader with no PIN gets one allowance per arming. [D20](DECISIONS.md#d20). **The cost:** the bound also binds the holder. In 1.20 a holder who lost the owner key could still spend the card down a limit a day; in 2.0, with no owner's proof to refresh the budget, the window stays where it is after the budget's rolls, and a balance over about (budget + 1) daily limits is stranded for good. A card with no daily limit is not affected. |
| 18 | An unowned empty card is set up, or claimed, by the first reader that gives it a PIN | **Accepted for v1** | A card out of its packet has no PIN and holds nothing, so any reader in range can give it a PIN and, in that first set-up, a record, numbers and an owner (3.0, [D196](DECISIONS.md#d196): the first set-up is the selection of the card's first `SET_PIN`, and only a reset begins another). Nothing is lost: the card holds nothing. A card that reaches its holder set up by someone else answers the holder's `SET_PIN` with `6982`; the holder resets it (three wrong tries, `SET_PIN`, a reset by the PIN) unless it was claimed, and a claimed card is reset by its claimant only. A card set up in its holder's hands, by the holder's phone, is that holder's; cards issued by Flash leave the issuer owned or are set up at hand-over. |
| 19 | Timing the card's signatures to learn its key | **Partially**: the arithmetic in bytecode; not measured | `AUTH` gives any reader as many timed signatures as it asks for. The byte-array field multiplies on the nonce and the key, and the modular reductions on the same path, have no secret-dependent branch or loop count ([D21](DECISIONS.md#d21), open item 5): n is taken off by a mask, and k or n − k is chosen by one. The JavaCard VM's own instruction timing, and the chip's EC and RSA engines, which do the point multiply, are NXP's. No timing has been measured on silicon. |
| 20 | A reader with the PIN resets an empty card with no owner and sets it up again | **Accepted** (3.0) | A simple card's numbers are set once ([D196](DECISIONS.md#d196)); its holder's way to change them is a reset by the PIN on an empty card, in a held tap: the history's nine askings and the reset's sixty, about 45 seconds of holding on a chip. Anyone who has the PIN and holds the emptied card that long (a till handed the PIN in an earlier tap, or a stranger who first replaced a forgotten PIN on the empty card) can reset it and set it up again in the same selection, with the holder's PIN and mint and with numbers, a refund key or an owner of its own; the holder's next top-up is then under those, and dated pieces refundable by that refund key. No till takes that long to take a payment. What it leaves shows to a wallet that knows the card: a new secret c, so `GROUP_KEYS` for the next load's date answers other keys than the P + t·G and R + u·G the wallet works out from the P, R and c it keeps; a new card key unless the card is certified; no history. The holder's phone makes that check before a top-up ([D197](DECISIONS.md#d197)). A guest wallet that has never seen the card cannot tell. |
| 21 | The mint links every spend of a card to one key | **Partially** (3.0, keys per load) | Until 3.0 every piece named the card key, so the mint (and whoever it told) could list a card's spends for its life. Since 3.0 a piece is locked to the card's key for its date, P + t·G, with t from a secret c the card keeps, drawn by it or made from its owner's words ([D197](DECISIONS.md#d197), [D202](DECISIONS.md#d202)): the mint sees one key for the spends of one date and nothing that ties two dates, or a date to the card. Top-ups share one date for 7 days, so a date is a week's loads. The date is not hidden from the mint: a dated piece's secret carries its locktime D, which the mint reads when the piece is spent, and a wallet that always sets D the same time ahead of a week's first load (or an inbox piece's 14 days from its filing) tells the mint about when that week's pieces were minted, so the mint can set a date's spends beside the swaps and mints it served around then. A wallet that wants less of this varies how far ahead it sets D, within the rules of [Keys per load](../spec/APDU.md#keys-per-load). What still links: a till that was paid knows its date's t and, with the mint, ties that date's spends to the card; a reader given the PIN (a loader, or a till handed it) can ask the keys of any date (`GROUP_KEYS`) and, with the mint's list of swaps, tie them to the card. A stranger holding the card, with no PIN and no grant, gets what a till needs before the PIN: the keys of every date with a piece on the card (`SPEND_ALL_BEGIN`, given up unsigned), the blinding factor r of every piece on it (`GET_DLEQ`, so C + r·K, the blind signature the mint issued), and the card's no-PIN payments among the last sixteen (`SPEND_ALL_AGAIN` P1 = 1 answers `9000` for their hashes); with the mint's records it ties every spend of those dates (a week's loads, every undated spend), the swaps that made the pieces on the card and those no-PIN payments to the card. It does not get the keys of dates no longer on the card, c, or which payments under the PIN were the card's. This is the limit of the card's privacy against someone holding it. Amounts, times and keyset ids remain patterns; undated pieces are one date for the card's life, so a card with no refund key (undated pieces only) gains nothing; c leaking ties a card's dates together (it moves no money), and c leaves the card only sealed (to the refund key, or on a card with none to the PIN key in the first set-up, whose reader can open it); a reset and an owner replaced draw a new c. Ecash locked to the card key P itself is never the card's to spend: nobody may lock to P. |
| 22 | A reader loads or pays a card with no PIN, or loads under the owner's grant alone | **Yes** (3.0, PIN before money) | A card with no PIN refuses every load, payment, claim and change command with `6A97`; every `LOAD_PROOF` and `CLEAR_SPENT` wants the PIN given in that tap, and the owner's grant opens no load (`ALLOW_LOAD` answers `6200`) ([D185](DECISIONS.md#d185)). A load above the day's limit is refused, so nothing goes on that no payment could take off ([D196](DECISIONS.md#d196)). |
| 23 | A reader with the PIN for one tap claims the card as its owner | **Bounded** (3.0, the owner claimed slowly) | A claim is made only in the card's first set-up, on an empty card, under the PIN, and only by the same `SET_OWNER` asked six times in a row with a signature's work before each of the first five (some three seconds on a chip); after a claim, no payment is signed in that time in the field ([D187](DECISIONS.md#d187)). An owned card's owner is replaced only by the old owner's proof, with nothing unspent and no change owed. A replacement is a hand-over: it gives the card a new c, the next owner's from its words or one the card draws; it clears the history as a reset does (the log, the receipts, the kept signatures, the settlement record, the spent places and their kept proofs), and the day's counts, the clock's last header hash, the rolls and the arming, the paid list and every keyset entry nothing names; it lets the record's refund key go, so c is never sealed to the last owner's key and no dated piece is taken until the new owner names its own with `SET_CARD`; and the PIN, which the last owner knows, opens nothing (`VERIFY_PIN` answers `6982`) until the new owner sets one of its own with `CHANGE_PIN`. So neither owner can tie the other's spends to the card, and the last owner holds no refund key to the new owner's money ([D197](DECISIONS.md#d197)). |
| 24 | A reader binds the card's own change to a key that is not the mint's | **Yes, by the keyset's ID; the PIN guards the teaching** (3.0, keyset keys) | A change output is made only in a keyset whose keys the card was taught under the PIN, checked against the keyset's ID; `LOAD_CHANGE` writes a piece only under a key shown to be one of them, and checks the mint's DLEQ proof before it unblinds ([D183](DECISIONS.md#d183), [D190](DECISIONS.md#d190)). The card cannot tell a mint's keyset from keys the holder made up; a reader that has the PIN can already pay up to the card's limits. An opening bound to a wrong key stays owed: the holder binds it to the mint's key, or gives it up. |
| 25 | The holder, or a reader with the PIN, loads a piece the card has signed for and pays it twice offline | **Slowed, not stopped** (3.0, the paid list) | The card keeps the first 8 bytes of the nonce of each of the last 1,024 pieces it signed for and refuses to load them again (`6A94`), and loads at most 300 pieces a day by its own clock, so flushing the list takes a little over three days of the card's clock ([D191](DECISIONS.md#d191), [D195](DECISIONS.md#d195)). An offline reader still checks each piece's DLEQ proof, refuses a dated piece past its locktime, and posts the swap first (#5). |
| 26 | A payment in the card's other unit escapes its limits | **Yes, by the holder's rate** (3.0, two units on one card) | A payment in the other unit than the card's is counted against every limit at the one rate the holder's phone writes (rounded up), and is refused (`6A99`) on a card with a limit set and no rate; a till never writes the rate, and a payment in the other unit is begun only for a reader that says it reads units ([D184](DECISIONS.md#d184)). A rate that is old counts a payment at an old price: the holder's phone writes it at every visit and never raises it from an old price. |
| 27 | A stranger holding the card reads where money waits for it | **Accepted** (3.0, the inbox) | `INBOX` answers anyone, with no PIN, on a card that is not locked, an inbox name: SHA-256("CashuCard/inbox" ‖ c ‖ W), W the week of the card's own clock, so that a till can find what was sent to the card before the holder gives the PIN ([D199](DECISIONS.md#d199)). The card answers the week of its clock, and anyone holding it moves the clock forward with real block headers, which are free (row 17): so a holder reads the name of every week from the card's last header up to now, never a week ahead of real time, and learns whether money waited for the card in those weeks and how much. The name is only an address, the same to every reader for the week: what waits under it MUST be dated and locked to a key only the card signs for (its key for a date D, P + t·G, with its refund key for D, as the owner works them out from c; D 14 days after it is filed), so knowing the name never lets anyone collect, the money goes onto the card only by a load with the PIN, after the till has rebuilt each piece's secret from the card's keys, checked that its keyset is of the card's own mint and unit and its DLEQ proof holds under that mint's key, and, online, asked the mint its state, and what no till picks up (the card lost, reset or handed over first) comes back to the owner by the refund key after D. The card answers `INBOX` whatever its record holds; no phone files for a card with no owner or no refund key, whose holder loads in person. A keeper of the name learns that the card was sent something that week, and ties the name to the card's key P, which any reader reads. A locked card answers `6986`. No history, nothing of c or of a date's keys. The card writes nothing for it. A hand-over and a reset draw a new c and so new names. One header with a far-future time stops the clock there, and so the inbox, until the clock is brought back: by `REFRESH` where the header was weak (at the floor's work), by the owner's `REFRESH` back form, or by the anchor of the empty card's reset or hand-over ([D199](DECISIONS.md#d199), [D200](DECISIONS.md#d200), [D201](DECISIONS.md#d201)). |
| 28 | The owner's words leak | **Accepted** (3.0, the owner's c) | The words give the owner key of every card they own (its PIN, its limits, its reset, and with the card in hand the money on it) and the refund key's private key r. A card can take its c from its owner's words at the claim or the hand-over ([D202](DECISIONS.md#d202)), so that a phone restored from them has c with no card; to take back a lost card's dated money it also needs the card's key P and the pieces (their secrets and the mint's signatures), which the words do not give. The words then also give that card's c, with its key P: the keys of every date (with the mint's records, every spend of the card since it took that c, as a reader given the PIN learns) and, with r, the take-back of every dated piece after its date, from anywhere, with no card. Before its date a piece is the card's alone: no one pays it without the card. A c the card drew (a claim or hand-over that gives none) is not in the words. The card makes each owner's c new with a count of its own, so the same words never give an old c again, and the last owner's words give nothing of the next owner's. |
| 29 | Someone who holds a card before its first PIN seals a certificate no certifier wrote | **Accepted; the wallet tells the holder** (3.0) | `CERT_WRITE` asks for no proof: on a card that has never had a PIN, has no owner and holds nothing, anyone writes and seals a container that names the card's key ([D192](DECISIONS.md#d192), [D209](DECISIONS.md#d209)). No reader believes such a certificate, so it vouches for nothing. What it does is the certificate's other effect: the card keeps its key and its paid list through every reset, so it is the same card to every reader under every later holder, and its maker can no longer certify it. A card that left its maker certified is not open to this (a sealed certificate is never written again), and one sold blank is open to it until its first `SET_PIN`: a courier, a reseller. The wallet's part: it reads `CERT_READ` P1 = `FF` before the first `SET_PIN` and tells the holder of a sealed certificate it does not believe. Not closed on the card: a proof of who writes would be a GlobalPlatform secure channel or an issuer's key given at install, each a change to what the chip is asked to install, left for a release that can try it on chips. |

## The offline double-spend problem (#5)

The card commits a proof's `SPENT` state before releasing its payment signature.
The mint separately tracks redemption. An offline terminal can validate a signed
payment but must contact the mint to establish that it remains redeemable.

An attacker who obtains a valid signed payment can submit it to the mint before
the offline merchant settles. The mint accepts the first valid redemption and
rejects the second. This leaves settlement risk with the offline merchant.

Practical mitigations:

- The **mint rejects repeat redemption**.
- **Terminals should settle promptly** on regaining connectivity. Settlement lag
  is exactly the exposure window.
- **Online terminals must call `checkProofStates`** before accepting. There is
  no excuse when connectivity exists, and `cashu-client` treats `PENDING` as
  not-spendable for the same reason.
- **Keep card balances small.** The loss ceiling is the card balance.

Any claim that this design has "zero double-spend risk" is false. One external
documentation contribution asserted exactly that, which is part of why this
document exists.

## Mint solvency (#8)

A bearer proof is a claim on the mint. If the mint cannot honour it, the proof
is worthless regardless of how sound the cryptography is.

Historical incident: Flash Forge was found **insolvent**, roughly
$831 of outstanding bearer promises against $0.13 of backing, because the
Lightning backends had been drained while the ecash stayed in circulation.

Current controls:

- **[Public reserves attestation](https://forge.flashapp.me/reserves)**, refreshed
  every 15 minutes, comparing outstanding liability against real backend balances.
- **Automated solvency monitoring** with alerting, per unit.
- The mint's sat reserve is a **self-hosted phoenixd node** rather than a
  third-party custodial account.

This is an **operator attestation**. Independent proof of reserves remains
an open item. A holder cannot cryptographically verify it. Signed attestations from
the reserve wallets would be the next step.

## The PIN, the owner, and the blocked PIN (#2, #14)

**2.0's rule: the PIN spends, and the owner administers** (`FOXY-CARD-SPEC.md`
5.3 rule 7, [D18](DECISIONS.md#d18)). A payment is asked its PIN at the
signature (`SPEND_ALL_SIGN`), because what leaves the card
is only known there. A card with a PIN signs without it only up to the no-PIN
allowance the owner has set, and answers `6A94` over it, for the whole payment. A
card with no PIN signs under its daily limit and its limit on one payment, and is
cash to whoever holds it. The PIN is asked before the limits, so a reader with no
PIN cannot fill the card's log. `FOXY-CARD-DAILY-LIMIT.md` 6f has the whole.

Everything else is the owner's: changing the PIN, the limits, the record or the
owner, adding funds with no PIN, refreshing the card, locking or resetting it. Each
needs an ECDSA proof by the owner's P-256 key over a label, a fresh nonce and the
value, which only the holder's phone can make. A terminal that has been handed the
PIN cannot set a PIN of its own, change a limit, or take the card over by emptying
it: a card with an owner is its owner's, empty or not.

**A blocked PIN is the owner's to unblock (#14).** On a card with no owner nothing
blocks (3.0, [D195](DECISIONS.md#d195)): wrong tries make the next try wait, doubling,
and the holder's right PIN opens the card after the wait. On a card with an owner,
three wrong PINs, from any reader in range, block the card; every PIN gate then refuses, and the card has no no-PIN
allowance. The owner's `CHANGE_PIN` sets a new PIN with no old one, which unblocks
it. The PIN state byte is the PIN's commit: a `CHANGE_PIN` torn between the PIN and
the byte leaves the card blocked, and the owner sends it again
([D22](DECISIONS.md#d22)). A card whose owner has lost the seed cannot be
unblocked, and its balance is stranded: nothing but the card key signs for its
pieces, and their dated refund path is switched off in the apps for now
(`FOXY-CARD-SPEC.md` 6).

**The ENG-615 lesson holds.** 0.x builds before 0.3 gated with `pinState == 1`, so
a blocked PIN *removed* the gate; and a failed check left a verified session
verified. 2.0 gates whenever a PIN exists in any state, refuses state 2 even under
a verified flag, and a failed check ends the session. Foxy's suite walks every gated
command through every PIN state.

**0.x cards.** A card on the 0.x applet (`SELECT` answers `00 0X` under
`D2 76 00 00 85 01 02`) does not answer the 2.0 AID; both apps show "This card
needs an update" and neither spends from it. Its balance is swept with the 0.x app
releases before it is reinstalled ([`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md)).
The 0.x threats (`SIGN_ARBITRARY`, the reader-chosen `SPEND_PROOF` message, the
PUK's custody) end with the 0.x wire.

## The NFC tag (#15, software 1.19)

From software 1.19 the card also answers as an NFC Forum Type 4 Tag carrying one web
address, so that a phone with its screen on offers to open it (`FOXY-CARD-SPEC.md` 5.8).

**Public tag contents.** The two files a reader can read are constants of
the applet, the same on every card (the capability container, and a message of 22 bytes
whose address is `https://getfoxy.io/card`). Nothing of the card's key, its owner, its PIN
state, its limits or its balance is in them or can be reached through them: the tag applet
holds no reference to the card's applet, keeps no state but the file chosen, and writes
nothing (every instruction that writes is `6982`). It asks the card's applet one question,
whether the tag is on, through a shareable interface of one method that answers a boolean
and is not exported to any other package. The address could not be per card without
becoming an identifier that anyone with a phone could read with no PIN; that is why it is
not, and a change that made it so would be a regression of this property.

What a reader does learn is that the card has a tag application and that its address is
Foxy's page: it is a card made for Foxy. Its other name, the card applet's, can be selected
by anyone as well and answers its version, so this adds little.

**Who holds the switch.** The owner, by the owner's proof under its own label
(`FoxyCard/tag`), with no PIN. A terminal that has been handed the PIN cannot turn the tag
off or on, and a wrong proof costs no PIN try. A locked card refuses the command, so a
locked card's tag stays as it was. `RESET_CARD` puts the tag back on. The switch is not a
security control for the money: it exists so that a card kept in a phone's wallet case does
not raise the offer every time the screen wakes. Off, the tag application refuses its
name, and nothing else about the card changes.

**A card left on factory keys.** Anyone with a reader and a card on factory keys can delete
the card's applet and the money with it (`FOXY-CARD-SPEC.md` 5.4). They can equally delete
the tag's applet and install another in its place, under the same name, carrying another
address, so that a phone that reads the card is sent somewhere else. Rotating the card
manager keys (or locking the issuer domain) closes both, and it is part of set-up for the
cards that are given to people.

## The mint's proof kept with each piece (#16, software 1.20)

From software 1.20 the card keeps, for a piece that is loaded with one, the mint's NUT-12
proof: `e`, `s` and the blinding factor `r`, 96 bytes. `GET_DLEQ` gives it back, with no
PIN, for an unspent piece (`FOXY-CARD-SPEC.md` 5.9, [D17](DECISIONS.md#d17)).

**What "real" rests on.** A phone that reads a piece and its proof can rebuild the piece's
secret, work out `C'` and `B'`, and check the proof against the mint's public key for the
amount. A piece that passes was signed by that key, over that secret. So "this piece is
real" rests on two things the reader has: the mint's keys, and the check it makes. It does
not rest on the card, which checks nothing and hands back what it was given, and it does not
rest on whoever loaded the card. A terminal that writes a piece with a made-up `C`, and any
proof it likes, makes a piece that fails the check: nobody without the mint's key can make a
proof that passes. A real piece copied from another card fails too, since its secret names
that card's key.

**What it does not show.**

- That the piece is unspent. Only the mint knows, and a copy of a real piece passes the
  check as the real piece does (#5).
- That the mint will honour it (#8).
- That a piece with no proof is fake. A piece put on plain, or a card of earlier software,
  is "not shown real", and the reader decides what that means to it.
- Anything, to a reader that does not check. The card does not refuse a piece whose proof
  fails or is missing, and a terminal with the PIN can still write a piece the mint will
  refuse (`FOXY-CARD-SPEC.md` 10). What changed is that a reader can now tell.

**What it costs: `r`.** The proof carries the blinding factor. The mint made its signature for
`B'`, and given `r`, whoever has the mint's record of that issue can recompute `B'` and `C'`
from the piece and tie the piece to the request that made it. That is so of any NUT-12 token
that carries `r`; here, any reader can read `r` for every unspent piece that has a proof,
with no PIN, as `GET_CHANGE` already gives it for the change the card made for itself. A
reader that hands `r` to the mint lets the mint make the tie; one that checks on its own
side and sends the proof nowhere does not. The money is as safe as it was: a piece is
spent only with the card's signature, and nothing here gives that.

**The store.** One persistent array of 12,288 bytes, reserved by the first `SET_CARD` and
not at install, because the chip will not install an applet that asks for that much more in
its constructor (`FOXY-CARD-HARDWARE.md`). A card that is refused it works without. A place
that is unspent holds its own proof or zeros and never another piece's: `LOAD_PROOF` writes
the record before the place's data and the status byte last, `CLEAR_SPENT` and the payment
commands write nothing to the store, and `RESET_CARD` zeros it. A card taken away in a load
leaves an empty place with a record beside it, which nothing serves.

<a id="what-has-and-has-not-been-tested"></a>

## Verification coverage

**Verified in simulation (jCardSim) and by construction:**
- BIP-340 signatures verify against an independent verifier and the spec's own vectors
- Modular arithmetic matches `BigInteger` across random and edge inputs
- Slot lifecycle, PIN gating, APDU encodings
- The tag (1.19), byte for byte, the switch and its refusals, and that nothing the tag
  says differs between two cards
- The mint's proof kept with a piece (1.20): given back as it was loaded, never served for
  a spent, empty or plain place, and never another piece's through any long history of
  loads, payments and clears; every refusal of the load with nothing written; no payment
  command writing the store; the store null after install and made by the first
  `SET_CARD`; the order of the writes and the torn states. A reader's check of the proof is
  not the card's and is tested where the reader is
- The blocked PIN: every gated command refuses, before and after further PIN
  attempts, and a failed PIN check ends the session; the owner's `CHANGE_PIN`
  unblocks; a torn `CHANGE_PIN` stays blocked (2.0, D22)
- The clock walk (2.0, D20): along real mainnet headers, a terminal with the PIN
  gets the found day and the rollover budget's days and no more; `REFRESH` fills the
  budget; the no-PIN allowance renews once per arming; an anchored owner's clock is
  never 0; a payment that moves no value rolls nothing, and a `SET_LIMIT` without
  the budget's byte leaves the budget (2.1, D26)
- The field multiplies against `BigInteger` on operands full of zero bytes, and a
  source scan for secret-dependent branches in the two multiplies (2.0, D21), and
  the reductions on the same path (3.0, item 5), held to the source by a scan
- A `SIG_ALL` payment through the bridge, with the card's own change, swapped at a
  Nutshell 0.20.3 mint, with the mint's DLEQ checked from what the card keeps (CI),
  once on forge's keyset shape (an 8-byte id, no fee) and once on a v2 keyset (a
  33-byte id, a fee of 100), each length asserted
- DLEQ verification, including the tagging attack it exists to catch
- NUT-11 witness checks: wrong key, wrong proof, corrupted signature, `n_sigs`

**Run on silicon** (NXP JCOP4 J3R180, 2026-09-22/23, recorded in the
[hardware report](reports/HARDWARE_TEST_REPORT_2026-09-22.j3r180.md); applet 0.1, then
0.2 for the D13 probes):
- `cardctl selftest`: card signatures verify under BIP-340, and two signatures
  over the same message use different nonces
- Load, spend, swap and NUT-05 melt against the project mint, and a spend from
  the merchant terminal
- `SET_PIN`, `VERIFY_PIN` (wrong, then right) and `CHANGE_PIN` with the right
  current PIN
- The unverified-session gate: `LOAD_PROOF` and `CLEAR_SPENT` refuse on 0.1,
  `SPEND_PROOF` refuses on 0.2
- The tag (1.19): installed under the NFC Forum's name beside the card's applet,
  read from outside as a phone reads it, and read by a phone, which offered its
  address
- The mint's proof (1.20): the build installs, the first `SET_CARD` is given the
  store after the install, a piece loaded with a proof gives the same 96 bytes
  back, a plain piece and a place used again read `00`, a payment and a reset go
  through, and `GET_INFO` is the length it was (`tools/chip/proofstore.sh`, 27
  checks). Not run there: a card pulled away during the first `SET_CARD` or a
  load with a proof, and the time a phone takes to load one piece a command

**Run on silicon, as 2.3, the source before [D200](DECISIONS.md#d200) and before the renumbering** (the bench J3R180, 2026-11-13,
through a contact reader, at a FakeWallet test mint; the run is recorded in
[`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md)): the build's load file before
[D200](DECISIONS.md#d200) (35,466 bytes, sha256 `48b8597c…`) installs in three steps and answers `02 03`;
`selftest` 20 of 20; the first set-up in one selection, its `SET_CARD` passing the
framing check (seventeen engine calls) and the claim's six askings; loads under the PIN
with the mint's proof; `KEYSET_KEYS`; a payment with the card's own change, signed
after the floor's wait, the signature good under the date key P + t·G and not under P,
and taken by the mint; the change written back by `LOAD_CHANGE` in a later tap with no
PIN, and two of those pieces paid again and taken by the mint; `GROUP_KEYS` and `INBOX`
held to the owner's own derivation from c; a sealed `VERIFY_PIN`; the signer's
temporary key in RAM (by a test-only build that reports it); an emptied card
reinstalled and set up again; and a card with a refund key: c sealed to R and opened
with r, dated pieces (`locktime` D, `refund` R + u·G) loaded, paid under the date key
of D and taken by the mint, their dated change written back and paid again, and
`GROUP_KEYS` for D held to the owner's own derivation. Not run there: money taken
back after D by the refund key at a mint, tears, the certificate, the paid list
full, the reset by the PIN, the PIN's waits, the held history, `LOCK_CARD`, a second
unit, a production mint, and a phone ([the hardware
report](reports/HARDWARE_TEST_REPORT_2026-11-13_J3R180_2.3.md)).

**Run on silicon, 2026-11-14** (the same card, reader and mint; [the hardware
report](reports/HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md)): the file with D200 to
[D204](DECISIONS.md#d204), numbered 2.3 then (load file `f216644a…`, answering `02 03`),
installs in three steps, three times; `selftest` 20 of 20, and 21 of 21 with the PIN
after; the first set-up's anchor; the owner's c read back at a claim and at a hand-over
to a second seed, and the take-back key r + u for a date matching the card's refund key
for it; dated and undated payments with the card's own change, taken by the mint, the
change written back with no PIN and paid again, and a payment with eight change outputs;
the day of loads; the clock brought back by the reset by the PIN, the owner's reset, a
hand-over and `REFRESH`'s back form, each refused while a piece was on the card;
`SET_OWNER` P2 `55` and `REFRESH` P1 `02` answering `6B00`; the hardest kept through
`set-card` and the owner's reset. Not run there: `LOCK_CARD`, money taken back after D
by the refund key, a header far ahead or a weak clock, tears, the certificate, the paid
list full, the PIN's waits, a dollar card or a card of two units, a production mint, and
a phone.

The tracked file is built from that file's source with the version moved to 3.0
([D205](DECISIONS.md#d205)) and [D206](DECISIONS.md#d206) to [D210](DECISIONS.md#d210)
added (37,413 bytes, a size no chip has been given). It is not yet tried on a chip, and
the run is to be repeated on it.

An earlier card, a J3R452 on applet 0.1, ran the read and sign path on
2026-09-01 ([its report](reports/HARDWARE_TEST_REPORT_2026-09-01.j3r452.md)).

**Not yet run on silicon:**
- The tag's switch (1.19): `SET_TAG` on a card, and with it the shareable lookup
  between two applets of one package
- A blocked PIN on any build: neither ENG-615 nor its 0.3 fix (the
  blocked-state gate and the failed-check session rule) has run on a card
- Anything on the tracked 3.0 file: no card has installed it ([D205](DECISIONS.md#d205));
  the runs above were of earlier sources numbered 2.3, without [D206](DECISIONS.md#d206)
  to [D210](DECISIONS.md#d210)
- The commands and paths the runs above did not reach: the certificate
  (`CERT_WRITE`, `CERT_READ`, the reset that keeps a certified card's key), the
  paid list full, the PIN's waits on a card with no owner, the held history, a
  dollar card and a card of two units
- A dated piece taken back after its date D by the refund key, r + u, at a mint
- A header far ahead, a weak header (among them one before any hardest,
  [D203](DECISIONS.md#d203)) and a weak clock brought back by `REFRESH`: no real header
  makes one
- The rollover budget on a card
- `LOCK_CARD`, deliberately not run on a card holding value
- EEPROM wear and lifetime. One cell group any reader can wear: where the chip
  gives the signer's temporary key only as a persistent key (it asks for one
  in RAM first), every signature writes that key twice, the nonce and then a
  public number over it. `AUTH` signs with no PIN, so a reader that asks
  without stop wears that key at two writes a signature; at an assumed
  500,000 write cycles and 626 ms a signature (`AUTH` on the bench J3R180,
  2026-11-13) that is some 43 hours of continuous asking, against about 87 with
  one write. A worn key signs no
  more: the undated pieces on the card are lost, and the dated ones wait for
  their refund date (a refund the apps keep switched off for now). Accepted: a limit
  on `AUTH` would change what the card answers. A key in RAM is not worn.
- A card pulled mid-write: the slot write order ([D14](DECISIONS.md#d14)) is
  scanned in the source and its torn states tested in jCardSim, but no card
  has been torn on purpose; power glitches short of a clean tear are
  unanalysed
- Timing/side-channel characteristics of the hand-rolled modular arithmetic
- RF range, and whether a drain attack is practical at distance

**Two bugs found in review were invisible to the simulator and would each have
been fatal in the field:** a dropped carry in the modular reduction that made
every signature invalid, and an EEPROM leak that would have bricked cards after
a few hundred taps. Treat simulator results accordingly, see
[D10](DECISIONS.md#d10).

## Open items

1. **Hardware coverage:** the [October 14 report](reports/HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md)
   records 2.1 installation, administration and signature timing, and the
   chip runs of 2026-11-13 and 2026-11-14 ([`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md))
   the install of the source numbered 2.3 then (the first run's before
   [D200](DECISIONS.md#d200), the second's with D200 to D204) and payments with real
   signatures and real change; the tracked 3.0 file is not yet tried on a chip. The
   [October 23 payment](reports/HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md) and
   [mobile reset](reports/HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md) reports
   record the tested lifecycle. Future releases require evidence for changed
   paths and the remaining cases listed in those reports.
2. **Tear-off on silicon** (#11): the write orders are analysed and enforced
   ([D14](DECISIONS.md#d14), [D23](DECISIONS.md#d23)); pulling a card mid-load,
   mid-clear, mid-payment and mid-`CHANGE_PIN` on hardware is still owed.
3. **Recovery** (#3): the dated refund path is in the applet and switched off in
   the apps; see [D5](DECISIONS.md#d5) and `FOXY-CARD-SPEC.md` 6. Since 3.0 a card
   can take its c from its owner's words ([D202](DECISIONS.md#d202)), so a phone
   restored from them works out the take-back key r + u of a lost card's dated pieces;
   it still needs the card's key P (to work out s, and so c) and the pieces themselves
   (their secrets and the mint's signatures), which the words do not give it
   ([D202](DECISIONS.md#d202)).
4. **Card attestation** (#13): proving generation of a key on-card by genuine
   firmware remains open.
5. **Side-channel review** of `SchnorrHW`: the modular arithmetic was written
   for correctness. Since 2.0 the two byte-array multiplies (`mul256x256`,
   `mulByDelta`) have no secret-dependent branch ([D21](DECISIONS.md#d21)).
   Since 3.0 the reductions on the signing path, which branched on values
   derived from the key and the nonce, run the same instructions for every value:
   - `reduce512toModN`, over e·d: the carry is folded back in two fixed passes
     (`addDelta`), and n is taken off once, by a mask;
   - `addModN`, over k + e·d: the sum and whether it is n or more are found in
     one pass, and n is taken off by a mask (`subIf`);
   - `reduceModN`, over k: the same, by `under` and `subIf`;
   - `sub32`: the borrow is taken with a shift, not a branch;
   - `cmp32`, which answers at the first byte that differs, is called nowhere
     in the signer (the applet keeps it for public values: a header's work, a
     point's coordinates);
   - `mulSmallByDelta`: its overflow check ORs every byte together and checks
     once, at the end;
   - `sign()` chooses k or n − k by a mask (`choose`), not on R's parity.

   `SchnorrHWMathTest` scans these bodies as it scans the multiplies and holds
   them to `BigInteger` at their edges. Still open: how much any of it leaks
   has not been measured on silicon (`AUTH` took 626 ms on the source numbered 2.3 then, before the signature
   was checked on the card ([D207](DECISIONS.md#d207)), on the bench J3R180: a time, not a
   leakage measurement), and the
   JavaCard VM's own instruction timing and the chip's own EC and RSA engines
   are not ours to analyse.
6. **Trustless proof of reserves:** upgrade the attestation to signed
   statements from the reserve wallets.
7. **Writes any reader causes:** `SPEND_ALL_BEGIN`, asked by any reader with no
   PIN and given up unsigned, writes a few hundred bytes of persistent memory
   (the payment's keys and its staged outputs, and where the chip gives the
   signer's temporary key only in persistent memory, that key). Every use of the
   temporary key puts G's x back in it, and in both key agreements, so that no
   secret scalar outlasts the call, in the key or in a copy a key agreement
   keeps; the signer asks the chip for that key in RAM first, cleared on
   deselect, and falls back to the persistent kind only where the chip refuses
   (see EEPROM wear above). How a chip wears under a reader that asks without
   end is not measured. The bench J3R180 gives the key in RAM (2026-11-13, by a
   test-only build that reports it); another chip or configuration may not.
8. **A header far ahead and the card's days** (3.0): a header with a time far ahead,
   given by anyone holding the card with no PIN, moves the clock there, and no real
   header moves it on.
   - **What is fixed** ([D200](DECISIONS.md#d200), [D201](DECISIONS.md#d201)):
     - A header at the floor's work (a quarter of a block's) is weak: less than half
       the work of the hardest the card has taken, and on a card that has taken none,
       less than twice the floor's work ([D203](DECISIONS.md#d203)); a weak header is
       never the hardest, and `SET_CARD` and a reset keep the hardest. At a weak clock no day the card
       counts ends and none begins at it, so such a header gives no one a day and
       freezes none. `REFRESH` with a real header (the owner's, or the holder's by
       the PIN on a card with no owner) brings the clock back, and the days end by it
       as before.
     - The owner's `REFRESH` back form brings back any clock, and the day's limit's
       window and the day of loads begun after the header begin again at it with what
       they counted ([D203](DECISIONS.md#d203)), so an owned card freed by it takes
       loads and makes change again a day after the owner's header.
     - Every set-up gives the card the tip, in its first set-up and before any load:
       that first set-up's anchor (a claim's, or `SET_HEADER`'s on a card with no
       owner) becomes the clock even where it is older, and the hardest where it is
       harder ([D204](DECISIONS.md#d204)). A card set up so has the network's block as
       its hardest before it holds anything, and a stranger's header before the set-up
       is let go.
     - A payment's change is counted in the day of loads when the payment is signed,
       so `LOAD_CHANGE` is never refused for the count and change owed always goes
       on; change the day has no room for is refused before it is made.
     - The reset or hand-over of an empty card takes a real header as the anchor,
       even where it is older, and the day of loads begins again. So the clock goes
       back in these ways only: those anchors and the first set-up's; `REFRESH` from a
       weak clock (the owner's or the holder's); and the owner's back form.
   - **What remains:** a far header that is not weak (at least half the work of the
     hardest header the card has taken: on a card set up by the text, the tip it was
     set up with or a later one; before any, twice the floor's, about 2^78 hashes, a
     bar fixed when the floor was set that falls against the network as its
     difficulty rises, and one header serves every such card) begins a day that ends
     only when the clock passes it. On a card with no owner and a day's limit, the money above what that
     day has left stays on the card, and its loads stop until the empty card's
     anchored reset; on an owned card the owner's back form frees both.
     A weak header pauses a card's days until the `REFRESH`. Readers must not pass such
     a header on ([SET_HEADER](../spec/APDU.md#set_header-0x36)); that binds no one
     holding the card. Shown in jCardSim (`FarHeaderTest`, `WeakClockTest`, `NoHardestTest`, `FirstAnchorTest`); not yet
     run on a chip.
   - **Clocks around a piece's date** ([D203](DECISIONS.md#d203)): the card does not
     read dates, and readers' clocks and the owner's phone's differ. Readers leave out
     a dated piece within a day before its D, and the owner takes one back only a day
     after D, by the network's tip; an owner that takes a piece back early, while a
     reader with a slow clock pays it, has the whole payment refused by the mint after
     the card burned every piece in it.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md). Please do not open a public issue for
anything affecting funds.
