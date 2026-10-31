# J3R180 full-capacity signing and packet recovery

## Result

The private streamed image on card 09336320 signed the fixed 128-input /
128-output fixture. The approved ACS recovery exported all 91 pages, verified
the complete 23,163-byte canonical packet and both BIP-340 signatures in Node
and independent Python, retired the exact scope and verified the original blank
platform baseline. The reader closed successfully; the plan is consumed.

The Pixel phase stopped at SIGN after receiving `9000` because its elapsed gate
was crossed before the response body/scope was saved. Recovery found a committed
record with all 128 inputs spent. This establishes physical capacity, signatures,
export and retirement for this fixture. A complete single-pass phone workflow
within its time budget remains open, as do many-record capacity, physical
torn-write coverage, production authorization and protocol/release integration.

## Devices and pinned artifacts

| Item | Value |
| --- | --- |
| Local test date | 2026-10-31 (America/Los_Angeles) |
| Card / CPLC | J3R180 09336320 / `cplc-v1:4790d3213041093363205547` |
| Phone | Pixel 8 Pro, USB `42201FDJG00048`, Android 17 / API 37 |
| Reader | ACS ACR122U PICC Interface |
| Reviewed host source / PR | `3a2c0562b42d3b597458299c81495770087af16d` / [#226](https://github.com/cashucard/cashucard/pull/226) |
| Merge / CI | `2ce8488aa7bd03af7f5d61a5cf1637bb9948d6b6` / all 22 checks passed, exact-head review |
| Image engine source | `96eb11df58c0969e2d00a1d52a2ca726f8d2d971` |
| Private main AID / ABI | `F04341534855434D505401` / CPROT/2, format 5 |
| CAP SHA-256 | `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27` |
| Load SHA-256 / size | `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048` / 28,067 bytes, 114 blocks |
| Manifest SHA-256 | `b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4` |
| APK SHA-256 | `5c7e2680ba811b01fda35309043bcd8a4c7e8cdd8071b981504e56d23bf2f2c4` |
| Bundle SHA-256 | `16e69a1e85074c58d88002f7a4b8ff7baa08df27e4ca32e429988f4a6b19918d` |
| Private app / version | `org.cashucard.capacitylab` / 4, `0.0.4-lab` |
| Fixture SHA-256 | `15990af5e270685eeb56d2ac0ac9395111090114466d71b4c55188ebc6b8343e` |
| Observed public key | `029dd01e01892aea31117992c581a277b09d72cd421d8318a24f381b9733444147` |

The fixture uses synthetic inputs with no mint value or external obligation.
This private invocation changed no manager keys and accessed no production
service or mint. Released firmware/CAP, provisioner assets and protocol remain
unchanged. ACS installation attempts remain paused; installation used NFC.

## Preparation and phone result

The named Pixel was available with the exact version-3 APK and no lab process.
All three earlier raw journal values matched saved hashes; the streamed journal
was absent. A single data-preserving upgrade installed the exact version-4 APK.
Its installed hash, version and signer matched. Before launch, the new archive
matched all earlier journals byte for byte, with the new key still absent.

The lab displayed the correct image/source and pre-arm state. One two-command
reader precheck (SELECT ISD / GET DATA CPLC) matched 09336320 and closed. The
controller was armed once, and the operator held the card at Pixel. Host
ADB/UI observation was withheld until the operator reported the terminal stop.

The journal confirms all 114 LOAD blocks, opener/main creation, format-5 setup,
all 128 inputs and all 128 outputs in 22 stages. Command 292 was SIGN, header
`b0740000`, with reply status `9000`. Failure was `elapsed-bound`; scope and a
completed signing-stage timer were absent, and no failed native exchange was
recorded. The controller sent no export, retirement or cleanup command after
that stop. The lab process was then stopped and its original database/sidecars
retained. All earlier journal values remained unchanged.

| Phone measurement | Stage envelope |
| --- | ---: |
| Connected session | 124,777 ms |
| LOAD stages, summed | 12,457.684 ms |
| Input-load stages, summed | 56,895.903 ms |
| Output stages, summed | 25,894.899 ms |
| Completed stage envelopes, summed | 101,628.512 ms |

The 120-second gate checks before further transmission and after reply
persistence. An admitted native call can return after the gate. The absent
signing timer prevents a standalone SIGN latency claim; subtracting stage sums
from session time would also include host persistence, queueing and teardown.

## Approved same-attempt recovery

Offline journal review met the plan's closed recovery admission. The operator
moved the same card to ACS and confirmed ready. One exclusive connection
matched CPLC, proved factory-version-1 keys and required the original baseline
plus exactly private main/opener/package. One private SELECT invoked recovery;
diagnostics and the journal-bound public key matched. Recovered status was
`[63,45,0,128,0,0]`, with scope index 0 / stable ID 1 / generation 1.

All 91 fixed pages were durably saved and assembled into the exact canonical
packet. Node and independent Python verified both signatures before a durable
verified-evidence barrier. One RETIRE for that exact scope acknowledged `[1]`;
status matched `[64,90,0,0,128,0]`. A fresh identity/factory/strict-registry check
then admitted deletion of private main, opener and package, once each. Final
registry had no applications and exactly the original three platform load files.
A separate host TLV decoder confirmed those saved records without further card
access. The reader closed successfully. Recovery completed 117 commands; it
sent no SIGN, installation or key change. Card 09336320 is verified blank.

| Reader measurement | Stage envelope |
| --- | ---: |
| Read/verify retained scope | 2,587.827 ms |
| Export all 91 pages, summed | 75,777.983 ms |
| Minimum / maximum export page | 808.949 / 867.139 ms |
| Scoped retirement | 3,306.480 ms |
| All completed stage envelopes, summed | 84,158.847 ms |

These are host operation envelopes, including transport and persistence. They
measure this reader recovery and do not establish NFC export latency. The
phone retained its 15-second native timeout, 120-second gate and 512-command
ceiling. Recovery retained its 30-second response bound, 120-second gate and
160-command ceiling.

## Retained evidence

| Evidence | SHA-256 or identifier |
| --- | --- |
| Approved plan | `2081730dca744c38bbaabae404564544622bd116d74c82a46afc00d37d584326` |
| Phone journal | `7dad6564c35241597dd7f7bc4605ddec3183e9124fe3b4d218526113c07c0732` |
| Recovery journal | `d2133f7b9e5fd519bcfd291d11aae2786d0b375781d25cfbac03066b825d0052` |
| Recovered packet bytes | `26cee14958a6e441326c8b4081303d1e5d8cb13c55d082d5f4deee32c1d4660b` |
| Packet ID | `9fd8baf1ba42ab086f0ddf233699675b4418437a8debf03d82b5d74625ce8a74` |

Protected originals stay under `compact-cursors-2026-10-31`: approval/pins,
before/after/terminal database archives, installed APK checks, precheck/start
intents, terminal UI, parsed phone journal, timing analysis, recovery admission,
complete recovery journal/packet, all three reader registry snapshots, final
state and independent saved-evidence check. The plan and its single-use intents/locks
are consumed. Further physical work requires a separately reviewed named plan.
