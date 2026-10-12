# Foxy card

This is the Foxy fork of [`lnflash/cashu-javacard`](https://github.com/lnflash/cashu-javacard):
a JavaCard applet that holds Cashu ecash on a card, for the
[Foxy](https://github.com/getfoxy/iOS) iPhone wallet. It is **not compatible on
the wire** with upstream's applet, and has an AID of its own so that neither can
be taken for the other.

What differs from upstream:

- A spend takes no message from the reader: the card builds the slot's secret
  and signs its hash. `SIGN_ARBITRARY` is gone, and `AUTH` proves the card is
  the card.
- Nothing is loaded onto a card with no owner, or onto one with no PIN but by
  the owner's grant. The PIN is optional (1.16): a card set up with none pays
  without one, and a card with one has a no-PIN allowance, what it will sign for
  in a day without the PIN; over it, the PIN is asked for the whole payment.
- The card has an owner, a P-256 public key worked out on the holder's phone
  from its seed. Only that phone can change the PIN, unblock the card, set the
  limit or add funds with no PIN.
- The card keeps a daily limit and a clock that only moves forward. The clock is
  the time written in the newest Bitcoin block header the card has been shown
  (1.15), believed for its proof of work and for nothing else, so a terminal
  cannot start a new day by telling the card it is later. The documents say what
  that does and does not bound.
- A slot carries a date and a refund key; the card records its mint; 128 slots
  of 82 bytes (64 before software 1.7).
- A payment is one signature for as many pieces as it is made of (NUT-11
  SIG_ALL), and its pieces are marked spent outside the transaction that
  commits it, so the number is not bounded by the chip's transaction (1.8).
- The PIN is taken sealed: enciphered to a key the card keeps for that alone,
  under sixteen bytes of the card's that are good once (1.9).

The applet has run on one real card, a J3R180. Read [`FORK.md`](FORK.md) first,
and [`docs/FOXY-CARD-DAILY-LIMIT.md`](docs/FOXY-CARD-DAILY-LIMIT.md) for the daily
limit, the clock and the owner key in full. Everything under the line below is
upstream's README as it was at the fork, and describes upstream's wire, as do
`spec/` and `tools/cardctl`.

---

# cashu-javacard

A JavaCard applet implementing the [Cashu](https://cashu.space) ecash protocol
for **offline NFC bearer payments** — a physical card that holds Bitcoin-
denominated ecash on its own chip and spends it by tapping, with no phone, no
account, and no internet at the point of sale.

Reference implementation of **NUT-XX: Cashu NFC Card Protocol**, Profile B
(Bearer/Offline).

> ### Status: hardware-proven, single-card R&D
>
> The applet has run on physical silicon end to end: selftest 10/10, and the
> full money loop — fund → load → tap-to-spend on an iPhone → NUT-03
> settlement at the mint → NUT-05 Lightning melt — executed on an NXP JCOP4
> J3R180 against `forge.flashapp.me`. The merchant terminal
> (`flash-pos`) carries the same protocol and has spent a real card over NFC.
> See the [hardware test report](docs/HARDWARE_TEST_REPORT_2026-09-22.j3r180.md)
> for evidence, and [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) before
> trusting anything here with real money at scale — fleet provisioning, key
> rotation and the payout sweep to merchant accounts are still ahead.

## Start here

| You are… | Read, in order |
|---|---|
| **Curious what this is** | [`docs/VISION.md`](docs/VISION.md) |
| **A developer joining the project** | [`VISION`](docs/VISION.md) → [`ARCHITECTURE`](docs/ARCHITECTURE.md) → [`DECISIONS`](docs/DECISIONS.md) → [`CONTRIBUTING`](CONTRIBUTING.md) |
| **An AI agent working in this repo** | [`ARCHITECTURE`](docs/ARCHITECTURE.md) → [`DECISIONS`](docs/DECISIONS.md) → [`GLOSSARY`](docs/GLOSSARY.md). The decisions file exists so settled calls are not re-litigated. |
| **Auditing security** | [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md) |
| **New to Cashu or smartcards** | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |
| **Holding a card and a reader** | [`tools/cardctl/README.md`](tools/cardctl/README.md) |
| **Manufacturing the card** | [`flash-card-assets`](https://github.com/lnflash/flash-card-assets) |

## The system

Five components; only the first three live in this repo.

| Component | Where | Status |
|---|---|---|
| **Applet** — card firmware | `applet/` | Builds, CI green, unproven on hardware |
| **cardctl** — PC/SC host driver | `tools/cardctl/` | Works; untested against a card |
| **Spec** — NUT-XX + APDU | `spec/` | Draft, not yet submitted upstream |
| **cashu-client** — mint protocol | [lnflash/cashu-client](https://github.com/lnflash/cashu-client) | Load + redeem implemented |
| **Card artwork** | [lnflash/flash-card-assets](https://github.com/lnflash/flash-card-assets) | Draft v1 |
| **Flash Forge** — the mint | [forge.flashapp.me](https://forge.flashapp.me) | **Live**, [reserves published](https://forge.flashapp.me/reserves) |
| **Merchant terminal** | — | ❌ **does not exist** |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the trust boundaries and
the two end-to-end flows.

## What the card does

- **Stores proofs** — 32 slots × 78 bytes in EEPROM
- **Holds a secp256k1 key** generated on-card at install, never exported
- **Signs** a 32-byte message with BIP-340 Schnorr, to unlock NUT-11 P2PK proofs
- **Marks a slot spent** before releasing the signature, irreversibly

What it does **not** do: any BDHKE (blinding/unblinding), any mint
communication, or any verification of what it is asked to sign. Those live on
the host — see [D3](docs/DECISIONS.md#d3).

## Supported hardware

| Chip | Status | Notes |
|---|---|---|
| NXP JCOP4 (SmartMX3) | ✅ Target | JavaCard 3.0.5, CC EAL 5+, ~$5/card |
| Feitian / JCOP3 JavaCard 3.0.4 | ❌ | No `ALG_EC_SVDP_DH_PLAIN_XY` — 3.0.5+ only |
| NXP NTAG 424 DNA | ❌ | No EC crypto; this is the BoltCard chip |

**JavaCard 3.0.5 or later is a hard requirement.** The signer computes `k·G`
with `KeyAgreement.ALG_EC_SVDP_DH_PLAIN_XY`, which does not exist in the 3.0.4
API — verified against the SDK jars. The card must also be **dual-interface**
and supplied **unlocked** (known GlobalPlatform keys), or the applet can never
be installed. See [D6](docs/DECISIONS.md#d6).

## APDU command set

Full reference: [`spec/APDU.md`](spec/APDU.md).

| CLA | INS | Command | PIN | Description |
|---|---|---|---|---|
| `00` | `A4` | SELECT | — | ISO SELECT by AID |
| `B0` | `01` | GET_INFO | — | Version, slot counts, capabilities, PIN state (P1 = 1 adds the limits; P1 = 2 adds whether the NFC tag is on, 1.19) |
| `B0` | `10` | GET_PUBKEY | — | 33-byte compressed public key |
| `B0` | `11` | GET_BALANCE | — | Sum of unspent amounts (uint32) |
| `B0` | `12` | GET_PROOF_COUNT | — | Count of non-empty slots |
| `B0` | `13` | GET_PROOF | — | Full proof at a slot index |
| `B0` | `14` | GET_SLOT_STATUS | — | One status byte per slot |
| `B0` | `22`–`24` | SPEND_ALL_BEGIN / OUTPUTS / SIGN | ✔ (if set) | One signature for a whole payment (NUT-11 `SIG_ALL`): the places, the swap's outputs, then every place marked spent and one 64-byte signature |
| `B0` | `25` | SPEND_ALL_AGAIN | ✔ (if set) | The last signature given, again |
| `B0` | `21` | SIGN_ARBITRARY | ✔ (if set) | Sign 32 bytes, consuming no proof |
| `B0` | `30` | LOAD_PROOF | ✔ | Store a proof in the next free slot |
| `B0` | `31` | CLEAR_SPENT | ✔ | Reclaim spent slots |
| `B0` | `40`–`42` | VERIFY/SET/CHANGE_PIN | — / ✔ | PIN management |
| `B0` | `50` | LOCK_CARD | ✔ | Irreversibly disable writes |
| `B0` | `51` | RESET_CARD | owner's proof (+ PIN if locked) | Wipe the card to a new one, with a new key, for another person to set up (1.17) |
| `B0` | `52` | SET_TAG | owner's proof | Switch the card's NFC tag (one web address, the same on every card) off or on (1.19) |

**Spending is PIN-gated once a PIN is set** (D13, v0.2.0): `SPEND_PROOF`,
`SIGN_ARBITRARY`, `LOAD_PROOF`, `CLEAR_SPENT` and `LOCK_CARD` answer `6982`
until `VERIFY_PIN` succeeds in the same session. A card ships with **no PIN**,
and until one is set it has bearer semantics — a hostile reader in range can
drain it — so setting a PIN is the holder's first job. Three wrong tries block
the card for good and strand its balance: nothing else can sign for its
proofs, there is no unblock path in this profile, and any reader in range can
send those three tries (threat #14 in the
[security model](docs/SECURITY-MODEL.md)). See
[D13](docs/DECISIONS.md#d13); D12 records the earlier no-PIN design.

Every applet build before 0.3 stopped gating once the PIN was blocked (ENG-615,
fixed in 0.3), and 0.1 builds from before D13 gate no spend at all. Builds
before 0.4 may write a slot's status byte before its data, so a card pulled
mid-write can show a phantom proof (ENG-620, fixed in 0.4,
[D14](docs/DECISIONS.md#d14)); `main` tracked a 0.3 build that does. A card
whose `SELECT` answers anything below `00 04` (`00 01`, `00 02` or `00 03`)
needs the CAP reinstalled; sweep its balance first, because the reinstall
regenerates the card key.

**AID:** package `D2 76 00 00 85 01 02`, applet `…02 01`.

## Build

Requires **JDK 11+** and a JavaCard SDK **3.0.5 or later**. The SDK is not
downloaded for you:

```bash
git clone https://github.com/martinpaljak/oracle_javacard_sdks ~/.javacard/sdks

ant -f applet/build.xml cap
# → applet/target/cashu-javacard-0.1.0.cap   (three applets: the opener, the card's, then the NFC tag)
```

The file holds a second, empty applet that is instantiated before the card's
own: the chip refuses the card's applet as a package's first
([`docs/FOXY-CARD-HARDWARE.md`](docs/FOXY-CARD-HARDWARE.md)). From software 1.19 it
holds a third, the NFC tag (one web address, the same on every card, which the
owner can switch off), listed last and made under the NFC Forum's own name
([`docs/FOXY-CARD-SPEC.md`](docs/FOXY-CARD-SPEC.md) 5.8).

Override the kit with `-Djc.sdk=/path/to/jc305u4_kit`. Installing onto a card:
[`docs/HARDWARE_DEPLOYMENT.md`](docs/HARDWARE_DEPLOYMENT.md).

## Test

```bash
mvn -f applet/pom.xml test        # applet — jCardSim, no hardware needed
cd tools/cardctl && python3 test_bip340.py && python3 test_apdu.py
```

CI runs both on every push. **A green suite is not evidence about silicon** —
jCardSim runs on the JVM with a garbage collector and cannot reproduce EEPROM
exhaustion or hardware crypto framing. See [D10](docs/DECISIONS.md#d10).

## Project layout

```
applet/src/main/java/   applet source (JavaCard 3.0.5+)
applet/src/test/java/   jCardSim test suite
tools/cardctl/          PC/SC host driver + its own tests
spec/                   NUT-XX.md (protocol), APDU.md (wire format),
                        CARD-FILE.md (host↔mint interchange format)
docs/                   vision, architecture, decisions, security, glossary
```

## Spec

[`spec/NUT-XX.md`](spec/NUT-XX.md) is a draft, intended for submission to
[cashubtc/nuts](https://github.com/cashubtc/nuts) once it has run on hardware.
Profile A is an online, BoltCard-compatible mode; **Profile B** is what this
repo implements.

## Related

- [cashu-client](https://github.com/lnflash/cashu-client) — mint protocol, BDHKE, witnesses, DLEQ
- [flash-card-assets](https://github.com/lnflash/flash-card-assets) — print-ready physical card design
- [forge.flashapp.me](https://forge.flashapp.me) — the Flash Cashu mint ([reserves](https://forge.flashapp.me/reserves))
- [Numo](https://github.com/cashubtc/Numo) — Android Cashu NFC PoS, a Profile A reference
- [cashubtc/nuts](https://github.com/cashubtc/nuts) — the Cashu specifications

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/DECISIONS.md`](docs/DECISIONS.md) first — most of what looks like a
missing feature is a decision with reasoning behind it.

## License

MIT
