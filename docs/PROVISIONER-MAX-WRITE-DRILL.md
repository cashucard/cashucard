# Max write validation — proposed, not authorized

ENG-741 follow-up, 2026-10-20. The Pixel's three saved-boundary recovery
checks, Max's read-only post-check and local encrypted escrow restore passed.
They do not establish full iPhone installation/recovery. This document prepares
a separate iPhone run; it authorizes no phone, card or network action.
Both committed release gates remain false.

## Why sign-in needs preparation

The app defaults to `http://127.0.0.1:8821`. On Max that means Max itself.
Pixel's approved ADB reverse mapping reaches the Mac's loopback-only Node
service; that Android-specific mapping does not connect Max. The offline CPLC
probe correctly needs no service login. A failed Max sign-in is therefore not
evidence that the tested operator password is incorrect.

## Candidate equipment and isolated service

- Max: iPhone 13 Pro Max, UDID `00008110-001E4CC014D8401E`, native app
  `com.islandbitcoin.provisioner`. Last recorded iOS 26.5.2/build 23F84.
- Mac local hostname observed during preparation: `mlod`; Wi-Fi IPv4
  `192.168.1.9`. Recheck before execution; these are not immutable addresses.
- Candidate validation origin: `https://mlod.local:8843`, on the same local
  network. Confirm name resolution, iPhone reachability and certificate trust
  in the setup phase before any credentials or keys are exchanged.
- Dedicated nonproduction Node service on Mac loopback `127.0.0.1:8824`,
  with only a local test mint in its list. Do not reuse or modify the Pixel's
  live database, credentials, master, service origin or acknowledged batch.
- A separate TLS reverse proxy bound only to the confirmed Mac LAN interface
  on 8843, forwarding to that dedicated loopback service. The shared ops server
  stays loopback-only. Do not open a public tunnel, deploy a Worker, alter a
  firewall, contact production or broaden the shared server's binding.

These ports and routes are candidates, not configured infrastructure. Check
for occupied ports and document substitutions without stopping other services.
If local-network reachability cannot be established, revise the plan before
choosing a different transport or publicly reachable endpoint.

## Card prerequisite — missing

Identify a disposable test card with known factory-manager-key provenance.
The provisioned spare `cplc-v1:4790d3213041093363205547` is on assigned keys;
it is not a factory-key card. The original card ending 7515 returned an
unexpected applet version and has unconfirmed key provenance. Do not trial
keys, clear either card, or reset the completed Pixel attempt to create a
fresh candidate.

After the operator identifies a candidate, propose a bounded read-only USB
identity/version/state inspection on the named ACR122U, obtain its approval
and record the outcome. Pin its exact CPLC and any old full installation ID
before requesting write approval. Prefer a genuinely absent-applet card to
cover the fresh-install path. A present empty supported applet requires an
explicit replacement variant; any other state stops this plan.

## Setup phase — approval required before phone/network actions

1. Pin reviewed merged source and run the relevant software checks. Preserve
   the main checkout's unrelated edits and all Pixel recovery material.
2. Prepare a private dedicated run directory, separate master, issued operator
   and file-backed service database. Keep credentials/key material out of
   prompts, logs and shell history. Keep the operator's login human-typable
   without reusing the easier Pixel USB-only test credential.
3. Prepare a validation-only local certificate authority and a server leaf
   certificate for the exact validation name/address. Retain private keys
   only in protected files. The operator installs and trusts only the public
   CA certificate on Max through an explicit approved setup step. Never disable
   TLS verification or add an arbitrary-load exception to make sign-in work.
   Document certificate removal after testing; no certificate/profile changes
   are approved by this plan itself.
4. Start only the separately approved dedicated service/proxy. Verify TLS,
   certificate name and local-only mint list before the operator enters a
   password. No card key fetch or NFC is needed for this connection check.
5. In an isolated validation checkout only, set the existing service-origin
   constant to the verified HTTPS origin and enable the two local validation
   gates. Include a validation-only `NSLocalNetworkUsageDescription` explaining
   the connection to this Mac, then have the operator approve the system's
   local-network prompt. Apple's
   [local-network privacy guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
   requires a purpose string for local access; the current app plist lacks it.
   Record the exact diff and binary hashes. No product endpoint/config
   feature is needed for this one test. Do not commit or distribute the delta.
6. Obtain approval for Max's native signing/build/install/launch, retaining
   app data and identity. The operator signs in privately. Confirm there is
   no foreign active batch/journal; if there is, stop and reconcile it rather
   than clear storage or adopt the Pixel's journal.
7. Create one count-1 Max-owned batch and verify restart persistence before
   reserving an attempt. Retain a consistent private database/master snapshot
   and check recovery material before requesting card-write approval.

## Proposed write phase — separate final approval

Use one Max-owned batch, ordinal and attempt, tied to the approved card.

1. Arm `installation-verified-before-save`. On a verified absent-app card,
   install the pinned artifact, confirm that boundary with durable
   `install_intent`, and terminate the app without Continue/Stop. If a present
   empty applet is explicitly approved instead, inspect and close NFC for the
   full identity review, then rearm the pause before confirming replacement.
2. Reauthenticate into the same scope; arm
   `rotation-verified-before-save`, present the same card and adopt the complete
   new installation without a recovery sweep. Permit one assigned-set key
   rotation and confirmation. Verify durable `rotation_intent` and terminate.
3. Reauthenticate; arm `record-frozen-session-closed`, present the same card
   and recover assigned-key state without trial login, another PUT KEY or
   reinstall. Verify NFC closed and durable `record_pending`, then terminate.
4. Remove the card and reauthenticate. Verify unchanged frozen record, one
   matching receipt, same attempt/ordinal/full installation key, observed GP
   version and `ready_for_holder: false`. Retain completed private service
   recovery material. Stop; do not create another ordinal or personalize.

Stop on identity/state/version mismatch, failed authentication, partial install,
missing storage/service evidence or uncertain key provenance. No key retries,
factory reset, data clearing or automatic repair are permitted. The card ends
on its assigned keys. Full key values never enter shared evidence.

This repeats the three high-value process-loss boundaries on the other native
NFC platform while adding the fresh-card path if a suitable card is available.
It does not inject actual mid-LOAD tears, lost PUT KEY or HTTP replies, wrong
card/actor changes or unavailable storage; those checklist rows retain separate
scopes. No release gate or holder readiness follows automatically from this run.
