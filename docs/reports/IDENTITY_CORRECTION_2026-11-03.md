# Recovery identity correction

The November 3 captured CPLC identifies serial `09336120`, batch `5547`, and
`cplc-v1:4790d3213041093361205547`. Earlier reports and lab labels use
`09336320`; retain those labels as historical evidence. The H0 `gp-info.txt`
capture is the spare, whose parsed identity ends in `093363205547`.

The correction updates the fake at its source, all three Pixel image profiles,
the creation controller and the two runner guards. Two additional runner test
fixtures also required correction: their baseline and qualified-card checks
describe the November 3 card. The strict baseline, registry, diagnostic and
private-command policies remain unchanged.

The new cardkit regression reads the fake through the real identity API and
compares every parsed field with the independently tapped TLV. It also requires
the spare identity to fail after only SELECT ISD and GET DATA. It fails against
the previous fake and passes with the correction.

## Remaining identity references

- `tools/cardctl/read_registry.py` already pins `09336120`.
- `tools/cardctl/spent-audit.test.cjs` supplies a synthetic payload and expected
  identity to the audit; it contains no physical capture or card-specific guard.
- `ops/tools/admin-console-fixture.ts` creates a disposable local database with
  synthetic escrow. Its identity is an opaque example.
- `ops/test/operator-admin.test.ts` tests propagation of a caller-supplied identity
  through a local test database. It contains no physical card evidence.
- The three synthetic examples and the spare's H0 fixture remain unchanged.

## Validation

- Regression against old fake: failed with `ChipIdentityMismatch`; corrected fake:
  all six identity cases passed.
- Full cardkit suite: 129 passed; both TypeScript configurations passed.
- Outbox suite: 187 passed. An initial run exposed the two stale runner fixtures;
  the complete run passed after their correction.
- Independent Python policies: 4 compact bridge, 10 recovery bridge and 5 phase
  wire cases passed.

This work used an isolated checkout copied from `feat/compact-phase-recovery`
at `d98da20`, including its existing uncommitted correction and handoff. No card,
reader, phone, production service or protected hardware journal was accessed.
No new recovery plan is approved. The third-stop rule remains in force.
