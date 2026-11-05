# 07297620 Pixel creation: main creation unconfirmed

The operator reported **Stopped / create-01 / 124 commands /
transport-uncertain**. The preserved phone journal independently confirms that
result. All 114 LOAD blocks and opener creation were acknowledged; main creation
has no reply status word. The main instance may or may not exist. This is not a
confirmed card refusal, completed installation or payment qualification.

## Bound device and image

The consumed [creation-only plan](HARDWARE_PLAN_2026-11-05.pixel-07297620-create.md)
is `pixel-07297620-create-v1`. Its signed controller source is
`eefe1235ccbd647b6e9a6f56de5fc75d769f958e`. The
[phone admission](PHONE_READINESS_2026-11-05.pixel-07297620-create.md) and
[build inspection](BUILD_READINESS_2026-11-05.pixel-07297620-create.md) record
the exact standalone app; no production app, CAP or SDK policy was replaced.

- Card: `cplc-v1:4790d3213180072976207515`, serial **07297620**, batch **7515**.
- Phone: Pixel 8 Pro (`husky`), USB serial `42201FDJG00048`, Android 17 / API 37,
  build `CP3A.261005.005`, security patch `2026-10-05`.
- App: `org.cashucard.card072creation`, version code 1,
  `0.0.1-card072-lab`; journal key `cashucard-card072-creation-v1`.
- APK SHA-256:
  `0c3e9f1b8b7d41c2f539d81506742191537b0e164a55c2301d4c6b98d2366988`.
- Image source: `96eb11df58c0969e2d00a1d52a2ca726f8d2d971`.
- Image manifest SHA-256:
  `b2adaa4252e1ad988cecb0ff31e001ce22f2be0ce00a5c1b25dbb0d451e5bca4`.
- Private CAP SHA-256:
  `b22479280337d4192b4001f06a38d136d69523c38c90f88cab00f2b9e374ce27`.
- Load SHA-256:
  `74caa34bc570427b4a292b6696328ed499c3967e13d8ab11066dfb103a4ac048`,
  28,067 bytes in 114 blocks; package `F04341534855434D5054`.

Before the phone write, the fresh NFC identity matched and one proved public
factory version-1 SCP02 channel opened. The complete initial registry had no
applications and exactly these four platform load files. An independent local
decoder compared full canonical E3 frames against the card-specific profile,
including CardDocLite; it did not merely compare AID names.

| Platform load-file AID       | Version |
| ---------------------------- | ------- |
| `A0000001515350`             | 255.255 |
| `A00000016443446F634C697465` | 1.0     |
| `A0000000620204`             | 1.0     |
| `A0000000620202`             | 1.3     |

## Observed commands and limits

The journal contains 124 sequential command receipts, including the unconfirmed
last command. INSTALL for load, all 114 LOAD blocks and opener creation received
`9000` with the permitted GP acknowledgement body. The final block took about
1,137.237 ms and opener creation about 220.686 ms according to recorded transport
await timings. Main creation was then attempted once.

| Command | Stage                 | Public header | Reply                   |
| ------- | --------------------- | ------------- | ----------------------- |
| 121     | LOAD block 113        | `84E80070`    | `9000`, body `00`       |
| 122     | LOAD block 114        | `84E88071`    | `9000`, body `00`       |
| 123     | Create opener `...4D` | `84E60C00`    | `9000`, body `00`       |
| 124     | Create main `...01`   | `84E60C00`    | No status word retained |

The controller stopped with `transport-uncertain`. It retains neither a bounded
native failure category nor the failed call's duration. The journal therefore
cannot distinguish tag loss, native timeout, another transport failure, or an
operation completing without its reply reaching the caller. It supplies no
basis to diagnose EEPROM exhaustion, applet crypto failure or a defective card.

The recorded Android IsoDep timeout was 15,000 ms; maximum transceive was 65,279
bytes. The connection-to-terminal interval was 21,841 ms. These are session
metadata and elapsed wall time, not a measurement of the failed call. The plan's
command ceiling was 160, with a 120-second transmission gate and a bounded
response wait. Teardown was requested; physical NFC closure was not independently
observed.

No installed-registry listing, main SELECT, diagnostics, public-key read or final
CPLC check was reached. Current installed object membership and the new card key
remain unknown. No SETUP, proof loading, signing, export, retirement, DELETE or
manager-key change occurred. Package and opener acknowledgements alone do not
establish a complete, usable installation. Earlier USB attempts on this serial
also ended at unconfirmed main creation, but different transport/image evidence
does not establish a common cause.

## Evidence collection and independent review

After the operator's terminal report, collection force-stopped only this new
app and copied only its own AsyncStorage databases through `run-as`. The archive
was checked for safe paths/types and bounded size before extraction into a new
private directory. SQLite was opened read-only and only the fixed journal key
was selected. The exact stored JSON bytes were preserved without backfilling
missing telemetry. No reader connection, NFC request, card command, app-data
clear, reinstall, reset or production access followed the stop.

Evidence is under
`~/.cashucard/pixel-07297620-create-2026-11-05/collection-1/`:

| File                |  Bytes | SHA-256                                                            |
| ------------------- | -----: | ------------------------------------------------------------------ |
| `app-databases.tar` | 43,520 | `3f44efb97d9967166b0f5b0fca271de6242d934c195b08d1ba3116f54c535fd8` |
| `journal.json`      | 21,104 | `30f018b5ebb75bceddf607145e6db381c4a4818d3a62c5037fa49b24ffae3986` |
| `review.json`       |    994 | `f3f60ef04a05b6da24b4a513bbf5f98d20e5e58371b7a9f5032c5cbf2da1dfb7` |

Offline independent assertions verified the pinned build/image bindings, exact
initial baseline, chronological receipts, 114 acknowledged LOAD blocks, opener
acknowledgement, unconfirmed main command and absence of subsequent operations.
The app remains stopped and its consumed journal remains intact. All older
evidence and apps remain preserved. No software behavior changed in this report;
no new native build or hardware test was run after collection.

## Next boundary

Keep this card aside. The approved plan says: "No automatic cleanup, second
install, key guess, reset or new plan is authorized." This report consumes no
successor authorization and authorizes no further device access.

The next useful operator decision is whether to prepare a fresh bounded,
read-only inspection of this exact card on the named ACS reader: match CPLC,
prove the public factory channel once, read complete application/load-file
registries, and rematch CPLC. Only if the exact main instance is present would
the proposed scope include its SELECT, public diagnostics and public key.
There would be no INSTALL, LOAD, DELETE, SETUP, signing, key change or retry.
The resulting plan and implementation need review and approval before access.

Creation and hardware payment qualification remain incomplete. The original
acceptance condition is still an offline till's retained signed payment relayed
by an online phone, followed by independent exact-once merchant recovery.
