<a id="local-owned-card-reset-drill--card-09336320"></a>

# Local owned-card reset drill: card 09336320

Status: **completed on 2026-10-23**. Earlier invocations stopped at the CPLC
gate before authorization. After identifying and isolating card 09336320, the
approved run removed its Cashu package and verified factory manager keys,
version 1. The source snapshot, journal and completion receipt are retained.
See the [hardware result](HARDWARE_TEST_REPORT_2026-10-23.j3r180-owned-reset.md).

## Card and authority

- Reader: **ACS ACR122U PICC Interface**, USB-connected to this Mac.
- Chip: `cplc-v1:4790d3213041093363205547`, serial `09336320`.
- Installed public key:
  `036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490`.
- Original service scope: `http://127.0.0.1:8821`, operator 1, issued keys.
- Source attempt: `ac3575ad-6be4-4595-b213-97f89afabda6`, recorded in the
  protected local `eng-741-2026-10-20` SQLite database.
- The [read-only report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-reset-preflight.md)
  found 0 unspent, 0 spent and 128 empty slots, no owner/PIN/record, and a tag.
  The public key and escrow metadata matched. Manager keys have not yet been
  authenticated in this drill.

The operator owns this test card and previously accepted replacement if needed.
This plan requires approval to remove this specific applet and return its
manager keys to the factory set. No mint, production service or phone is used.

## Prepared command

The default command previews metadata, selects no key bytes and opens no reader.
The preview for this exact source passed. After approval, execution adds
`--execute --consent-erase-owner-and-proofs --value-handled` to these selectors:

```sh
cd ops
node --import tsx src/local-reset.ts \
  --db "$CASHU_LOCAL_RESET_DB" --journal "$CASHU_LOCAL_RESET_JOURNAL" \
  --origin http://127.0.0.1:8821 --operator 1 \
  --chip cplc-v1:4790d3213041093363205547 \
  --installation 036ba3354ef98337603ad52f429e5a67214fd064e6f1c04cd784d1b11c3aa19490 \
  --source ac3575ad-6be4-4595-b213-97f89afabda6 \
  --reader 'ACS ACR122U PICC Interface' --python "$CASHU_LOCAL_PCSC_PYTHON"
```

The path variables identify protected local files; they contain no inline keys.

## Execution scope, once authorized

1. Save a private journal and protected SQLite snapshot before migrating or
   writing the local source DB. The snapshot contains escrow and retains the
   source DB's custody requirements.
   Hold exclusive SQLite access before opening the reader; a busy source stops
   the invocation before any card authentication.
2. Connect once to the named reader. Recheck CPLC, 2.1 applet identity, proof
   counts and tag through SELECT, GET DATA, GET_INFO and GET_PUBKEY. Stop on
   a mismatch or occupied proof slot, before authentication.
3. Persist exact source authorization and deletion intent. Read source keys
   internally into memory; they never enter arguments, prompts or logs.
4. Check the source cryptogram before EXTERNAL AUTHENTICATE. No initial
   factory fallback or failed-login retry is permitted.
5. Read tagged GET STATUS for applications and load files, verifying package,
   ISD, privileges and lifecycle. Delete only present whitelisted objects in
   tag/card/opener/package order, checking the registry after each reply:
   `D2760000850101`, `F043415348554341524401`, `F04341534855434152444D`,
   `F0434153485543415244`. No LOAD or INSTALL is sent.
6. Persist rotation intent, PUT KEY to the known factory set, and reopen to
   confirm. A later explicitly approved recovery recognizes a committed key
   change offline without repeating PUT KEY. Recheck CPLC and applet absence,
   then durably freeze the verified key version and time.
7. Save local completion, retaining old installation and escrow history. A
   completed invocation replays its receipt without opening the reader.

## Stop and recovery

Any identity, value, cryptogram, registry, card response, transport or storage
failure ends the invocation. There is no automatic retry. Keep the card aside
and retain the journal and snapshot. A reviewed recovery invocation inspects
existing objects before choosing commands. After a laptop crash, confirm the
prior process has exited before removing a remaining `.lock`; retain the
journal rather than restarting it.

Expected end state: Cashu package absent, factory manager keys/version verified,
and local completion retained. Fresh app provisioning and any production
quarantine reconciliation remain subsequent steps.
