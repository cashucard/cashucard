# Documentation

Use the guides below for current implementation and operating procedures.
Dated reports record the source, devices, actions and results of particular
runs. Historical proposals retain the assumptions and gates of their date.

## Protocol and implementation

- [NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md): shared protocol core.
- [APDU reference](../spec/APDU.md): this applet's command format and profiles.
- [Architecture](ARCHITECTURE.md): components, trust boundaries and data flow.
- [Design decisions](DECISIONS.md): decisions, alternatives and supersessions.
- [Glossary](GLOSSARY.md): terms used across the code and documentation.
- [Security model](SECURITY-MODEL.md): card threats and verification coverage.
- [Hardware deployment](HARDWARE_DEPLOYMENT.md): build, install and package details.

## Provisioner

- [Screens and operator flow](PROVISIONER-APP.md).
- [Installation recovery](PROVISIONER-RECOVERY.md) and [safe exits](PROVISIONER-SAFE-EXITS.md).
- [Holder-wallet handoff](PROVISIONER-HOLDER-HANDOFF.md).
- [Mobile reset and reuse](OWNED-CARD-MOBILE-RESET.md).
- [Cross-service reset reconciliation](RESET-RECONCILIATION.md).
- [Data inventory](PROVISIONER-DATA-INVENTORY.md) and [store release](PROVISIONER-STORE-RELEASE.md).

## Service operation and releases

- [Ops-service threat model](OPS-THREAT-MODEL.md).
- [Partner governance proposal](OPS-GOVERNANCE.md).
- [Recovery custody and independent copies](OPS-RECOVERY-PLAN.md).
- [Component releases](COMPONENT-RELEASES.md) and [provenance](PROVENANCE.md).
- [Local service and recovery commands](../ops/README.md).

## Evidence and design history

The `HARDWARE_TEST_REPORT_*`, `RECOVERY_TEST_REPORT_*`, `OPS_*_REPORT_*` and
`PROVISIONER_*_REPORT_*` files are dated evidence. Start with the
[physical payment E2E report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
and [mobile reset report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
for the tested card lifecycle.

`FOXY-CARD-*` and `FOR-LNFLASH.md` retain the Foxy design history. The current
APDU reference and later design decisions govern the shared implementation.
Hardware plans name their permitted devices and actions; repeating a run
requires its own approval.
