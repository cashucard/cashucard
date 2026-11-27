# Setup 17 recovered an interrupted J3R180 install

On November 27, 2026, an operator used a development-signed iPhone build of
Cashu Card Setup 1.0.0 (17) from `e9fc25c` to finish one interrupted installation.
The card was a J3R180 with a factory SCP02 manager. The app bundled the
released 3.1.0 CAP with SHA-256
`4ff8d8a20bf1106a3a31db5824a80d8626838d237c974157197d3fac1104845a`.

The installation stopped in build 16. An in-place update to 17 preserved the
saved attempt. On **Check card and retry**, the operator presented the same
card and the phone completed the installation. The phone showed **1 installed**
and **0 stopped**. Cashu Ops returned a completion receipt for the original
attempt and ordinal. The local record showed a saved retry intent and a
verified installation.

This physical test covered one iPhone and one SCP02 J3R180. Android NFC,
other chip profiles, holder activation and payments were outside this run.
