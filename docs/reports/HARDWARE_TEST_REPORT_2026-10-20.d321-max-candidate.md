<a id="max-candidate-card--read-only-usb-discovery"></a>

# Max candidate card: read-only USB discovery

ENG-741, 2026-10-20. The operator supplied another factory card for the
proposed Max run and placed it on the named ACS ACR122U PICC Interface after
the stated identity/applet inspection scope. One PC/SC connection used
SCARD_LEAVE_CARD and the existing preflight module's exact command constants.
No authentication, retries or writes were attempted.

| Read | Outcome |
|---|---|
| SELECT ISD `00A4040008A00000015100000000` | 9000 |
| GET CPLC `80CA9F7F00` | 9000; strict 45-byte TLV framing and usable serial |
| SELECT full Cashu applet `00A404000BF04341534855434152440100` | 6A82, no response data; stopped |

New candidate: **`cplc-v1:4790d3213041093361205547`**, serial **09336120**.
The Cashu applet is absent. No GET_INFO, public installation key or NFC-tag
read followed. This is not a package/memory inventory or proof of universal
blankness. The operator reported factory manager-key provenance. Trial authentication
was not performed. No CAP was installed or identified by this check.

The completed Pixel spare is a different chip:
`cplc-v1:4790d3213041093363205547`, serial **09336320**. Both full IDs end in
5547; that suffix must not be used to choose between these cards. Subsequent
Max approval and evidence must use the full candidate ID and serial 09336120.
The previously provisioned card remains on its assigned keys and is outside
the proposed Max write scope.
