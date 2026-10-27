# Security Policy

This repository builds the Cashu Card: the JavaCard applet that holds ecash on
a card, the host tools, the provisioner app, the ops service and cashucard.org.
A bug here can lose the money on a card, so reports are welcome and taken
seriously.

## Reporting a Vulnerability

Report it privately through this repository's security advisories:
<https://github.com/cashucard/cashucard/security/advisories/new> (the **Security** tab,
then **Report a vulnerability**). That makes a private advisory that only the
maintainers can see. You can also email
[security@cashucard.org](mailto:security@cashucard.org).

Please do **not** open a public GitHub issue, pull request or discussion for a
vulnerability.

Include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof of concept, affected commit or command)
- Any suggested remediation

## What to Expect

- Every report is read, and we will keep you informed as we investigate and
  remediate.
- Please allow us a reasonable window to fix the issue before public disclosure.

## Scope

This policy covers this repository: the applet in `applet/`, the host tools in
`tools/`, the provisioner in `apps/provisioner/`, the ops service, the website
and the documents. A flaw in the protocol itself is in scope too; the core is
specified in [cashucard/nut](https://github.com/cashucard/nut), and a private
report here reaches the same maintainers. Wallet and till apps that talk to the
card have their own policies, such as the Foxy app's in
[getfoxy/iOS](https://github.com/getfoxy/iOS) (`docs/SECURITY.md`).
