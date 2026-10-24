<a id="owned-card-reset--j3r180-09336320-2026-10-23"></a>

# Owned-card reset: J3R180 09336320, 2026-10-23

## Scope and environment

The operator explicitly approved the
[named-card reset plan](OWNED-CARD-RESET-DRILL.md). The run used the ACS ACR122U
PICC Interface USB reader on this Mac, Python 3.10 with pyscard 2.3.1, and the
local runner at commit `38e30d55670179b3c95afe84390f9395c16c28ba` (PR #119).
The runner source, service and cardkit changes had passed CI before execution.

The target was `cplc-v1:4790d3213041093363205547`, serial `09336320`, with
installed public key
`036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490`.
The [prior read-only inspection](HARDWARE_TEST_REPORT_2026-10-23.j3r180-reset-preflight.md)
found 0 unspent and 0 spent proof slots, no owner/PIN/record and a tag. The
execution rechecked that identity and empty state before authentication.

The tracked 2.1 CAP in this checkout has SHA-256
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
No CAP was loaded or installed by this reset, and the removed applet's exact
load bytes were not measured.

## Source, stops and successful run

The source was the retained local `eng-741-2026-10-20` service database,
historical scope `http://127.0.0.1:8821`, operator 1, issued environment,
recorded attempt `ac3575ad-6be4-4595-b213-97f89afabda6`. Its exact chip and
installation record had an escrow row. Keys were read into the running process
through its private recovery path. Arguments, prompts and logs excluded them. A
protected SQLite snapshot preceded migration and authorization; exclusive access
prevented concurrent source changes during the run.

Earlier invocations stopped with the journal at `reviewed`, no reset
authorization and no deletion intent. Bounded diagnostics identified a chip
mismatch; read-only checks found `07297620` and `09336120` during card
selection. They were not authenticated or changed. After all other cards were
moved away, an identity-only read positively identified `09336320`. The
operator had confirmed readiness and the same reset approval remained in force.

The successful invocation took approximately 3.4 seconds of CLI wall time.
It reported:

```json
{
  "ok": true,
  "stage": "complete",
  "chip_id": "cplc-v1:4790d3213041093363205547",
  "reset_id": "a87bce68-10b5-4498-be7a-626f895de90e"
}
```

The runner checked the source cryptogram, authenticated, verified registry
ownership, removed the present tag/card/opener/package in order, observed
their absence, and returned the manager to factory keys with a confirming
secure channel. It rechecked CPLC and applet absence before freezing evidence.
No LOAD or INSTALL was sent, and there was no automatic command retry.

## Retained evidence and result

- Verified manager-key version: **1**.
- Verification and completion time: Unix `1792768691`.
- Cashu package: **absent**; manager keys: **factory**, as recorded in the
  immutable completion receipt for the reset ID above.
- The local journal is `complete`, with frozen key-version/time evidence.
- The original source attempt remains `recorded`; one reset completion row
  exists. Installation history and escrow were retained.
- The journal and source snapshot both have mode `0600`. The snapshot is a
  private escrow-containing artifact and is not attached to this report.

The card is ready for a fresh installation using factory manager keys. It
does not currently contain a Cashu applet and is not ready for wallet use.

## Not covered

No mint, production service, wallet or phone was contacted. This does not
reconcile any production quarantine, prove a fresh mobile installation, or
exercise holder setup or spending. No physical reset interruption was injected;
interruption recovery remains software-test evidence from fake cards. Native
authentication failure counters were not read, and no wire transcript was
captured. No reset was attempted on the other two cards.
