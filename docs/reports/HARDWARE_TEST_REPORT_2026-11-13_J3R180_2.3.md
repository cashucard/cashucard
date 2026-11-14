# Protocol 2.3 on a J3R180: install, real signatures, real change, a refund key (2026-11-13)

The tracked 2.3 CAP installed on a J3R180 and, at a FakeWallet test mint (fake sats),
paid with real signatures under the card's date keys, wrote its own change back with
`LOAD_CHANGE` in a later tap with no PIN, and paid that change again; each swap was
taken by the mint. A second part ran the same with a refund key: dated pieces, the
date refund key, and c sealed to the refund key. The decisions are
[D183](../DECISIONS.md#d183) to [D199](../DECISIONS.md#d199); the wire is
[`spec/APDU.md`](../../spec/APDU.md); the run's paragraph is in
[`HARDWARE_DEPLOYMENT.md`](../HARDWARE_DEPLOYMENT.md).

## Environment

- Card: NXP J3R180 (JCOP4), CPLC serial **09312320** (read first, each part), the
  public default GlobalPlatform test key, SCP02.
- Reader: ACS ACR39U, contact. Times are the reader's round trip.
- Tools: GlobalPlatformPro (`gp`), `tools/cardctl` (`--timing`), and a small Java
  bridge to the reader for the payment steps.
- Mint: `testnut.cashu.space`, CDK mintd 0.18.1, FakeWallet (no real money); the
  `sat` keyset `017bc604…` (33-byte ID), input fee 100 ppk.
- Block headers: real mainnet headers (block 975,131 of 2026-11-09, week 2966, and
  the tip of 2026-11-13, time 1794614176, week 2967).

## Files sent to the chip

| File | sha256 | Load file (refcheck's measure) | Sent |
| --- | --- | --- | --- |
| `applet/target/cashu-javacard-2.3.0.cap`, the CAP tracked on 2026-11-13 (before D200) | `b17110469d7e5dae603a9f964b9d4e13603b3d50251f69c5efc68d578c33f5f4` | 35,466 bytes, sha256 `48b8597cfd23ace73c6451a962541bfa09534a312f225ebcf382a8769fe01c96` | at each install of the day: the first, the reinstall after the card was emptied, after the test-only build, and before the refund-key part |
| A test-only build: this source with one command added (`7E`) that says which kind of temporary key the signer got; never shipped | `9b197fb3660252655b43aa367b3461336dc8c915f00ba8c71279a28dcefa151b` | 35,509 bytes, sha256 `1bf178bc4d6257f475670ab618f89d0f434638bb14075ffd8070fb8711437f2c` | once, then the tracked CAP again |

Each install was three steps, the opener first, then the card's applet, then the tag:
the load in 16 s and the card's applet in 2 s each time. The first install's log
names the tracked path and not its hash; that file's modification time is before the
install, and it hashes `b1711046…`. The refund-key part's set-up log records the hash.

## What ran

| Step | Result |
| --- | --- |
| Install, three steps | `SELECT` `02 03`; the tag reads `getfoxy.io/card` |
| `cardctl --timing selftest --rounds 10`, before and after | 20 of 20 both times: ten `AUTH` signatures verified under BIP-340 and two compared for a fresh R; `AUTH` 626 ms |
| `setup` (PIN, record at the test mint, the TEST owner key, anchored at a real header) | first `SET_CARD` `9000` in 1,032 ms, so the framing check's seventeen engine calls passed; the claim's six `SET_OWNER` in 4.1 s |
| Loads: 64 sats as 32+16+8+4+4, locked to the date-0 key from `GROUP_KEYS`, each DLEQ checked | `LOAD_PROOF` P1 01 P2 02, about 226 ms each; read back, each kept proof checks |
| `KEYSET_KEYS` | the card worked out the 33-byte ID (19 to 267 ms a command; the five that add keys 186 to 267) |
| A payment: 32 + 16 to a till's 24, fee 1, the card's own change 23 | `SPEND_ALL_CHANGE` ×4, 449 to 673 ms; one "not yet" (596 ms) then the signature (845 ms), 3.9 s from `SPEND_ALL_BEGIN`; good under P + t·G, not under P; the mint answered `200`, both inputs `SPENT` |
| The change, in a new tap with no PIN | `KEYSET_KEYS` P1 3 (82 ms), `LOAD_CHANGE` ×4 at 1.02 to 1.03 s; the DLEQ kept; each piece `UNSPENT` |
| The change spent: 16 + 4 to a till's 8, fee 1 | the mint answered `200`, both `SPENT`; its own change came back the same way, `UNSPENT` |
| `GROUP_KEYS` for four dates; `card-secret` | the keys equal the owner's derivation from c |
| `INBOX` | the owner's SHA-256 of c and the week, for week 2967; a header of the week before answered `9000` and moved nothing; after the card was emptied, reinstalled and set up anchored in the week before, week 2966, then 2967 after `SET_HEADER` (59 ms) |
| Sealed `VERIFY_PIN` (P1 01, 90 bytes), once, after the run | `9000` in 278 ms (clear 19 ms); `GET_NONCE` P1 1 43.7 ms; the PIN key's signature by the card key checks |
| The test-only build | `7E` answered `01`: the temporary key cleared on deselect, the kind the signer asks for first; its install passed with it there |

### With a refund key

| Step | Result |
| --- | --- |
| Set up with a refund key R | `SET_CARD` 1,214 ms; c sealed to R by `GET_CARD` P1 3 opened with r, and checked against `GROUP_KEYS(0)` |
| Dated loads: 64 sats as 32+16+8+4+4, D 30 days past the card's clock | each secret `data` P + t·G, `locktime` D, `refund` R + u·G, `sigflag` `SIG_ALL`, each DLEQ checked; `LOAD_PROOF` P1 01 P2 02, 227 to 234 ms; each secret rebuilt from the card's piece equals the minted one |
| A payment of dated pieces: 32 + 16 to a till's 24, fee 1, change 23 | `SPEND_ALL_BEGIN` 207 ms, its t and refund key those of D; `SPEND_ALL_CHANGE` ×4, 472 to 1,023 ms; one "not yet" (597 ms) then the signature (699 ms), 4.3 s from `SPEND_ALL_BEGIN`; good under P + t·G for D, not under P; the mint answered `200`, both inputs `SPENT` |
| The dated change, in a new tap with no PIN | `KEYSET_KEYS` P1 3 about 83 ms, `LOAD_CHANGE` 1,029 to 1,032 ms each; each piece dated D, its proof kept, `UNSPENT` |
| That change spent: 16 + 4 to a till's 8, fee 1 | SIGN 596 and 694 ms; the mint answered `200`, both `SPENT`; its change (8, 2, 1) came back dated D, `UNSPENT` |
| `GROUP_KEYS` for D | 161 ms; t, P + t·G and R + u·G equal the owner's derivation from c and R; the date 0 too, its refund key zeros |
| `selftest` | 20 of 20, `AUTH` 626 ms |
| The card emptied | the 30 sats left paid in one payment (three "not yet" answers, then the signature), the mint took it; `GET_BALANCE` 0, no change owed |

## Not covered

- Money taken back after its date D by the refund key, r + u, at a mint: it needs
  a wait past D.
- Tears: a card pulled during `LOAD_CHANGE`, between a payment's commit and the
  paid list's rows, during a certificate write and at its seal.
- The certificate on a chip, the paid list full (a load's time against 1,024
  rows), the reset by the PIN, the PIN's waits, the held history, a hand-over,
  `LOCK_CARD`, a dollar card or a card of two units, a keyset of 64 keys timed,
  and the first load's 5-second budget.
- A phone, and a production mint.
- The faults the framing check cannot reach (6-bit tables, other window
  alignments, fixed-length scalars, Booth recoding, a blinded scalar): the real
  signatures and real change above are the evidence for this chip only.
- Other chips and configurations: the applet needs `ALG_EC_SVDP_DH_PLAIN_XY` and
  `ALG_EC_PACE_GM`, and a J3R180 in another configuration has not been checked.
  The temporary key in RAM is known for this card only.
