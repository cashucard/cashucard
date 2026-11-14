# Release notes

One entry per component release, newest first, as
[component releases](COMPONENT-RELEASES.md) asks: the manifest and these notes move
in the reviewed pull request, and the tag follows the merge. A GitHub release lists
the merged pull requests besides.

## `firmware-v2.3.0`: Cashu Card protocol 2.3 (not yet tagged)

The tracked CAP is `applet/target/cashu-javacard-2.3.0.cap`, sha256
`30c7bb8d98274da0953e2e90c93027fa2313391b05a2211a9489a2111dbaed83`. Its load file,
the bytes a card is LOADed with, is 36,953 bytes by `tools/refcheck.py`'s measure,
sha256 `f216644a316e4c9de0f8bed2a4f32e90b48fa18624ed95a8f8950503f9464440`. `SELECT`
and `GET_INFO` answer `02 03`. The core is revision `03` of
[NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md). The decisions are
[D183](DECISIONS.md#d183) to [D204](DECISIONS.md#d204), and the wire is in
[`spec/APDU.md`](../spec/APDU.md).

### On a chip

This file ran on a chip on 2026-11-14
([the checklist](HARDWARE_DEPLOYMENT.md#the-23-chip-runs-checklist),
[its report](reports/HARDWARE_TEST_REPORT_2026-11-14_J3R180_2.3.md)): the bench J3R180
installed it three times in three steps (16 to 17 s to load, 2 s for the card's applet)
and, at a FakeWallet test mint with fake sats:

- passed `cardctl selftest` 20 of 20 (`AUTH` 632 ms), and 21 of 21 with the PIN after;
- answered its first `SET_CARD` after each install with `9000` (1.22 s);
- took the first set-up's anchor ([D204](DECISIONS.md#d204)): an older header in the
  set-up's own selection, or a claim's anchor older than the clock, brought the clock
  back, and after a `SELECT` an older header moved nothing;
- read back the owner's c from a test seed at the claim and a second seed's at a
  hand-over ([D202](DECISIONS.md#d202)), the take-back key for a date matching the
  card's refund key for it;
- paid dated and undated pieces with its own change, the mint taking every swap, wrote
  the change back with `LOAD_CHANGE` with no PIN and paid it again; a payment with eight
  change outputs signed;
- kept the day of loads ([D200](DECISIONS.md#d200)): at none left, a load and a change
  output answered `6A8F`, and a payment with no change signed;
- brought its clock back to older real headers by the reset by the PIN, the owner's
  reset, a hand-over and `REFRESH`'s back form ([D201](DECISIONS.md#d201)), each
  refused with `6A8D` while a piece was on the card where it asks for an empty card.

Not covered by that run: `LOCK_CARD`, a dated piece taken back after its date by the
refund key, a header far ahead or a weak clock, tears, the certificate, a full paid
list, the PIN's waits, a dollar card, a production mint and a phone.

On 2026-11-13 a
J3R180 (the bench card the [deployment guide](HARDWARE_DEPLOYMENT.md) names) installed
the file before D200 (35,466 bytes, load file sha256 `48b8597c…`, which refcheck keeps
as proven) in three steps (16 s to load, 2 s for the card's applet) and, at a
FakeWallet test mint with fake sats:

- passed `cardctl selftest` 20 of 20 (`AUTH` 626 ms through a contact reader);
- was set up in one selection; its first `SET_CARD` passed the chip framing check
  (1.03 s) and the claim's six askings took 4.1 s;
- loaded pieces under the PIN with the mint's proof (about 226 ms each);
- paid with the card's own change: one "not yet", the signature 3.9 s after
  `SPEND_ALL_BEGIN`, good under the date key and not under the card key, and the
  mint took the swap;
- wrote its change back with `LOAD_CHANGE` (about 1.03 s a piece) in a later tap with
  no PIN, then paid two of those pieces, and the mint took that swap too;
- set up with a refund key, gave c sealed to it, loaded dated pieces (`locktime` D,
  `refund` R + u·G), paid them under the key of D (4.3 s from `SPEND_ALL_BEGIN`) and
  took their dated change back, each swap taken by the mint.

The [hardware report](reports/HARDWARE_TEST_REPORT_2026-11-13_J3R180_2.3.md) has the
run. Not covered there: a dated piece taken back after its date by the refund key,
tears, the certificate, a full paid list, the reset by the PIN, the PIN's waits, a
hand-over, the owner's c given at a claim or a hand-over, a dollar card, a production
mint and a phone. The
chip needs `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY` and `KeyAgreement.ALG_EC_PACE_GM`:
a J3R180 whose configuration lacks either cannot run the card.

### What a holder notices

- **Every payment takes about three to four seconds** on a J3R180 from its first
  command to the signature: every payment waits a floor, and the card makes its own
  change in that time ([D188](DECISIONS.md#d188)).
- **A top-up always asks for the PIN.** A card with no PIN holds nothing and pays
  nothing (`6A97`), and the owner's phone loads under the PIN too
  ([D185](DECISIONS.md#d185)).
- **The card's change comes back later, from any reader, with no PIN**, by
  `LOAD_CHANGE`. Until then the card says change is owed, and moving to another
  mint, a reset, and on a card with no owner a new PIN or new limits wait for it
  ([D183](DECISIONS.md#d183)).
- **Change is made only in a keyset the holder's phone has taught the card**, under
  the PIN. After a mint moves to new keys, a till pays exactly until the holder's
  phone teaches the new keyset ([D190](DECISIONS.md#d190)).
- **The no-PIN allowance counts whole pieces** and renews only when the owner's
  phone visits or the PIN is typed in a tap that pays nothing; the 24-hour window is
  the owner's switch ([D186](DECISIONS.md#d186)).
- **Set-up holds a few seconds longer and finishes in one tap**: the owner is
  claimed by six askings ([D187](DECISIONS.md#d187)).
- **A card with no phone owner is a simple card**: its limits, mint and unit are set
  once, at its first set-up. Its PIN never blocks: each wrong try makes the next wait
  twice as long, and an empty card whose PIN was forgotten takes a new one. It is
  reset by its PIN in a held tap of about 45 seconds ([D189](DECISIONS.md#d189),
  [D195](DECISIONS.md#d195), [D196](DECISIONS.md#d196)).
- **A card loads at most 300 pieces a day**, change included, and refuses a piece
  above the day's limit ([D195](DECISIONS.md#d195), [D196](DECISIONS.md#d196)). A
  payment's change counts when the payment is signed, so the change always comes back;
  a payment whose change the day has no room for is refused before it is signed, and
  the same payment with no change goes ([D200](DECISIONS.md#d200)).
- **A clock moved far ahead**: one block header made far in the future at the floor's
  work is weak, and begins and ends no day, so it freezes no limit and gives no one a
  day; `REFRESH` with a real header, the owner's or the holder's by the PIN, brings the
  clock back ([D201](DECISIONS.md#d201)). A card that has taken no header yet holds a
  header to twice the floor's work, a weak header is never the hardest, and `SET_CARD`
  and a reset keep the hardest, so a fresh, newly set-up or reset card is held to the
  same bar ([D203](DECISIONS.md#d203)). One with at least half the work of the hardest
  header the card has taken the owner's `REFRESH` back form brings back, the day's limit
  and the day of loads with it ([D203](DECISIONS.md#d203)); on a card with no owner and a
  day's limit it still holds what that day has not left. An empty card's reset or
  hand-over with a real header as the anchor sets any clock back, and begins the day of
  loads again ([D200](DECISIONS.md#d200)). Every set-up gives the card the tip, and in a
  first set-up of an empty card that tip is the clock even where the clock was later, and
  the hardest where it is harder: a stranger's far header before the set-up is let go,
  and a card set up so holds a far header to half the tip's work ([D204](DECISIONS.md#d204)).
- **Dollars and sats on one card**, counted against the limits at one rate the
  owner's phone writes ([D184](DECISIONS.md#d184)).
- **Privacy**: every top-up is locked to a key of its own date, so the mint links
  the spends of one week's money and no more ([D197](DECISIONS.md#d197)); the
  history and spent pieces need the PIN ([D198](DECISIONS.md#d198)); a hand-over
  wipes the history and asks for a new PIN ([D197](DECISIONS.md#d197)).
- **A card's secret c comes back to a phone restored from the words**: the owner's
  phone gives the card a c made from its words when it claims the card or takes it
  over, so the words give c back with no card; to take back a lost card's dated money
  the phone also needs the card's key P and the pieces themselves, which the words do
  not give. A card with no owner, and a reset, draw their own c. The words, if they
  leak, give c too ([D202](DECISIONS.md#d202)).
- **A certificate** can say who made a card; a certified card keeps its key
  through a reset ([D192](DECISIONS.md#d192), [`CERTIFIER.md`](CERTIFIER.md)).
- **Money can wait for a card** under its inbox name until a till with the holder's
  PIN loads it ([D199](DECISIONS.md#d199)).

### What a wallet or till author needs

- **New commands:** `1C` `CERT_READ`, `1D` `GROUP_KEYS`, `1E` `INBOX`, `27`
  `LOAD_CHANGE`, `38` `KEYSET_KEYS`, `54` `CERT_WRITE`. `2E` and `2F` stay
  unassigned.
- **Changed forms:** `SPEND_ALL_BEGIN` needs P1 bit 1 and `LOAD_PROOF` and
  `LOAD_CHANGE` P2 bit 1 (keys per load; `6A86` without); `SPEND_ALL_CHANGE` is 45
  bytes (amount, the mint's key K, the keyset); `GET_CHANGE` rows are 83 bytes and
  carry no blinding factor; `SET_LIMIT` and `SET_LIMIT_PIN` take 4, 8, 12, 13, 17 or
  18 bytes (budget, then rate, then the window switch); `GET_INFO` P1 = 3 answers 51
  bytes and P1 = 4 59 bytes (profiles `FF 03`, then the loads left today); new
  `GET_CARD` P1 = 2 and 3, `GET_BALANCE` P1 = 1, `GET_LOG` P1 = 2 and 3,
  `RESET_CARD` P1 = 1, `REFRESH` P1 = 1, `SPEND_ALL_AGAIN` by hash for the last 16
  payments; `RESET_CARD` P1 = 0 takes an anchor header, and a hand-over's anchor sets
  the clock back on an empty card ([D200](DECISIONS.md#d200)); in a first set-up of an
  empty card the claim's anchor and `SET_HEADER` set it back too, and a wallet MUST give
  the tip so before any load ([D204](DECISIONS.md#d204)); `REFRESH` brings back a
  clock a weak header set, and its owner's back form (the header, then `01`, under the
  proof) any clock ([D201](DECISIONS.md#d201)); `SET_OWNER` P1 = `01` gives the card the
  owner's c, sealed to its PIN key, and the claim or hand-over after it ends with its
  check, 16 bytes ([D202](DECISIONS.md#d202)); `REFRESH` with a P1 other than `00` and
  `01`, and `SET_OWNER` with a P2 other than `00`, are `6B00` ([D203](DECISIONS.md#d203)).
- **Pickup proofs (D199):** byte for byte, `k ‖ nonces ‖ rand16 ‖ AUTH(m)`, m the first
  16 bytes of SHA-256("CashuCard/pickup" ‖ nonces ‖ rand16) (`spec/vectors/pickup.json`);
  one shows that the card was at a tap, never that anything loaded. A day after D the
  owner may take back every piece of that date, picked up or not, once it has read the
  card ([D203](DECISIONS.md#d203)).
- **The owner's c (D202):** s = HMAC-SHA256(the 64-byte BIP-39 seed, "CashuCard/c" ‖ 00 ‖
  P); c = SHA-256("CashuCard/c" ‖ s ‖ n), n the card's own count of the owners' c it has
  taken (`spec/vectors/owner-c.json`). After the claim or the hand-over the phone reads c
  and finds its n, s worked out from the card's own key; with none (another party's
  envelope, a reader in the claim's tap or the last owner at a hand-over), it locks no
  dated money to the card. A restored phone needs P and the pieces as well as the words.
- **Change and the day's loads (D200):** `SPEND_ALL_CHANGE` and the last
  `SPEND_ALL_SIGN` answer `6A8F` for change past the day's 300 loads; `LOAD_CHANGE` is
  never refused for them. A reader makes no more change outputs than `GET_INFO` P1 = 4
  bytes 57 and 58 allow.
- **New status words:** `6A97` no PIN, `6A98` keep holding (send the same command
  again), `6A99` no rate, `6A9A` two units, `6A9B` the other unit, `6A9C` no room in
  the keyset table, `6A9D` the holder's say needed, `6A9E` limit reached (enter the
  PIN), `6A9F` keys not shown; `6200` from `ALLOW_LOAD` (the grant given, no load
  opened); `63CX` on a card with no owner counts wrong tries in a row.
- **A 2.2 reader** can read a 2.3 card and cannot pay from it, load it, finish its
  change or set it up, and stops before burning anything. A 2.2 loader swaps a
  top-up before the card refuses it, so a wallet checks the version first:
  [What a 2.2 reader sees](../spec/APDU.md#what-a-22-reader-sees). flash-pos and
  flash-mobile move to 2.3 before a 2.3 card is handed out; the cardsim contract
  they pin by `CASHU_JAVACARD_REF` is 2.3's
  ([`tools/cardsim/README.md`](../tools/cardsim/README.md#what-changed-for-23)).
- **Rules a reader keeps:** leave a dated piece whose date is less than a day after
  your own time out of every payment, online or not, and, online, ask the mint the state of every input before
  `SPEND_ALL_SIGN`; never give a card a block header more than two hours ahead of
  your own clock ([SET_HEADER](../spec/APDU.md#set_header-0x36)); file inbox money
  only for a card with an owner and a refund key, dated 14 days from the filing, and
  at pickup check each piece's mint, keyset, secret, DLEQ proof and date before
  loading it ([INBOX](../spec/APDU.md#inbox-0x1e)).
- **Memory:** the constructor asks for 30,056 bytes of persistent memory; the first
  `SET_CARD` reserves 26,619 more (the proofs, the settlement record, the paid list
  with its kept signatures, the openings' keys, the keyset table), and a certified
  card 1,027 at its first `CERT_WRITE`.

### The signer

`SchnorrHW` changes without a wire change: the temporary key (a signature's nonce,
a change output's blinding factor) is asked for in RAM first and put back to a public
number after every use, in it and in both key agreements; the signer's scratch and
the PIN commands' buffers are zeroed; a point from outside is checked to be on the
curve before the chip sees it; the reductions on the signing path run the same
instructions for every value ([D21](DECISIONS.md#d21),
[`SECURITY-MODEL.md`](SECURITY-MODEL.md) item 5); and every `SET_CARD` first checks
both chip engines at seventeen points, so a chip that frames or computes them
otherwise is never set up ([ECDH framing probe](HARDWARE_DEPLOYMENT.md#ecdh-framing-probe-at-set_card)).

### Moving from 2.2

There is no upgrade in place. Spend or move every piece, bring home any change owed
(`GET_CHANGE` on a 2.2 card), delete the package and install 2.3: the card gets a
new key ([Reinstall](HARDWARE_DEPLOYMENT.md#reinstall-delete--install)). Readers and
wallets move to the 2.3 wire before a 2.3 card is handed out.

### Host components in the same change

- **cardkit 0.3.0** reads and installs the 2.3 card and refuses to reset one that is
  owed change ([`tools/cardkit/README.md`](../tools/cardkit/README.md)).
- **cardctl** speaks 2.3 (`setup`, `reset`, `change`, `load-change`, `keyset-keys`,
  `group-keys`, `card-secret`, `cert`) and `selftest` takes 2.1 and later.
- **The provisioner** carries the 2.3 load file and keeps installation switched off
  for it until the operator approves it (`src/releaseGates.ts`).
- **ops** `local-reset` refuses a card owed change.

## `cardkit-v0.3.0`: protocol 2.3, change owed, and SCP03 (not yet tagged)

`tools/cardkit/package.json` moves to 0.3.0, a minor release for changes that are not
compatible ([`tools/cardkit/README.md`](../tools/cardkit/README.md) has the migration):

- **Protocol 2.3.** `CARD_VERSION` is `[2, 3]`; the kit reads and installs the 2.3
  card and knows 2.1, 2.2 and 2.3 (`CARD_VERSIONS`). It refuses 2.2's owner commands
  on a 2.3 card.
- **Change owed.** A card owed its own change is not empty: every reset and every
  "empty" test holds to it (`changeOwed`, `readChangeOwed`, `GET_CHANGE`), and the
  probe never sweeps such a card.
- **SCP03 beside SCP02** ([D181](DECISIONS.md#d181), [D182](DECISIONS.md#d182)):
  `openSession` opens either; `putKeys` takes the session.
- **The outbox-spike runners** (`tools/outbox-spike/run-compact.cjs`,
  `run-probe.cjs`) keep requiring the reviewed 0.2.0 and refuse 0.3.0 until they are
  reviewed against it.
