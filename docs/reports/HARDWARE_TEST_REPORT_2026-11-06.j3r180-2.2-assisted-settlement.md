# Assisted settlement end to end on a J3R180 (2026-11-06)

ENG-818. An offline till took a card payment, the card carried the signed
settlement packet ([D175](../DECISIONS.md#d175), `GET_OUTBOX`), the customer's
phone relayed it to the mint on its next tap, and the till recovered its
proceeds exactly once when it came back online. All four steps passed on the
first run of the fixed build ([D176](../DECISIONS.md#d176)).

## Environment

- Card: NXP J3R180, CPLC serial **09336320**, GlobalPlatform factory keys, SCP02,
  applet 2.2 from cashucard/cashucard main `a3c62b6` (CAP sha256
  `86839ccf74d9b7a2aa7f7b8d8d47af1e1649ae14f30a4ac135f285e277e1f66d`), installed
  the same morning ([the install report](HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md)).
- Reader: ACS ACR122U; `tools/cardctl` for every read of the card.
- Till: flash-pos main `4ece1c8` (ENG-821) on a Pixel 8 Pro, debug APK with the
  production bundle.
- Phone: flash-mobile main `201e664` (ENG-820) on an iPhone, Release build, TEST
  instance.
- Mint: `https://forge.flashapp.me`, Nutshell 0.22.1, 8-byte keysets (sat
  `0059534ce0bfa19a`).

## Step 0b and 0c: setup

The owner set the card up from the phone (PIN, owner, mint) and topped it up, then
read it once on the till while online so the till cached the mint's keysets.
`cardctl info` afterwards: version 2.2, PIN set, owner yes, record set with the
mint, 8 pieces unspent, balance 26 sat; `cardctl outbox` answered `6A88` (no
payment yet). The phone showed no relay toast on these taps: a card with nothing
to settle is quiet by design.

## The four steps

| Step | What was done | Expected | Observed |
| --- | --- | --- | --- |
| 1 | Till in airplane mode charged 7 sat; card tapped, PIN entered | Paid, settlement pending; the card carries one packet | Paid. `cardctl outbox`: 631-byte packet, payment id 1, generation 1, mint forge, inputs slots 1, 4, 6 = 4 + 2 + 1 sat (keyset `0059534ce0bfa19a`), outputs 4 + 2 + 1 sat to the merchant, no change; witness and descriptor both verify, **VALID**. Card: 5 unspent, 3 spent, balance 19 |
| 2 | Card tapped on the phone, online; then tapped again | First tap settles; second tap is quiet | First tap: toast "Settled this card's last payment." Second tap: no toast. The mint's `/v1/checkstate` for the three inputs: all **SPENT**, the first carrying the SIG_ALL witness. `cardctl outbox` still returns the same packet, VALID (2.2 does not retire it) |
| 3 | Till back online | Recovers exactly 7 sat once, pending banner clears | Till: "7 sat settled at the mint; it sweeps to your wallet once the till reaches 10 sat." Transaction history: one eCash entry, 7 sats, settled badge. Relaunching the till changed nothing |
| 4 | Negative: taps on the phone before any payment (step 0b) | No relay toast, no swap | As expected; nothing to settle is silent |

Step 1 also answers D176's open question: the first `SET_CARD` was given the
record's room, since the card wrote a packet.

## Reading

- The whole flow holds on silicon with the production mint. Accounting agrees to
  the sat: 7 sat left the card (26 to 19), the mint marked those three pieces
  spent on the phone's swap, and the till booked 7 sat once.
- The phone's second tap being quiet is ENG-820's design: a record this phone has
  already seen settled is not announced on later taps; "already settled" is only
  said when the mint, not this phone, settled it first.
- The relay toasts carry no amount. The till recovered through its own drain
  without the merchant pressing anything.

## Not covered

- The till's recovery when it, not the phone, settles first (the harness in
  flash-pos covers it; not run on silicon today).
- A packet with change outputs (the 7 sat were an exact pick of pieces).
- The till's sweep to the wallet (a separate feature with a 10 sat threshold).
- A second card, a refused packet, a dated card (ENG-822).
