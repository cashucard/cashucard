# Switched-card identity check: one read-only connection

- Plan ID: `switched-card-identity-v1`.
- Approved scope: the operator said "i switched cards, check again" after the
  previous identity stop. This authorizes this identity read only.
- Device: the currently presented replacement card in exactly
  `ACS ACR122U PICC Interface` on this Mac. Expected intended serial `09336120`;
  accept no identity as authority to perform cleanup.
- One exclusive connection using leave-card disposition. Exactly these APDUs,
  once each, in this order: `00a4040008a00000015100000000` (SELECT ISD), then
  `80ca9f7f00` (GET DATA CPLC), with the second sent only after `9000`.
- No authentication, private applet selection, key read, registry read, delete,
  installation, reset, reconnect or retry. Close and report after the two reads.
- 30-second gate on further transmissions; supervising Node process bounds the
  Python invocation to 35 seconds. A timeout makes closure uncertain and stops.
  It is not permission to reset, reopen or retry.
- Tool: `tools/outbox-spike/check_reader_identity.py`, SHA-256
  `cc8603a34c3d7e73b63fea41d5f640688da2a60c5c1a95a5f90bfe7235bf07ac`.
- Use the already qualified Node 22.23.4 and Python 3.15 venv. Verify the prior
  611 runtime files and the new script before access. Python runs `-I -S -B`.
- Create only new private evidence in
  `~/.cashucard/switched-card-identity-2026-11-04/pass-1/`. Before enumeration,
  create a consumed receipt, then sync separate new intent/reply files for each
  command and a final result. No existing evidence may be edited or removed.
- Host decodes the saved CPLC through unchanged cardkit `parseCplc`, never a
  handwritten serial slice. Preserve raw returned evidence and confirmed closure.
- Existing cleanup `recover-unset-up-v3` remains consumed. This plan does not
  replace its journal, alter its identity pin or authorize another cleanup.

Offline validation: two synthetic tests passed for the fixed two-command path
and status/transport/storage/closure faults. The tests fail when the new tool is
absent. No physical reader was accessed during preparation.
