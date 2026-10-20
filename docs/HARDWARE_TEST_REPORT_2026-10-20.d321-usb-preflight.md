# USB preflight attempt — incomplete

2026-10-20, ENG-741 / PR #23. The operator explicitly approved Phase A on
ACS ACR122U PICC Interface for `cplc-v1:4790d3213180072976207515`.

One CLI execution used source `52307ba`, Homebrew Python 3.15 and pyscard 2.3.1
on this Mac. It exited 1 with `preflight transport unavailable; no retry
performed`. No public card result was produced. No second connection or
physical attempt was made. The script contains no authentication/write APDUs;
the exact reached read command is unknown because cleanup masked the original
exception. Neither applet absence nor presence is established. The tracked CAP
was not installed or inspected; its repository SHA-256 is
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.

Offline inspection of the installed pyscard source found that `disconnect()`
takes no arguments. The script incorrectly passed SCARD_LEAVE_CARD there,
while connect had used the default unpower disposition. Thus the intended
leave-card cleanup was not established by this run. The corrected wrapper
passes disposition on connect, disconnects without arguments only after a
successful connection, and reports a controlled connection/read failure without
exposing raw native errors. Reader-free regression coverage fails on the old
revision and passes after the fix (five preflight tests total).

Phase A remains incomplete. No manager-key provenance, disposable status,
installation state or write readiness is inferred. A new physical attempt needs
operator approval; no automatic retry is included.

## Second attempt — identity matched, unexpected applet version

The operator explicitly approved one new attempt after the cleanup fix.
Source `f1c22c3` ran the same command once with the same environment and reader.
It exited 1 with `{"error": "unexpected applet version"}`.

The implementation reaches this error only after successful ISD selection,
strict CPLC validation and exact match to
`cplc-v1:4790d3213180072976207515`, followed by a successful full card-app AID
selection whose response data differs from `02 01`. The response bytes are
not included in this version's error output, so the installed version cannot
be identified from this evidence. No GET_INFO, GET_PUBKEY or tag selection
followed; no authentication, signing, PIN, key or write command was attempted.
The successful connection used SCARD_LEAVE_CARD and normal disconnect.

This card is not eligible for the proposed absent-applet first-write drill.
Do not clear or replace it. Next diagnosis would require a separately approved
read-only version inspection that records the SELECT response. Disposability,
manager-key provenance, funds/owner state and installation public key remain
unknown. No further physical attempt was made.
