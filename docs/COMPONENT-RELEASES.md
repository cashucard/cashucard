# Component releases

Each component has its own release version and tag. A commit can affect several
components; release the components that need delivery. The pipelines below
require the external environment and signing setup listed here.
Release helpers require Python 3.13 (configured explicitly in their workflows).
Existing store identities, upload keys and Cloudflare recovery secrets remain the
authorities. Do not generate replacement signing keys to make CI pass.

## Identity and compatibility

| Component   | Current manifest identity                                        | New release tag              |
| ----------- | ---------------------------------------------------------------- | ---------------------------- |
| Firmware    | `applet/pom.xml`: 2.1.0; tracked CAP and APDU version remain 2.1 | `firmware-v2.1.0`            |
| cardkit     | `tools/cardkit/package.json`: 0.2.0                              | `cardkit-v0.2.0`             |
| Ops-service | `ops/package.json`: 0.1.0                                        | `ops-v0.1.0`                 |
| Provisioner | `apps/provisioner/package.json`: 1.0.0, build 10                  | `provisioner-v1.0.0-build.10` |

These examples identify source versions. Existing store build numbers remain
reserved; use a new build number for a new upload. The next mobile release needs
a new monotonically increasing build in package.json, Android Gradle and iOS
Info.plist. Historical `v2.1.0` and `provisioner-v1.0.0-beta.1` releases remain
valid historical records; do not move or retag them. Corrected firmware Maven
metadata does not alter the CAP.

Firmware's protocol major/minor follows SELECT/GET_INFO. An applet behavior change
ships its rebuilt CAP, hash and generated load-file pins together, with hardware
evidence as required by AGENTS. A host API change uses cardkit's independent
compatibility policy. Ops schema/recovery changes retain migration compatibility
and fences; redeploying old code is not a database rollback.

## Verification and tags

Update the component's manifest and changelog/release notes in a reviewed PR.
After merge, tag that exact main commit with its component tag. The release
identity guard is loaded from main, verifies tag ancestry before checking out
the requested commit, and validates its manifest/native versions and tag target; branches, mismatched versions and legacy tag shapes are rejected.

`component-release.yml` handles component tags or an explicit dispatch of an
existing tag. It calls the complete reusable CI workflow with `full: true` before
building artifacts. The source checkout is fixed to the verified commit.

- Firmware publishes the exact tracked `.cap`, its hash in `SHA256SUMS`, and
  provenance. The rebuilt CI CAP proves code equivalence but is not substituted
  for the pinned release file (its manifest contains a build timestamp).
- cardkit publishes an npm-installable `.tgz` with JavaScript, declarations,
  React Native source and declared public exports. There is no npm-registry push.
- Ops publishes a tarball containing separate staging and production bundles,
  their tagged Wrangler configurations and a file hash/provenance manifest.
- Provisioner builds signed AAB/IPA candidates into a **draft** GitHub release,
  with the unchanged pinned applet CAP attached.
  No automatic build-number increments, certificate creation or store submission
  occurs. TestFlight's internal-only export flag is explicitly false.

Component tag releases are serialized and never overwritten on a rerun. An
already published artifact remains authoritative; an existing unfinished draft fails with an explicit recovery instruction.
Inspect and finish or remove that abandoned draft before retrying; artifacts are
never silently replaced under a released tag. A failed candidate build
can be retried before publication with the same committed identity.

## Ops deploy

Configure GitHub environments `ops-staging` and `ops-production` with appropriate
reviewers/deployment branch rules, a narrowly scoped `CLOUDFLARE_API_TOKEN` secret
and public `CLOUDFLARE_ACCOUNT_ID` variable. Repository code cannot configure or
prove those controls; an organization administrator must set them.

Dispatch **Deploy versioned ops service** with an existing published `ops-vX.Y.Z`,
a target, and the exact tag repeated as confirmation. It verifies main ancestry,
downloads the artifact from that release, rejects unsafe archive paths/links,
checks every file against provenance and the tagged configurations, then uploads
the prebuilt target bundle with `--no-bundle --keep-vars`. Secrets are exposed only
to the final deploy step. Production and staging keep their own Worker/DO/R2
bindings, migration history, variables and cron schedules. This is not a bootstrap
or a credential rotation pipeline.

Before the first production use, validate a staging deployment, backup freshness,
operator access and recovery admission using the existing runbooks. A manual
production deployment remains an explicitly approved action. The workflow cannot
prove that the deployed service's live backup/custody state is ready.

