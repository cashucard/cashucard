# Read-only spent-entry audit — card 09336320

Status: software prepared; physical execution is **not yet approved**.
This plan adds no cleanup, authentication, reset or key change.

The [physical run report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
records provisioning, holder setup, a 61-sat load, four payments and a final
empty card. Its final independent USB check found 0 unspent and 13 spent
entries. Spent does not by itself mean the corresponding proof was redeemed
at the mint; preserve those entries until that has been checked.

## Exact target and permitted actions

- Reader: **ACS ACR122U PICC Interface** on this Mac, one connection.
- Card: **cplc-v1:4790d3213041093363205547**, serial **09336320**.
- Current applet key:
  `031b63ab2c73c8825952be146d6a71b6a3c17353276a8fc234d990e0a45a3f11f6`.
- Require version **2.1**, **0 unspent / 13 spent**, owner/PIN/record present
  and not locked. The recorded mint must match **https://forge.flashapp.me**.
- Read-only APDUs: SELECT ISD, GET CPLC, SELECT full Cashu applet AID,
  GET_INFO, GET_PUBKEY, GET_CARD, GET_SLOT_STATUS, and GET_PROOF once for each
  of the 13 bitmap-confirmed spent slots. Re-read INFO/key/CPLC before closing.
  That is at most **24 commands** for this expected count, without retries.
- Network: one GET `/v1/keysets` and one POST `/v1/checkstate` at that exact
  HTTPS mint. Checkstate is a state query, not a spend, swap or payment. Only
  derived Ys go to the mint; the tool uses no account credentials.
- Raw spent-slot fields stay in the private child pipe and process memory.
  No nonce, C, secret, witness or Y is printed or saved. The summary may retain
  public card identity, count, denomination histogram, total face value, time
  and an evidence digest. This is not a wallet-balance or payout-history export.

Any wrong card/key/version, nonzero unspent count, changed state, malformed or
torn slot, unknown keyset, timeout, network failure or non-SPENT result stops
without authenticating or writing. Do not retry automatically or clear data
to make the audit pass. Keep the original phone receipts and card unchanged.

## Invocation after review and approval

Use the Homebrew/pyscard venv documented in `tools/cardctl/README.md`.
The path is an environment choice, not a password or key.

```bash
node tools/cardctl/spent-audit.cjs \
  --reader 'ACS ACR122U PICC Interface' \
  --chip cplc-v1:4790d3213041093363205547 \
  --installation 031b63ab2c73c8825952be146d6a71b6a3c17353276a8fc234d990e0a45a3f11f6 \
  --spent-count 13 \
  --mint https://forge.flashapp.me \
  --python /absolute/path/to/tools/cardctl/.venv/bin/python
```

The command above is a **preview**. Only after this plan is approved, append
`--inspect` to perform the reads and state query. Do not invoke
`spent_audit_reader.py` directly; it is a private child, not a card-dump CLI.

If every entry is SPENT, retain the summary and prepare the separately reviewed
cleanup/production-reset operation. This audit does not clear the 13 entries,
return manager keys or make the card factory-ready. A later write must check
fresh evidence and obtain its own device/action authorization. No additional
funding or card payment is part of this plan.
