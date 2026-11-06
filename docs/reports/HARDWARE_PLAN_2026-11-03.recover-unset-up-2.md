# Hardware plan: return card 09336320 to factory blank (third session)

Plan ID: `recover-unset-up-v2`.
Status: **approved 2026-11-03** (see [Approval](#approval)).

Supersedes [`recover-unset-up-v1`](HARDWARE_PLAN_2026-11-03.recover-unset-up.md),
which is consumed: two reader sessions under it, both stopped before any
recovery frame was sent and **before any deletion frame has ever been sent to
this card**.

## What the two stops were, and what caused them

Both stops are fixed in `7b400c0`; neither was the card.

**Attempt 1 — `wrong-chip`**, journal
`~/.cashucard/recover-unset-up-2026-11-03/attempt-1-chip-trim/recover.json`
(sha256 `c47122e4bbc0f22bfa04c063b637223b789ce1b9823259abe381643ab25a0cb2`).
Two commands: `select ISD`, then the CPLC read. The identity that came back was
`cplc-v1:4790d3213041093361205547`; the launcher pinned
`cplc-v1:4790d3213041093363205547`. The pin had been written by slicing CPLC
bytes by hand, and digit 21 of the id was `3` where the card's CPLC says `2`.
`cplc-v1:4790d3213041093363205547` is not an id any CPLC on this card produces.
`recoverToBlankOrder` matches the chip first, so nothing else ran.

**Attempt 2 — `operation-failed`**, journal
`~/.cashucard/recover-unset-up-2026-11-03/recover.json`
(sha256 `a1e4a267e9747f98b597d513632f52e2c6e84b4fb3e8cae34ca9456a01e7ab03`).
One command: `00a40400`, `reply: null`. The CPLC matched this time; the failure
is the bridge, not the card. `trim_cplc` had been rewritten to return `bytes`,
but the bridge's loop emits a reply by concatenating onto what pyscard returned
(`data + [sw1, sw2]`), so `list + bytes` raised `TypeError`, which
`common.checked` flattens into `{"error": "probe-bridge-stopped"}`. It returns
`list(raw)` now.

## Why the chip id is this one now

The card's CPLC, captured through this same bridge on hardware, is **45 bytes,
the `9F7F` TLV alone** — no extra control byte, nothing to trim:

```
9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000
```

`cardkit.parseCplc` on it yields `cplc-v1:4790d3213041093361205547`. The launcher
pins that id, and its own test asserts it by parsing the captured bytes through
the SDK rather than by hand, so the next slice cannot drift.
`readChipIdentity(tx, launcher.chip)` against the live card through the real
bridge now returns the identity instead of throwing `ChipIdentityMismatch` —
verified on hardware before this plan was written.

`trim_cplc` stays in the bridge for the one-byte-prefixed shape seen
intermittently in harness readings, narrowed to the exact frame, success, one
byte of margin over the 45-byte TLV, and that TLV's tag behind the byte. It
costs nothing when the card answers the TLV alone, and both guarantees are
proved load-bearing: loosening the length to `<= 46` fails one test, returning
`bytes` fails three.

## The expected key

`recoverToBlank` enforces `expectedKey` twice: the read after SELECT must equal
it (`recovery-key-mismatch`), and `compact_recovery_bridge.py` matches the same
reply before it releases any deletion frame (`cleanup_ready`). The key
`03d0b08a4f96d57301cedc89435b15a809f18cc9a7abe30614e07e464ca8ce0570` was read
from this card twice, identically, on 2026-11-02, and again on 2026-11-03.

It cannot be tied to a signed packet — this card has none — so recovery proves
the key is the one the card reports **now**. That limitation was accepted for
`recover-installed-v1` and is unchanged.

## Scope

One card (`09336320`, `cplc-v1:4790d3213041093361205547`), one reader
(`ACS ACR122U PICC Interface`), **one** destructive session — the last this task
may have.

In scope:

- One reader session through `tools/outbox-spike/recover-installed.cjs
--recover`, with the key above as `--expected-key`.
- A fresh private journal file, `0600`, in a new `0700` directory:
  `~/.cashucard/recover-unset-up-2026-11-03/attempt-3-cplc-list/recover.json`.
- The outcome written into this plan, and the report.

Out of scope — no command in this plan sends any of them:

- LOAD, INSTALL, SETUP, key rotation, PUT KEY, SET DATA, retirement.
- Any change to `verifyRegistry`, `entryAllowed`, `BASELINE`, `diagnostics`
  (`run-compact.cjs:124`), or `compact_bridge.PRIVATE`.
- Editing or deleting any existing journal under `~/.cashucard/`, including the
  install journal `cashucard-private-capacity-install-v1` and both attempts
  above. They are evidence.
- A fourth session. A third consecutive stop ends the attempt and is reported.

## Steps and gates

0. **Both defects fixed**, with regressions that fail against the old code
   (done: `7b400c0`).
1. **Offline rehearsal green** on the commit that will run, tree clean:
   `node --test tools/outbox-spike/*.test.cjs` (187 pass) and the three Python
   suites (`OK`).
2. **Hardware pre-flight** — the SDK identity against the live card through the
   real bridge equals the launcher's pin. Done; re-confirmed in the run that
   precedes this session.
3. **Record the commit and journal path** before the reader opens.
4. **Reader session.** The CPLC must match `cplc-v1:4790d3213041093361205547`;
   the before-recovery listing must verify against the two instance AIDs
   `…505401` and `…50544D`; the applet must report state 0. Then: delete opener,
   delete main, and `registry()` must verify **blank** with `allowed = []`.
5. **Report**: CPLC before and after, the diagnostics reply that admitted the
   card, both deletion replies, the blank listing, the journal hash, and whether
   `blankBaselineVerified` is true.

Each step is a gate. A failure stops the session, is classified, and is reported.

## Prohibited under this plan

- Re-running the session after a partial, failed or uncertain reply, or after
  any uncertain deletion.
- Editing the launcher's `CHIP`, `READER` or `PLAN` pins between the recorded
  commit and the session.
- Deleting with a key other than the one above.
- Editing any existing journal under `~/.cashucard/`.
- Reporting recovery as complete from the offline suite alone.

## Revocation and evidence

Approval covers one card and one destructive session. It expires when the tree
is regenerated with a different commit or the card's CPLC changes. The install
journal and every earlier attempt journal are preserved untouched.

## Approval

- `approved: true`
- Approver: repo owner (operator), in session ("you choose")
- Date: 2026-11-03
- Scope: card `09336320` on the ACR122U; one recovery session to the platform
  baseline. Destructive. Earlier two stops recorded above; this is the last
  attempt this task may make.
