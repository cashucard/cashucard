# Max validation setup — persistence passed, no card operations

ENG-741, 2026-10-20. The operator explicitly approved the setup scope in
PR #27: dedicated HTTPS service, temporary public-CA trust on Max, isolated
native validation build/install, private sign-in and one-card batch persistence.
The scope stops before NFC, reservations or card writes.

## Scope and isolation

- Max: iPhone 13 Pro Max, UDID `00008110-001E4CC014D8401E`, app
  `com.islandbitcoin.provisioner`. Other connected phones are excluded.
- Intended later card: `cplc-v1:4790d3213041093361205547`, serial 09336120.
  The earlier approved USB read found no Cashu applet; this setup does not
  connect to or authenticate that card.
- Source: `3b4caa080e11e71c339bc993e811897389ab267a`, detached isolated
  checkout `/Users/dread/Repos/cashu-card-max-drill`.
- Local delta: HTTPS origin `https://mlod.local:8843`, local-network purpose
  string and the two validation gates enabled. Committed gates stay false.
  Final local diff SHA-256:
  `79277ebe185e100181caa8c889901302c0079044134115bd365e9b240a7e28b8`.
- Private state: dedicated `eng-741-max-2026-10-20` run directory under the
  documented protected Application Support location, separate from Pixel.
  Its database/master/login/TLS private files remain outside the repository.

## HTTPS preparation and checks

Rechecked Mac name `mlod`, Wi-Fi address `192.168.1.9`, free ports 8824 and
8843, and leaf validity (2026-10-21 03:04:30 UTC through October 24).
Started private `serve-max.cjs` with the explicit setup-approved flag.
It starts the dedicated Node service on loopback 8824 and the separate TLS
proxy on `192.168.1.9:8843`. The Pixel service/binding/state were unchanged.

Host checks passed with certificate verification enabled and the temporary CA
supplied explicitly: HTTPS readiness, correct server name, issued operator
sign-in, exact local-only mint list, sign-out and 404 for `/anchor/tip`.
A separate curl request to `https://mlod.local:8843/` with the same explicit
CA succeeded, checking Mac name resolution as well as IP routing. No insecure
TLS flag or Mac system trust-store change was used. The proxy blocks anchor,
holder and legacy registry routes; no mint/production request was issued.

Public CA DER SHA-256:
`731bb5e9d67e55f19e59746508b99ddeb9dd5c574384d147d676bb61784a9a67`.
Finder selected only the public `Cashu-Max-Validation.cer` for operator
AirDrop to Max. The operator was instructed to install the profile named
Cashu Max Validation 2026-10-20, enable its certificate trust and open the
HTTPS readiness page in Safari. The operator initially reported an untrusted
certificate after profile installation, then enabled full trust through
Settings → General → About → Certificate Trust Settings and confirmed the
page worked. This is operator-confirmed phone reachability, not an independent
screenshot/TLS capture. The profile should be removed after this validation
session.

## Native build checkpoint

Node 22.23.3; `pod install --deployment` completed with 72 pods and no tracked
lockfile delta. Prepared the isolated Node path in `.xcode.env.local`.
Started signed Release build for the exact Max UDID, team H7UAM79QQP, with
a dedicated DerivedData directory under private run state. Build succeeded;
`codesign --verify --deep --strict` passed. Compiled artifacts contain the
expected HTTPS origin and local-network purpose text. SHA-256 values:

- Signed executable: `d569666d6cb6bba4d3540b4f8b571080ab731302662066957ef21ec3b26d15eb`.
- Bundled JS: `9878e99cc36a2822dbc739744e8e77ae23e975dc00d31c589d55b93daa2f9285`.

Installed successfully on the exact Max UDID without uninstall or clearing
data. Did not launch over the operator's certificate Settings/Safari workflow.
A read-only devicectl copy of only the app's AsyncStorage directory confirms
preserved schema-2 state: device `afb0fc20-c68d-4159-8e7d-7eff4b8bf67b`,
batch null, active null, history empty. No foreign saved work needs clearing.

After operator-confirmed Safari success, launched the installed validation
app on Max and opened the separate Max login file in TextEdit on the Mac for
private operator entry. Requested Local Network permission approval if
prompted. The operator confirmed native-app sign-in succeeded. A host metadata check
found one live operator session, zero batches and zero attempts at that
checkpoint. The operator was then instructed to select the sole local test
mint, set count 1, create the batch and stop before Install. Batch creation
and restart persistence passed. Dedicated Max batch 1 has count 1, request
`ee1a6138-112c-4aea-b6a9-9bed91d231d6`, next ordinal 0, no active attempt
and empty history. The service holds one issued keyset and zero attempts.

Copied only the native AsyncStorage directory before and after the planned
terminate/relaunch and operator sign-in. The parsed saved workflow was exactly
equal, including device, origin, batch and configuration; the operator also
confirmed “0 of 1 attempts acknowledged” returned. Serialized workflow SHA-256:
`92cee83a5a1189adf903be0e933bdb94aad81795c14ad614ae00de5d59f21bf2`.
A consistent SQLite backup (`before-max-write.db`) and matching private runtime
were retained in the protected run directory. This proves setup persistence,
not recovery from an interrupted card write.

Before any write drill, the iOS NFC sheet needs to show the reached validation
pause and saved journal stage: it covers the React pause panel. That software
follow-up and a separately approved write scope remain outstanding.

No NFC, card authentication, applet installation, rotation or personalization is
authorized or performed by this setup.
