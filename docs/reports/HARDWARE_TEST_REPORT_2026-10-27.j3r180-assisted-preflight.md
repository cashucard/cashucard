# Assisted-settlement resource preflight: J3R180 09336320

Status: physical identity and empty-state check completed at `2026-10-27T16:41:05.278958+00:00`.
The operator approved one read-only connection on the named USB reader before
this run, after confirming this card was empty and available for the later
resource test.

## Environment and identities

- Host: macOS 26.5.
- Reader: **ACS ACR122U PICC Interface**.
- Card: **cplc-v1:4790d3213041093363205547**, serial **09336320**, previously tracked as a J3R180.
- Current applet installation public key: `03e27c70ddd8a4a0d88f41a65f52b543c7ad231373fc452593e46eb5a5996cd530`.
- Reference released CAP: `applet/target/cashu-javacard-2.1.0.cap`, SHA-256
  `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`. This identifies the repository artifact; installed CAP bytes were
  outside this inspection.

## Measured public state

The reviewed `tools/cardctl/read_only_preflight.py` used one connection and
exactly SELECT ISD, GET CPLC, SELECT full Cashu applet AID, GET_INFO, GET_PUBKEY
and SELECT tag. The CPLC matched before any applet query.

| Observation | Result |
| --- | --- |
| SELECT / GET_INFO version | 2.1 |
| Proof slots | 0 unspent, 0 retained spent, 128 empty |
| Owner | Unset |
| PIN | None |
| Card configuration | Unset |
| Locked | No |
| NFC tag applet | Present |

The connection performed public reads only. Authentication, manager-key
provenance, mint/service reconciliation, resource-probe installation and memory
measurements remain separate gates. No PIN, owner key, proof secret or manager
key was collected.

## Next gate

The resource probe requires an ordinary CCP reset first, preserving its service
history and returning the manager to the documented factory state. The approved
probe runner must then match this chip, prove the known factory keys, install the
pinned private test package, measure once and verify its removal. A fresh CCP
installation restores a service-recorded released applet afterward. Each write
stage requires the operator's separate device/action-specific approval.
