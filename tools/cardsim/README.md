<a id="cardsim-the-20-card-over-loopback-http"></a>
<a id="cardsim-the-23-card-over-loopback-http"></a>

# cardsim: the 3.0 card over loopback HTTP

The real `CashuApplet` (protocol 3.0, AID `F0 43 41 53 48 55 43 41 52 44 01`,
`SELECT` answers `03 00`) in jCardSim, behind a small HTTP API. flash-pos and
flash-mobile run it in their e2e jobs, pinned by `CASHU_JAVACARD_REF`. **This file
is that contract**: the four routes, the `/fixture` schema, the `/state` fields and
the Node client. A change to any of them is a change for both apps, so it is made
here and in both apps' pins together. [What changed for 3.0](#what-changed-for-30)
says what both apps must change before they move their pin.

```bash
mvn -B -f tools/cardsim/pom.xml package               # builds and tests, then target/cardsim.jar
java -jar tools/cardsim/target/cardsim.jar --port 9876
tools/cardsim/cardsim.sh --port 9876                  # the same, from source via Maven
```

The bridge binds `127.0.0.1` only. A port already in use is an error (exit 2), never
a reason to pick another port: a test that reached a stale bridge would be talking
to a card that holds an earlier run's state. Android reaches it through
`adb reverse tcp:9876 tcp:9876`.

`tools/cardsim/run.sh` and `ctl.sh` are Foxy's line-protocol bridge on port 47431,
for their iOS Simulator build. They are kept as they are. The HTTP bridge below is
the one the Flash apps and CI use.

## Routes

All bodies are JSON. Hex is accepted in either case. APDU fields come back in upper
case, and `/state`'s fields in lower case.

| Route | Answers | Status codes |
|---|---|---|
| `POST /apdu` `{"hex": "<command>"}` | `{"hex": "<data‖SW>", "sw": "9000"}` | **200** whenever the card answered, including a refusal (a non-`9000` `sw`). **400** for bad JSON or bad hex. |
| `POST /reset` | `/state` of a brand-new card | **200** |
| `POST /fixture` `{…}` (below) | `/state` after the fixture | **200** applied. **400** `{"error"}`: the fixture failed validation and the card is untouched. **409** `{"error": "<step>", "sw": "6985", "state": {…}}`: the applet refused a step. |
| `GET /state` | the card, read without changing it (below) | **200** |

Any other path is **404**, a wrong method is **405**, and anything the server did
not expect is **500** `{"error"}`. The card is kept as it was.

- **`/apdu` is never retried**, by the server or by `client.cjs`. A replayed
  `LOAD_PROOF` burns a slot. A replayed `SPEND_ALL_SIGN` of a payment already signed
  answers `6985`, and the signature is fetched again with `SPEND_ALL_AGAIN`.
