# 07297620 registry inspection: opener present, main absent

The approved read-only inspection completed in nine commands. The complete
applications registry contains exactly the private opener; the private main
instance is absent. The complete load-file registry contains the private
package and all four original platform files with unchanged canonical frames.
Final identity, independent saved evidence, native policy completion and reader
closure all passed. No further connection or card command followed.

## Authorization and execution

The operator said **"approved"** after reviewing the finished
[inspection plan](HARDWARE_PLAN_2026-11-05.inspect-07297620.md). Approval was
recorded and signed at `53690a44d9cd1673bc0b59c48a6e3af264f3efae` before
device access. Only the new plan, audit and approval flag changed; command
predicates, card identity, expected frames, limits and implementation did not.
The affected 22 Node cases and all 54 Python policy cases passed again, as did
formatting and whitespace checks. The earlier full suite passed all 247 Node
cases with no skips, including the optional JavaCard integration.

- Card: `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**.
- Reader: exactly `ACS ACR122U PICC Interface`, one exclusive connection,
  leave-card disposition, no reset or reconnect.
- Host: this Mac, Node 22.23.4, reviewed cardctl venv Python and pyscard.
- Runtime: 618 pinned files, digest
  `fab96a3156234662a384ea13d70a0b2c9c7f6972599442f89e93d25596f32aba`.
- Approved campaign SHA-256:
  `32d83d218ebf2bc7605719df5c8f6b2e47b3ec51ac342bab840ddec9dc781fab`.

The original unapproved preview remains intact in `preparation-1`. A new
`preparation-2` described and previewed the approved campaign from clean signed
source. The same arguments were executed once with `--execute`, after durable
consumption and runtime/evidence revalidation. The launcher exited 0 without
stderr or a host timeout.

## Complete observed state

Exactly nine commands were sent: SELECT ISD/CPLC; SELECT ISD/INITIALIZE UPDATE/
EXTERNAL AUTHENTICATE; authenticated GET STATUS applications/load-files; SELECT
ISD/CPLC again. The sole version-1 authentication followed a successful proof
using the public factory keys. All nine replies were `9000`; each registry kind
completed in one page. Authentication bodies/challenges/MACs are not retained.

| Kind                | AID                          | Observed state                                  |
| ------------------- | ---------------------------- | ----------------------------------------------- |
| Private application | `F04341534855434D50544D`     | Opener present, lifecycle `07`, zero privileges |
| Private application | `F04341534855434D505401`     | Main absent from complete applications registry |
| Private load file   | `F04341534855434D5054`       | Present, lifecycle `01`, version 0.0            |
| Platform load file  | `A0000001515350`             | Original full frame, version 255.255            |
| Platform load file  | `A00000016443446F634C697465` | Original CardDocLite full frame, version 1.0    |
| Platform load file  | `A0000000620204`             | Original full frame, version 1.0                |
| Platform load file  | `A0000000620202`             | Original full frame, version 1.3                |

Both raw CPLC replies matched the pinned 45-byte CPLC. Full canonical E3
comparison covered lifecycle, privileges, package/domain references, versions
and absence of additional or duplicate entries. No package record was filtered
away. The final journal is `inspected` / `inspection-verified`,
`mainPresent: false`; `registryVerified`, `finalIdentityVerified`,
`savedEvidenceVerified`, `independentPolicyComplete` and `readerClosed` are true.

The preceding Pixel stop at command 124 remains a transport uncertainty with no
status word. This later listing resolves current registry membership; it does
not recover a missing response or diagnose why main creation failed to register.
It supplies no proof of memory exhaustion, broken crypto or defective hardware.
Opener/package presence is not a usable payment installation.

## Evidence and exclusions

Evidence is retained privately under
`~/.cashucard/inspect-07297620-2026-11-05/`. The journal and consumed marker remain
in `pass-1`; approved campaign, pinned runtime, exact execution intent/output,
result and saved review remain in `preparation-2`.

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `pass-1/inspection.json`          | `0d24d86f6e69f7755f61b74ace3e71acebdad78e790492d8c47ef13293644acf` |
| `pass-1/inspection.json.consumed` | `05231878677b4a4b9d86ba7b2e14cc9d76f7d510cf5cecff159457503fbc96b6` |
| `preparation-2/result.json`       | `967c32aa075d8b9f696934feef5b4b8adc292a450a0ff339b5535a4ede2e3868` |
| `preparation-2/saved-review.json` | `c2ef1fe91c454c1bdc2af8f2739db2320a7209120be6a80658beb504a7653114` |

The final saved review independently rechecked terminal flags, full frame sets,
nine ordered public receipts and all historical evidence hashes. Receipt replay
used an in-memory preterminal status view because that decoder is called before
closure during live execution; the original terminal journal bytes were never
edited. The native closure receipt completed and the lease was released.

No private applet SELECT, diagnostics or public-key read occurred. No INSTALL,
LOAD, DELETE, PUT KEY, SETUP, funding, proof, signing, payment, export or retirement
occurred. This inspection loaded no CAP and does not attest current executable
bytes. The preceding phone attempt's candidate CAP was
`b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`,
as recorded in its
[hardware report](HARDWARE_TEST_REPORT_2026-11-05.d321-07297620-pixel-create-stop.md).
No phone, production service or ops state was accessed by this inspection.

The plan is consumed. Keep the installation/evidence intact. No retry, cleanup,
diagnostic connection, new plan or successor installation is authorized by this
result. Physical creation and payment qualification remain incomplete; the
original goal remains online-phone relay followed by independent exact-once
till recovery.
