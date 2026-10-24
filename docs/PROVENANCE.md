# Provenance

How to check that a commit, tag or release file came from this project, and the
record of everything released before signing was in place.

## The signing key

Releases, tags and commits are signed with Jabari Ennis's OpenPGP key:

```
ed25519 3139 A2E7 74DA F732 8533  D0EC 0A89 7098 CF0A 7E5B
Jabari Ennis (Dread) <github@bobodread.com>
```

Commits from 2026-10-24 are signed as `github@bobodread.com`. The key also
carries `dread@islandbitcoin.com`, the address on the first commits and tags
signed that day.

The public key is [`docs/signing-key.asc`](signing-key.asc), and GitHub serves
the same key at <https://github.com/islandbitcoin.gpg>. It expires on 2028-07-02.

## Checking a release file

Every release file has a detached signature beside it, `<file>.asc`:

```bash
gpg --import docs/signing-key.asc
gpg --verify cashu-javacard-2.1.0.cap.asc cashu-javacard-2.1.0.cap
```

Files released by the release workflows from 2026-10-24 on also carry a GitHub
build attestation, signed through Sigstore, that names the commit and workflow
run that built them:

```bash
gh attestation verify cashu-javacard-2.1.0.cap --repo cashucard/cashucard
```

## Checking history

Each release has a signed annotated tag beside its original tag, named
`signed/<tag>`, pointing at the same commit. A signed tag also covers every
commit before it, because each commit's hash includes its parent's.

`provenance/2026-10-24` is a signed tag on `main` as of this record. It vouches
for the whole history up to that commit, including the 244 commits on `main`
that GitHub shows as unsigned: direct pushes made before commits were signed.
Commits merged through pull requests carry GitHub's own signature.

From 2026-10-24, `main` requires signed commits.

## Releases before 2026-10-24

Each file below was downloaded from its GitHub release on 2026-10-24, matched
against the hash the release published, and signed. Each CAP is byte-for-byte
the CAP committed at its tag (`applet/target/`), and CI checks that the
committed CAP is built from the source beside it. The AAB and IPA are signed
store builds and cannot be rebuilt byte-for-byte from source; their signatures
vouch that they are the files published.

| Release                                         | Commit    | File                       | SHA-256                                                            |
| ----------------------------------------------- | --------- | -------------------------- | ------------------------------------------------------------------ |
| `v2.1.0` (Cashu Card 2.1.0)                     | `be60adf` | `cashu-javacard-2.1.0.cap` | `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` |
| `provisioner-v1.0.0-beta.1`                     | `0fc2b88` | `cashu-javacard-2.1.0.cap` | `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` |
| `provisioner-v1.0.0-build.9`                    | `f98792b` | `cashu-javacard-2.1.0.cap` | `f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5` |
| `provisioner-v1.0.0-build.9`                    | `f98792b` | `app-release.aab`          | `2c3da0e8ca016f9e933a5fe8416ce5657cd58d27a06c1a635fd70473adf82b40` |
| `provisioner-v1.0.0-build.9`                    | `f98792b` | `CashuProvisioner.ipa`     | `ba39b0450a34f12c2b17b2c019be7b47e933427d2f6b2f8fd9c7a5caa2428727` |
| `provisioner-v1.0.0-build.9`                    | `f98792b` | `release.json`             | `9488a8d07b62afe8abf2a3bdabc60381a1171cb8ce085721444789e437c6aef7` |
| `v2.0.0` (in `cashucard/javacard`)              | `bced1c4` | `cashu-javacard-applet-2.0.cap` | `59f66673a0dda7993c2e2e432e5e3e3d8203cf09c7edb3a4f79e5016a90db787` |
| `v2.0.0-rc.1` (in `cashucard/javacard`)         | `9574bc7` | `cashu-javacard-applet-2.0.cap` | `59f66673a0dda7993c2e2e432e5e3e3d8203cf09c7edb3a4f79e5016a90db787` |
| `v0.6.0` (in `cashucard/javacard`)              | `7a96102` | `cashu-javacard-applet-0.6.cap` | `e3a2e58b8a1e178272a442545bc512e82b7f4750ab76c494edbafe5fc865937b` |

The `.sha256` files and `SHA256SUMS` published with these releases are signed
too. The `v0.2.0` release in `cashucard/javacard` and the `v0.1.0` tag in
`cashucard/client` have no files; their signed tags cover them.

The other repositories of the project, `cashucard/javacard`, `cashucard/client`
and `cashucard/nut`, carry the same signed tags and the same key.
