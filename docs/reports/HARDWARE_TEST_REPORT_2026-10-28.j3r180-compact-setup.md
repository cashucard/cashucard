# J3R180 compact prototype installation and setup stop

## Result

The approved private prototype loaded, installed its opener and main applet,
and answered selection and diagnostics on card 09336320. Setup returned `6E00`.
The runner stopped before fixture loading, signing, export or retirement. The
operator's subsequent request to return the card to blank authorized a separate
cleanup-only plan. Cleanup verified the original platform registry and closed
the reader. The card ended factory-blank.

## Device and artifact

| Item | Value |
| --- | --- |
| Date | 2026-10-28 |
| Host and reader | Operator Mac; ACS ACR122U PICC Interface over USB/PCSC |
| Card | Disposable J3R180, serial 09336320 |
| CPLC | `cplc-v1:4790d3213041093363205547` |
| Reviewed source | `5698e8505a1285e7286293a99325d4734cc6494e`, [PR #205](https://github.com/cashucard/cashucard/pull/205) |
| Merged source | `630f71c0b6acf974115c65eb8de80bfac821ade4`; all 22 CI checks passed on reviewed head |
| Private package | `F04341534855434D5054`; opener `...4D`, fixture applet `...01` |
| Private identifiers | `CPROT/1`, manifest/diagnostic format 4 |
| CAP SHA-256 | `11b757b9fa69592e1f4295106e6119a01a323dc09ae4f41372505a3502139521` |
| Load-file SHA-256 | `920a6ef1290d57e24148ec90206528550005ac163b1a2fc300adca0a5c44dcc4` |
| Load-file size | 26,934 bytes |
| Manifest SHA-256 | `887e02e8af08f335801b933ec6e70a83bd7d4143fcbc3214290f40de92a96ea2` |
| Runtime fingerprint | `c4db9cb034019c0061838ebed8eac00b17db78e4a46c4f0c44308d07404bb344` |
| SDK | Pinned JavaCard 3.0.5; converted original instance shape 50 cells, first reference 0, 50 references |
| Python | Existing Homebrew Python 3.10 PCSC venv; factory-key-only runner |

The operator approved `compact-first-09336320-2026-10-28` and confirmed blank
readiness. Private evidence is retained under the operator's
`assisted-compact-first-2026-10-28` directory: `plan.md`, `approval.json`,
`first-drill-09336320.json`, `result.txt`, `cleanup-plan.md`,
`cleanup-approval.json`, `cleanup-after-6e00-09336320.json` and
`cleanup-result.txt`, alongside the original artifact and preview pins.
Journals contain public identifiers, registry/state and timings; authentication
payloads are excluded.

## Observations

Identity and factory-key proof passed. The original registry contained exactly
the three expected platform load files, with production and previous probe
objects absent. The 110 LOAD commands completed in 16,227.658 ms in aggregate.
Opener creation took 236.824 ms; main applet creation took 1,401.720 ms. These are
single-run host timings, including USB and host overhead.

Selection and pre-setup diagnostics succeeded:

| Counter | Reported value |
| --- | ---: |
| Persistent availability | 32,767, saturated |
| Transient reset availability | 2,574 |
| Transient deselect availability | 2,560 |
| Maximum commit capacity | 5,120 |
| Unused commit capacity | 5,120 |
| Private pool bytes | 0 |
| DLEQ bytes | 0 |
| Setup state | 0 |

The next command was private setup, `B0 70 00 00` with fixed public fixture
context. It returned status `6E00`; the host retained `card-status-6e00` and
stopped at `setup-fixture`. It sent no later fixture commands. Post-setup
allocation state was not inspected in that invocation.

## Cleanup

The operator requested return to blank after the stop. The separately recorded
cleanup-only plan rechecked CPLC and production/old-probe absence, proved one
factory-version-1 channel, and checked the exact platform baseline plus only
permitted private objects. It removed fixture applet, opener and package in
order. The final bounded registry read contained exactly:

- `A0000001515350`
- `A0000000620204`
- `A0000000620202`

The cleanup journal ended `cleaned`, with `blankBaselineVerified: true`.
Both invocations closed their reader sessions. The cleanup issued no package
load, setup, fixture loading, signing or manager-key change.

## Interpretation and remaining checks

This establishes physical installation and pre-setup diagnostic dispatch for
this exact larger private image with the original constructor layout. It
establishes neither combined 12 KiB DLEQ/16 KiB allocation nor complete outbox,
signature, export, retirement, capacity or power-loss behavior.

Instruction `70` is MANAGE CHANNEL in the
[JavaCard 3.0.5 runtime contract](https://docs.oracle.com/cd/E59935_01/prognotes/isoiec_7816-42013_specific_apdu_commands_for_logical_channel_management.htm).
Runtime interception is a plausible explanation for the refusal; the status
alone does not prove where processing stopped. D152 moves the private setup
instruction and gives the revised ABI distinct identifiers. A revised pinned
artifact and approved plan are required for another physical run. Released
firmware, service history and provisioner assets were unchanged.