- **`/reset`** builds a new simulator: the opener, the card's applet and the NFC tag
  are installed, `SELECT` is sent, and `generation` goes up by one. **The card key P
  is deterministic.** jCardSim draws every key pair from an unseeded generator, so
  every reset (and every bridge) has the same `pubkey`
  (`02fa05ed0a3649886270bacec5ddc1a3643009a759bee996f9a6ac060c9992a82e` today).
  **Its keys per date are not.** On 3.0 every piece is locked to the card's key for
  its date, P + t·G, where t comes from the card's secret c
  ([spec/APDU.md, Keys per load](../../spec/APDU.md#keys-per-load)); c is drawn
  with the card's other randomness (change openings, nonces), which is seeded from
  the host, so it is new at every reset. Read the key with `GROUP_KEYS` under the
  PIN after each reset (`client.groupKeys(date)`), and mint for each run. **Never
  mint to `pubkey` itself**: a 3.0 card never signs with P alone, so such a piece
  can never be paid.
- **Taps and times in the field.** `SELECT` starts a tap. The PIN-verified flag,
  the owner's nonce and the owner's grant are cleared on deselect, so a re-`SELECT`
  drops them as a new NFC tap does. There is no "tap" route: a transport sends
  `SELECT` on each tap. What 3.0 keeps for a *time in the field* (a payment signed,
  an owner claimed, a history read) outlasts a `SELECT`: a second payment in one
  time in the field waits longer, and after an owner's claim no payment is taken in
  it (`6985`). Only a fixture takes the card out of the field and back (jCardSim's
  power cycle): `/fixture` ends with one and a `SELECT`. `/state` sends no `SELECT`
  while the card's applet is selected (with the opener or the tag selected, see
  "SELECT the applet's whole AID" below).
- **Old cards.** An old AID (0.x `D2 76 00 00 85 01 02`, or Foxy's 1.x
  `F0 46 4F 58 59 …`) through jCardSim answers `6E00` or `6999`, where a real card's
  runtime answers `6A82`. Treat any `SELECT` answer that is not `02xx 9000` as
  "This card needs an update".

## `/fixture`

A fixture is applied on top of the card as it is. The usual order on 3.0 is:

1. `/reset`;
2. `/fixture {pin, mint, owner}`: the card's first set-up (its PIN, its record and
   the owner's claim) in one fixture;
3. over `/apdu`: `SELECT`, `VERIFY_PIN`, `GROUP_KEYS` of the date (0 for undated
   pieces): the card's key for that date, P + t·G, and for a dated piece the refund
   key R + u·G (`client.groupKeys(date)`);
4. mint format-4 SIG_ALL pieces locked to that key at the mint;
5. `/fixture {pin, proofs}`.

Every key is optional. An unknown key, at any level, is a 400. The 0.x keys `puk`
and `appletVersion` are refused by name: 2.x has no PUK and no version mask.

```jsonc
{
  "pin":        "1234",                    // 4-8 characters: SET_PIN on a card with none, then VERIFY_PIN
  "mint":       "http://127.0.0.1:3338",   // 1-77 ASCII characters: the record (SET_CARD)
  "refundKey":  "02…",                     // 33 bytes, a compressed point, with "mint": the record's refund key
  "owner":      true,                      // SET_OWNER with the public TEST owner key (below)
  "ownerKey":   "<32 bytes>",              // SET_OWNER with this P-256 private key instead (not with "owner")
  "anchor":     "<80-byte header>",        // with an owner: SET_OWNER's anchor header (D20)
  "headers":    ["<80-byte header>", …],   // SET_HEADER, in order
  "proofs":     [{ "keysetId": "<8 bytes>", "amount": 64, "nonce": "<32 bytes>", "C": "<33 bytes>",
                   "date": 0, "dleq": { "e": "<32>", "s": "<32>", "r": "<32>" } }],   // at most 128; date, dleq optional; needs "pin"
  "spentSlots": [1],                       // indexes into "proofs": spent on the card by a payment of that piece
  "limits":     { "day": 5000, "payment": 1000, "allowance": 250, "rollBudget": 7, "rate": 95000, "noPinWindow": 0 },
  "blockedPin": true                       // with "pin", on an owned card: three wrong VERIFY_PINs, so the PIN is blocked
}
```

**Validation, before any APDU.** The whole fixture is checked against the card as it
is now. Anything the applet would refuse because of the fixture's own shape is a
**400**, and the card is not touched. The checks:

- `pin`: 4 to 8 characters. `blockedPin` needs `pin` and an owner (here or earlier): a
  card with no owner never blocks its PIN, each wrong try makes the next one wait.
- `mint`: 1 to 77 ASCII characters. `refundKey` needs `mint`, and must start `02` or `03`.
  On a card with no owner the record is set once, before its first PIN or in its
  first set-up: `mint` on a card with no owner that already has a PIN is a 400
  (`/reset` first).
- `owner` or `ownerKey`, not both. On a card whose owner the bridge does not hold, `/reset` first.
  On a card with no owner it is a claim: it needs `pin` in the same fixture on a card
  with no PIN yet (the first set-up that `SET_PIN` begins and the fixture's own
  `SELECT` ends), and a record (`mint` here or earlier).
- `anchor` needs an owner in the same fixture. Each header is exactly 80 bytes.
- `proofs`: at most 128, no repeated `nonce`, `C` starting `02` or `03`, `1 ≤ amount < 2^32`.
  A dated piece (`date` ≠ 0) needs a refund key. Proofs need `pin` in the same
  fixture (a 3.0 card loads under the PIN given in the tap, nothing else opens a
  load, and a card with no PIN takes nothing) and a record (`mint` here or
  earlier); no owner is needed. The card itself checks that `C` is a point of the
  curve (`6A80`, a 409).
- `spentSlots`: distinct indexes into `proofs`.
- `limits` needs an owner. `allowance` above 0 needs a PIN on the card. `rollBudget` is 1 to 30,
  `rate` 0 to 2^32 − 1, `noPinWindow` 0 or 1.

**Apply order.** The steps run in this order, each one checked for `9000`:

1. `pin`: `SET_PIN` if the card has no PIN (which begins its first set-up), then `VERIFY_PIN`.
2. `mint` and `refundKey`: `SET_CARD`, with the owner's proof if the card already has an owner.
3. `owner` or `ownerKey`, with `anchor`: `SET_OWNER`. On an owned card, with the old
   owner's proof. On a card with no owner, the claim: the same `SET_OWNER` six times,
   the first five answered `6A98` (keep holding); then the card is taken out of the
   field and back, selected, and `VERIFY_PIN` sent again, since a card claimed in a
   time in the field pays nothing in it.
4. `headers`: `SET_HEADER`, in order.
5. `proofs`: one `LOAD_PROOF` per piece under the PIN, `P2 = 02` (the caller's word
   that the piece is locked to the card's keys for its date), `P1 = 1` with `dleq`,
   so the card keeps the mint's proof. No `ALLOW_LOAD`: the owner's grant opens no load.
6. `spentSlots`: for each, `SPEND_ALL_BEGIN` (`P1 = 02`) on that piece and
   `SPEND_ALL_SIGN` (no outputs), waited out. The piece is spent on the card only.
   The mint still holds it as unspent.
7. `limits`: the owner's `SET_LIMIT` (`34`), eighteen bytes.
8. `blockedPin`: three wrong `VERIFY_PIN`s (`63C2`, `63C1`, `6983`).
9. The card out of the field and back, and `SELECT`, so the app's first command
   starts a fresh tap in a fresh time in the field.

A step the applet refuses stops the fixture there. The answer is **409**
`{"error": "<step>", "sw": "<SW>", "state": {…}}`, the steps before it stay applied,
and `/state.fixtureError` keeps `{step, sw}` until the next fixture or reset.

**`limits` always sends 18 bytes.** The bridge sends the owner's eighteen-byte
`SET_LIMIT` (3.0's one layout): `day`, `payment` and `allowance` (each 0 when left
out: no limit, no allowance), `rollBudget`, which is **7 when left out**, the card's
default ([D20](../../docs/DECISIONS.md#d20)), `rate` (sats to the dollar, 0 when left
out: none) and `noPinWindow` (0 when left out: the no-PIN window of 24 hours; 1:
none). So a fixture with `limits` always leaves every number at what it says. (The
card itself leaves a field as it is for a `SET_LIMIT` without it,
[D26](../../docs/DECISIONS.md#d26); the fixture sends them all every time, so its
card's numbers are never leftovers.)

**`owner: true`** sets the **public** TEST owner key: the P-256 private key
`SHA-256("cashu-javacard/cardctl test owner key") mod n`. `tools/cardctl/p256.py`
(`TEST_OWNER_PRIVATE`) and `client.cjs` (`TEST_OWNER_PRIVATE`) hold the same key.
Anyone with this repository has it, so use it for simulated and bench cards only.
With it, the bridge signs the owner's proofs for `limits`, and `client.cjs`'s owner
commands default to it.

**Headers** must be real mainnet headers. The applet's floor (`FLOOR_BITS`, D24) is
built in, so a header mined for a test is refused (`6A93`).
`spec/vectors/headers.json` has twelve, a day apart.

## `/state`

Read through commands that change nothing (`GET_INFO P1 = 4`, `GET_CARD`,
`GET_PUBKEY`, `GET_BALANCE`, `GET_SLOT_STATUS`, then `GET_PROOF` and `GET_DLEQ` for
each slot that is not empty), in the tap as the app left it. **A 3.0 card says its
history only to the PIN or the owner's grant given in that tap**
([D198](../../docs/DECISIONS.md#d198)): with neither, `windowStart`, `spentToday`,
`rolls`, `allowanceArmed` and `lastHeader` read as zeros, and a spent slot as its
`slot` and `status` alone (`GET_PROOF` answers it `6A88`). After a fixture there is
neither; an app that has given the PIN in its tap sees them.

| Field | |
|---|---|
| `generation` | goes up on every reset and fixture, so a test can tell its card from one another run left |
| `deterministicKey` | always `true`: the card key P, never the keys per date |
| `version` | `"3.0"` |
| `pubkey` | the card key P, 33 bytes compressed: for `AUTH` and a certificate, never to lock ecash to |
| `balance` | the card's unit in unspent pieces |
| `pinState`, `tries`, `locked` | `0` no PIN, `1` set, `2` blocked; tries left (on a card with no owner the chip's counter); the owner's lock |
| `hasOwner`, `ownerKey`, `testOwner` | an owner is set; its public key (when the bridge set it); whether that is the TEST key |
| `recordSet`, `mint` | the record is set; its mint URL |
| `format`, `unit` | `GET_INFO` byte 8 (`4`, or `5` with keysets of both units); the record's unit, `0` sat, `1` usd |
| `changeOwed` | `GET_INFO` byte 29: an opening of the card's own change is owed (`GET_CHANGE`) |
| `noPinWindow` | `GET_CARD` byte 87: `0` the no-PIN window of 24 hours, `1` none |
| `profiles` | `GET_INFO` bytes 55 and 56, hex: `ff03`, every profile of 3.0 |
| `now`, `windowStart`, `spentToday` | the card's clock (the newest header's time, 0 before any); the day's window start; what has left the card in it (history) |
| `dailyLimit`, `allowance`, `nopinSpent` | the day's limit and the no-PIN allowance (0 is none); what the no-PIN window that runs has counted |
| `rolls`, `rollBudget`, `allowanceArmed` | D20: rolls since the owner's last `REFRESH` (history); the budget (7 when the card holds 0); whether the next payment with no PIN may begin a new no-PIN window (history) |
| `lastHeader` | the hash of the last header taken (history; zeros before any, and after a reset, which keeps the clock's time) |
| `counts` | `{unspent, spent, empty}`, the applet's own tally |
| `slots` | all 128: `{slot, status}`, and for a slot that is not empty and said (an unspent one always, a spent one to the PIN or the grant) `keysetId` (8 bytes), `amount`, `nonce`, `C`, `date`, and `dleq: {e, s, r}` when the card kept the mint's proof |
| `fixtureError` | `{step, sw}` of the last refused fixture step, until the next fixture or reset |

## The Node client

`tools/cardsim/client.cjs` has no dependencies. It exports `CardSim` (the routes plus
a method for each 3.0 command a reader sends), `encode` (the pure encoders, for a
fake NFC transport), `constants` (INS, status words, labels, lengths), the parsers,
`validateFixture` (the fixture's shape checked on the client, so most bad fixtures
fail before the HTTP call; the bridge's checks against the card are the final
word), `ownerProof`, `ownerData`, `limitValue`, the points `uncompressedPoint` and
`compressedPoint`, and a keyset's ID and tree (`keysetTail`, `keysetId`,
`keysetLeaf`, `keysetLevels`, `keysetPath`, `foldPath`, `keysetFromMint`), which put
the same bytes on the wire as `tools/cardctl/cardctl.py`.

| Method | Command | 3.0 |
|---|---|---|
| `select()` | `SELECT` | answers `{major: 3, minor: 0}` |
| `getInfo(p1 = 4)` | `GET_INFO` | P1 4 by default: 59 bytes, parsed with `keysetTable`, `rate`, `entries`, `unmarked`, `lastUnit`, `noPinWindowStart`, `profiles`, `keysPerLoad`, `loadsLeft`; byte 29 is `changeOwed` |
| `getCard()` | `GET_CARD` | 109 bytes and the mint, with `noPinWindowStart` and `noPinWindow` |
| `getCardSecret(E?)` | `GET_CARD` P1 3 | c, sealed (the raw answer), after `getNonce(1)` |
| `groupKeys(date)` | `GROUP_KEYS` (`1D`) | `{t, key: P + t·G, refund: R + u·G}`, under the PIN or the grant |
| `certRead()` | `CERT_READ` (`1C`) | `{sealed, version, length, container}` |
| `spendAllBegin(slots, {units})` | `SPEND_ALL_BEGIN` | P1 `02` (`03` with `units`), Le `45`; answers `{total, t, refund}`: the payment's key is `cashu-crypto.tweakedKey(P, t)` |
| `spendAllOutputs(outputs, keyset?)` | `SPEND_ALL_OUTPUTS` | with a keyset, P1 `01` and the keyset first |
| `spendAllChange(amount, K, keyset)` | `SPEND_ALL_CHANGE` | 45 bytes: the amount, the mint's key K for it (33), the keyset (8); Le `21` |
| `spendAllSign()`, `spendAllAgain(hash?)` | `24`, `25` | every payment waits a floor (`00 01` answers); AGAIN P1 `01` by the message's hash |
| `getChange(page)`, `owedChange()` | `GET_CHANGE` | 83-byte openings `{number, amount, keysetId, date, B_, K}`, no blinding factor |
| `keysetKeysBegin/Keys/Finish/Show`, `teachKeyset(ks)`, `showOpeningKey(opening, ks)` | `KEYSET_KEYS` (`38`) | teach a keyset under the PIN (the card checks the keys against the ID); show an opening's key by its path, any reader |
| `loadChange(k, C_, K, e, s)` | `LOAD_CHANGE` (`27`) | P2 `02`, Lc `C2`, C_ and K written in the `04` form (02/03 accepted), Le `53`; answers `{slot, proofKept, piece}` |
| `loadProof(keyset, amount, nonce, C, date, dleq, {unit})` | `LOAD_PROOF` | P2 `02` (`03` with the unit first): the caller's word that the piece is locked to the card's keys for its date; the PIN in the tap |
| `verifyPin(pin)` | `VERIFY_PIN` | sent again while the card answers `6A98` (a card with no owner serving the wait of wrong tries) |
| `claimOwner(anchor?, key?)` | `SET_OWNER` on a card with no owner | the same data sent while the card answers `6A98` (six askings) |
| `allowLoad()` | `ALLOW_LOAD` | `6200` is the grant (it opens no load); `9000`, a card of 2.2 or earlier, is refused |
| `setLimit({day, payment, allowance, rollBudget, rate, noPinWindow})` | `SET_LIMIT` | 4, 8, 12, 13, 17 or 18 bytes (`limitValue`) |
| `getPubkey`, `getBalance`, `getProofCount`, `getSlotStatus`, `getProof`, `auth`, `getDleq`, `getOutbox*`, `getNonce`, `clearSpent`, `setHeader`, `setPin`, `changePin`, `refresh` | as before | `getProof` of a spent slot, `clearSpent` and `getOutbox` outside the paying time in the field want the PIN (and the packet the owner's grant on an owned card) |

A refused command throws `CardError` with its `sw` (`describeSw` gives the spec's
words, `6200` and `6A97` to `6A9F` among them). A transport failure throws
`CardSimError`. Requests time out after 5 s. Nothing retries an APDU; `6A98` is the
card asking for the same command again, which `verifyPin` and `claimOwner` do
within a bound. `client.setLimit(…)` without `rollBudget` sends no thirteenth byte,
so the card leaves its budget as it is (D26).

`tools/cardsim/cashu-crypto.cjs` is the Cashu arithmetic the tests use (NUT-00
blinding, NUT-12 DLEQ, BIP-340, the keys per load `dateKeys(c, P, R, date)` and
`tweakedKey(P, t)`, the format-4 card secret `cardSecret(nonce, dateKey, date,
dateRefund)` naming the date's key, `verifyPayment` and the SIG_ALL message), also
with no dependencies.

## A worked example

```bash
java -jar tools/cardsim/target/cardsim.jar --port 9876 &
curl -s -X POST localhost:9876/reset | jq -r .pubkey      # P: for AUTH, never to lock ecash to
curl -s -X POST localhost:9876/fixture -d '{"pin": "1234", "mint": "http://127.0.0.1:3338", "owner": true,
  "anchor": "<the tip header, 80 bytes>"}' | jq '{hasOwner, pinState}'
# the card's key for the date 0: SELECT, VERIFY_PIN, GROUP_KEYS (t, P + t*G, R + u*G)
curl -s -X POST localhost:9876/apdu -d '{"hex":"00A404000BF043415348554341524401"}'   # {"hex":"03009000",…}
curl -s -X POST localhost:9876/apdu -d '{"hex":"B04000000431323334"}'
curl -s -X POST localhost:9876/apdu -d '{"hex":"B01D0000040000000062"}'               # bytes 32 to 64: P + t*G
# mint pieces to that key at your mint (format-4 SIG_ALL secrets, NUT-CCP's card proofs), then:
curl -s -X POST localhost:9876/fixture -d '{"pin": "1234",
  "proofs": [{"keysetId": "009a1f293253e41e", "amount": 32, "nonce": "<32 bytes>", "C": "02…",
              "dleq": {"e": "…", "s": "…", "r": "…"}}],
  "limits": {"day": 5000, "payment": 1000, "allowance": 250}}' | jq '{balance, rollBudget, counts}'
# {"balance": 32, "rollBudget": 7, "counts": {"unspent": 1, "spent": 0, "empty": 127}}
```

The same in Node: `setUp` in `tools/cardsim/client.test.cjs`, and with change made,
taught and loaded back with `LOAD_CHANGE`, its "card's own change on the bridge" test.

**SELECT the applet's whole AID** (`F0 CASHUCARD 01`, [D25](../../docs/DECISIONS.md#d25)).
The bridge installs the opener first, then the card's applet, then the tag, as a
chip has them, and answers a SELECT by a partial name the way the J3R180 does: it
reaches the first instance made whose AID begins with the name. So the package AID
`F0 CASHUCARD` alone reaches the opener, which answers `9000` with no version and
`6D00` to every command after. jCardSim on its own gives a partial name to the
lowest matching AID in sort order (the card's applet), so the bridge resolves the
name itself before jCardSim sees it (`SimCard.resolveSelect`); a whole AID, a name
that begins no instance and a "next occurrence" SELECT pass through unchanged.
`GET /state` and `/fixture` read the card's applet wherever the app left the
selection: `/state` puts the app's selection back after its reads (with the tag
selected, the file the app chose on it too, so a `READ BINARY` after `/state` reads
the same file), and a fixture ends with the card's applet selected, as before.

```bash
curl -s -X POST localhost:9876/apdu -d '{"hex":"00A404000AF0434153485543415244"}'
# {"hex":"9000","sw":"9000"}   the opener: no version
```

The same in Node, minting at a real mint with a SIG_ALL swap, is
`tools/cardsim/e2e-swap.test.cjs`: the first set-up, `GROUP_KEYS`, pieces minted to
the card's key for the date 0, loaded under the PIN, the mint's keyset taught
(`KEYSET_KEYS`), a payment with the card's own change bound to the mint's keys, the
swap, then in a new tap with no PIN each opening's key shown and the mint's answer
loaded with `LOAD_CHANGE`. CI runs it against a Nutshell 0.20.3 with forge's keyset
shape (an 8-byte id, no fee) and against a fresh v2 keyset (a 33-byte id, a fee of
100).

## What changed for 3.0

For flash-pos and flash-mobile, before either moves its `CASHU_JAVACARD_REF` pin
past this change (both pins move together, with the app changes below):

- **`SELECT` answers `03 00`**, `/state.version` is `"3.0"`. The major moves
  ([D205](../../docs/DECISIONS.md#d205)): an app that takes only major 2 answers this
  card with "needs an update" until it takes major 3.
- **Lock pieces to the card's key for their date, never to `/state.pubkey`.** Read
  `GROUP_KEYS` under the PIN (`client.groupKeys(date)`), or work the keys out from c
  (`GET_CARD` P1 3, `cashu-crypto.dateKeys`). A piece minted to P can never be paid.
  The secret's `data` is P + t·G, and a dated piece's refund tag R + u·G.
- **Fixtures.** `proofs` need `pin` in the same fixture; no owner is needed for a
  load. `owner` on a fresh card needs `pin` (and a record) in the same fixture: the
  claim happens in the card's first set-up. `blockedPin` needs an owner. `limits`
  takes `rate` and `noPinWindow` and always sends 18 bytes. A fixture ends with the
  card out of the field and back. `/state` says the card's history only in a tap
  with the PIN or the grant, and a spent slot without its piece; it gains `format`,
  `unit`, `changeOwed`, `noPinWindow` and `profiles`.
- **Paying.** `SPEND_ALL_BEGIN` is P1 `02` and answers 69 bytes:
  `client.spendAllBegin` returns `{total, t, refund}`, not a number. Build each
  input's secret with P + t·G (`cashu-crypto.tweakedKey(P, t)`) and check the
  signature under it. Every payment waits a floor: keep sending `SPEND_ALL_SIGN`
  while it answers `00 01`.
- **The card's own change.** `spendAllChange(amount, K, keyset)` names the mint's key
  and the keyset, which the card must have been taught (`teachKeyset`, under the
  PIN; `6A9F` otherwise). The change comes back with `owedChange`,
  `showOpeningKey` and `loadChange`, in any tap and with no PIN; `getChange` no
  longer gives a nonce or a blinding factor, and `loadProof` of change is gone.
- **Loads and the owner.** `LOAD_PROOF` (P2 `02`) and `CLEAR_SPENT` want the PIN in
  the tap; `allowLoad` answers `6200` and opens no load; the tap after a payment
  opens nothing (`GET_INFO` byte 29 is now "change owed"). A card with no PIN
  answers `6A97` to every load and payment. `GET_PROOF` of a spent slot, and
  `GET_OUTBOX` outside the time in the field that signed the payment, want the PIN
  (the packet: the owner's grant on an owned card).
- **New words.** `6200`, `6A86` (no word on keys per load), `6A97` to `6A9F`;
  `6A98` means send the same command again.


## Assisted settlement rehearsal

`assisted-settlement.cjs` exercises a relay and a merchant in separate processes.
Use an isolated Nutshell 0.20.3 FakeWallet mint with persistent storage and a
fresh cardsim bridge. Both addresses must be loopback HTTP origins. The script
resets the simulator and mints test ecash. Create a new scratch directory name
for each run; `capture` creates it with private file permissions.

```bash
node tools/cardsim/assisted-settlement.cjs capture /tmp/assisted-run http://127.0.0.1:4338 http://127.0.0.1:19876
node tools/cardsim/assisted-settlement.cjs relay /tmp/assisted-run
# Restart only the isolated mint, retaining its database.
node tools/cardsim/assisted-settlement.cjs recover /tmp/assisted-run
node tools/cardsim/assisted-settlement.cjs recover /tmp/assisted-run
```

Capture sets the card up, reads its key for the date 0 under the PIN (`GROUP_KEYS`)
and mints the funding pieces to it, loads them under the PIN, and persists merchant
output openings before the simulator signs. Relay
reads the public signed swap, submits it unchanged, discards the swap response,
and checks complete NUT-09 restoration with blinded DLEQ and input-state
coverage. After the mint restart, recovery unblinds and redeems every merchant
output. The last run demonstrates that NUT-09 still returns already-redeemed
outputs, so issuance evidence must be combined with durable inventory and
payout accounting.

On October 27 this sequence passed against Nutshell 0.20.3 with both 33-byte
keyset IDs and a 100-ppk input fee, and 8-byte keyset IDs with no input fee.
Each profile included a mint restart between relay and merchant recovery.
The cardsim CI job runs both profiles after the ordinary swap checks.
The script covers local feasibility; the production outbox, payout ledger,
firmware resource limits and physical interruption tests have separate gates.
`assisted-settlement.test.cjs` checks exact coverage, reordered pairs, missing
or substituted promises, and DLEQ refusal without a running mint.
