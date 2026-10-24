<a id="vision--why-a-cashu-bearer-card-exists"></a>
<a id="the-one-sentence-version"></a>

# Cashu Card purpose and scope

Cashu Card puts Bitcoin-denominated ecash on a physical NFC card. A holder
loads the card through a compatible wallet, taps to pay, and the merchant
settles with the mint when online. The protocol is open to wallets, terminals
and card vendors. Flash and Foxy are reference integrations.

This document explains the product goals. [Architecture](ARCHITECTURE.md)
describes the components, [design decisions](DECISIONS.md) record their
tradeoffs, and the [security model](SECURITY-MODEL.md) describes the risks.

<a id="the-problem-this-is-for"></a>
<a id="where-this-sits-in-flash"></a>

## Payment requirements

The project began with Flash's payment work in the Caribbean. Checkout
connectivity, access to a suitable phone, and account onboarding can each
prevent a small payment. A physical card gives the customer a way to carry
ecash and pay through a merchant's NFC reader. An offline terminal retains
the payment for later settlement.

The card holds mint-issued proofs locked to a spending key generated inside
its secure element. The holder's wallet manages setup and funding. The mint
remains responsible for honoring its proofs and maintaining reserves.

<a id="what-bearer-actually-means-here"></a>

## Possession and ownership

Possession gives access to the card's payment interface, subject to its PIN,
allowance and daily-limit settings. A separate holder-controlled owner key
administers those settings. The holder wallet is responsible for that key's
backup and recovery.

The spending key stays on the chip. Losing or destroying the card can strand
its funds; a backup of the owner key does not recreate the spending key.
The [security model](SECURITY-MODEL.md) explains PIN lockout, owner-key loss
and the optional recovery mechanisms retained in historical designs.

Provisioning is a separate administrative step. The provisioner installs the
applet and rotates manager keys. The holder then establishes ownership and
a PIN in a compatible wallet before funding the card. Manager-key custody
can affect the applet and its funds, so reset requires explicit authorization
and resolved value and settlement obligations.

<a id="what-this-replaces"></a>

## Earlier Flash card integration

Flash's earlier BoltCard integration used NTAG 424 DNA tags and AES keys to
authenticate access to a server-side balance through a BTCPayServer plugin.
FIP-04 records that internal design; its repository is private.

| Property | Earlier BoltCard integration | Cashu Card |
| --- | --- | --- |
| Payment authority | Server-side balance | Mint proofs and the chip's spending key |
| Checkout connectivity | Terminal contacts the balance service | Terminal can accept offline and settle later |
| Card operations | AES-128 CMAC authentication | secp256k1 / BIP-340 authorization |

<a id="why-cashu-specifically"></a>

## Cashu integration

Cashu provides compact proofs and published mint interfaces. NUT-11 P2PK
locks proofs to the card's public key. Reading stored proof data alone is
insufficient to authorize a payment; redemption requires the corresponding
signature. Readers can verify NUT-12 DLEQ evidence using the mint's keys.

The shared protocol core is [NUT-CCP](https://github.com/cashucard/nut/blob/main/CCP.md).
The [APDU reference](../spec/APDU.md) describes this applet's wire format and
its owner, clock, limit and NFC-tag profiles.

<a id="the-honest-trade-offline-double-spend"></a>

## Offline acceptance and settlement

The card commits a payment before releasing its signature. The mint decides
whether a proof is still redeemable. An offline merchant therefore carries
double-spend and mint-solvency risk until settlement. Proof validation alone
does not establish that a proof remains unspent.

Terminals retain payment and change obligations across interruptions and
settle promptly after reconnecting. Small card balances and merchant risk
limits bound exposure. See [Security model](SECURITY-MODEL.md) for the threat
analysis and tested mitigations.

<a id="status-the-milestone-is-behind-us--scale-is-ahead"></a>
<a id="what-would-make-this-project-fail"></a>

## Hardware evidence

The [September J3R180 report](HARDWARE_TEST_REPORT_2026-09-22.j3r180.md)
records early installation, signing and payment tests. The
[October full E2E report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-full-e2e.md)
records provisioning, holder setup, loading, online and offline payments,
reconnection settlement and an empty final balance. The
[mobile reset report](HARDWARE_TEST_REPORT_2026-10-23.j3r180-mobile-reset.md)
records authorized reset and fresh installation of the same test chip.

Each report identifies its card, devices, software and coverage. Fleet-scale
RF reliability, silicon tear behavior, supply, cost and independent security
review remain separate work.
