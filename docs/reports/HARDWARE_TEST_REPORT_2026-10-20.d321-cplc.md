# USB reader CPLC identity check

ENG-741, 2026-10-20, approximately 20:53–20:54 UTC. The card the operator
placed on the connected USB reader answered unauthenticated CPLC reads on
three successive PC/SC connections. All three returned the same complete
CPLC payload and `cplc-v1:4790d3213180072976207515`.

This establishes repeatable identity reads on this card through this reader.
It does not establish stability through reinstall, phone behavior, or fleet
uniqueness. No installation, key rotation, authentication or PIN operation ran.

## Approved scope and equipment

The operator identified the card currently resting on the connected USB reader
for the proposed read-only identity check. The scope was reader identification,
card-manager selection and CPLC reads across repeated connections. No other
card or phone was accessed.

| Item | Observation |
|---|---|
| Reader | Sole enumerated PC/SC reader, `ACS ACR122U PICC Interface` |
| Interface | Contactless through the USB reader, PC/SC T=1 |
| Card | Operator-presented card; product/model not independently identified |
| ATR | `3B8A80014A546178436F7265563150` |
| CPLC IC fabricator | `4790` |
| CPLC IC type | `D321` |
| CPLC IC fabrication date bytes | `3180` |
| CPLC IC serial | `07297620` |
| CPLC IC batch identifier | `7515` |
| Host | macOS 26.5, aarch64 |
| Java | Zulu OpenJDK 17.0.19 |
| Tool | GlobalPlatformPro v25.10.20, invoked by its full jar path |
| Repository | `304856a`, ENG-741 contract branch, before this report |
| Installed applet/CAP | Not inspected or changed by this check |

The tracked reference CAP is `applet/target/cashu-javacard-2.1.0.cap`, SHA-256
`f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5`.
That identifies the repository artifact. The card's installed CAP was not attested.

## Procedure and observations

Enumerating readers found only the ACR122U. Each subsequent invocation opened
the explicitly named reader and requested exactly these raw APDUs:

```text
00A4040008A000000151000000   SELECT card manager
80CA9F7F00                   GET DATA CPLC
```

Both answered `9000` on all three connections. The full CPLC TLV was:

```text
9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000
```

GlobalPlatformPro then automatically sent `00A4040000`, a default SELECT that
returned the card manager's FCI with `9000`. Thus the observed sequence was
three APDUs per connection, nine total. The tool printed its default-factory-key
warning, but the traces contained no INITIALIZE UPDATE, EXTERNAL AUTHENTICATE
or other key operation. Connections 2 and 3 were checked against the explicit
three-APDU allowlist and the first observed identity before continuing.

The tool ended each connection with `SCardDisconnect(..., false)`. The card
remained on the reader. The test used fresh PC/SC connections while leaving the
card in place. Physical remove/replace, RF power-cycle and card-reset behavior
remain untested.

## Contract comparison

Using the fields selected by
[`PROVISIONER-RECOVERY.md`](../PROVISIONER-RECOVERY.md):

```text
4790 || D321 || 3180 || 07297620 || 7515
-> cplc-v1:4790d3213180072976207515
```

The existing owner [gp-info capture](../../tools/cardkit/gp/test/fixtures/gp-info.txt)
names another card, serial `09336320`, and yields
`cplc-v1:4790d3213041093363205547`. The two observed composites differ. Neither
that two-card observation nor repeat reads prove global uniqueness or prevent
cloning of these public values.

## Not covered

- CPLC reads through the Pixel or iPhone, or across physical removal/reset.
- Identity before and after installation, deletion or manager-key rotation.
- Cashu applet version, public key, value, owner, PIN state or installed CAP.
- Key authentication, personalization, provisioning or interrupted-run recovery.
- The cardkit CPLC parser or app journal; neither was implemented at the time
  of this check.

The automated identity/recovery gate remains closed pending implementation and
the separately approved phone/install verification in the contract. Existing
owner fixtures were read but never modified; this report is new evidence.