## Provisioner signing and upload

Configure GitHub environment `provisioner-release`, protected for release tags.
Store existing signing material as environment secrets; never commit it:

| Platform | Secret inputs / public pin                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android  | `CASHU_ANDROID_KEYSTORE_BASE64`, `CASHU_ANDROID_UPLOAD_STORE_PASSWORD`, `CASHU_ANDROID_UPLOAD_KEY_ALIAS`, `CASHU_ANDROID_UPLOAD_KEY_PASSWORD`; variable `CASHU_ANDROID_UPLOAD_CERT_SHA256` pins the existing registered upload certificate. |
| Apple    | `CASHU_APPLE_DISTRIBUTION_P12_BASE64`, `CASHU_APPLE_DISTRIBUTION_P12_PASSWORD`, `CASHU_APPLE_PROFILE_BASE64`; existing team `H7UAM79QQP`, bundle `com.islandbitcoin.provisioner`, App Store profile including NFC TAG entitlement.          |

Mobile workflows use Ruby 3.3 with Bundler 2.6.9, matching the lockfile. The
unprivileged native CI job loads locked Fastlane and lists lanes without
credentials and round-trips a property list before any signed release/upload is
attempted. The lock uses CFPropertyList 3.0.8 because the later 3.0.9 release
[requires Ruby <3.2](https://rubygems.org/api/v2/rubygems/CFPropertyList/versions/3.0.9.json);
Fastlane/CocoaPods stay at their existing versions, with explicit macOS/Linux
platform variants.

The runners install locked dependencies and build against `https://ops.cashucard.org`.
The iOS runner must have Xcode/iOS SDK 26+; an older runner fails before building.
The Apple identity is imported into an ephemeral keychain; no match write,
automatic profile creation or version increment occurs. IPA checks verify the
signature, app version/build, distribution profile, team and NFC AID/entitlement.
Android checks the upload certificate pin, release signing, SDK and 16KB native
alignment. Build credentials are removed on exit. CI tests use an unrelated
public temporary Android signer, never the upload key.

Publish the reviewed candidate release when its artifact evidence is accepted.
Configure environment `provisioner-store` with protected manual uploads:

- TestFlight: `APP_STORE_CONNECT_KEY_BASE64` (existing API `.p8`),
  `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`.
- Play: `PLAY_SERVICE_ACCOUNT_BASE64` (scoped Play Developer service-account JSON).

Dispatch **Upload versioned provisioner candidate**, select TestFlight or Play,
choose Play `internal` or `beta` explicitly, and repeat the exact tag. The workflow
checks source provenance and checksums and uploads the existing signed artifact;
it does not rebuild. The verifier requires both native artifacts and the CAP,
checks every payload against the manifest, and requires complete checksum
coverage including the manifest itself. TestFlight uploads remain eligible for external review but
do not automatically assign external groups or bypass Beta App Review. Play
uploads use the chosen testing track and preserve listing metadata, images,
screenshots and country configuration. App Store production submission, review
video, tester eligibility and release approval remain separate store steps.

No signing/environment secrets were added or read as part of the repository PR.
Until these environments are configured, the pipeline definitions are ready for
validation but their signed native builds and live deployment are unverified.

## Focused CI

`tools/ci/affected.cjs` compares PR changes from their merge base; main push diffs
compare before/after trees directly, including force-push deletions. Renames keep
both paths. Unknown paths or missing history request the full matrix.

Documentation-only changes run policy checks and the gate. Website-only changes
run website checks (a changed installation guide also checks the CAP). Phone UI
changes run app type/lint/tests and both Metro bundles. Native/build changes also
run Android. Backup copier changes include the actual local WebDAV round trip.
Protocol, firmware, cardkit, ops auth/admission/schema, phone persistence/recovery,
recovery contract tests and workflow policy changes retain the full integration
matrix. Mint integration runs against local simulated mints.

`CI gate` always runs and requires selected jobs to succeed and unselected jobs
to be skipped. A failed detector, missing job, cancelled matrix or selected-but-
skipped job fails the gate. Configure branch protection to require **CI gate**,
replacing old individually required checks that now legitimately skip. The
workflow PR does not change branch protection by itself. Manual CI dispatch and
all release verification run the complete matrix.

The reusable-workflow token permissions follow
[GitHub’s permission inheritance rules](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
Fastlane action paths follow its
[documented directory behavior](https://docs.fastlane.tools/advanced/fastlane/);
lanes use the actual `ios/` workspace and never increment committed versions.
