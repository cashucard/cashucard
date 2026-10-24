# Fastlane Setup for Cashu Card Provisioner

## One-time Setup (run once)

From `apps/provisioner`, install the locked Ruby dependencies with
`bundle install`. The current
`Fastfile` uses an existing Apple distribution identity and provisioning
profile. It has no certificate-creation or profile-sync lane. Keep signing
material in the protected release environment described in
[`docs/COMPONENT-RELEASES.md`](../../../docs/COMPONENT-RELEASES.md); preserve
the existing signing identity and profile.

## Daily Release Commands

```bash
# Build an iOS Release IPA with the existing profile
CASHU_APPLE_PROFILE_NAME="<existing profile name>" bundle exec fastlane ios build_release

# Upload an already signed IPA to TestFlight
CASHU_RELEASE_IPA="<reviewed IPA path>" \
APP_STORE_CONNECT_KEY_ID="<key id>" \
APP_STORE_CONNECT_ISSUER_ID="<issuer id>" \
APP_STORE_CONNECT_KEY_FILE="<protected .p8 path>" \
  bundle exec fastlane ios upload_testflight

# Upload an already signed Android AAB to an explicitly selected test track
CASHU_RELEASE_AAB="<reviewed AAB path>" \
CASHU_PLAY_SERVICE_ACCOUNT_FILE="<protected service-account path>" \
CASHU_PLAY_TRACK=internal \
  bundle exec fastlane android upload_play
```

Fastlane builds the iOS IPA and uploads existing signed artifacts. Version
changes, signing identity creation and candidate-artifact review follow the
component-release workflow.

## What Each Lane Does

| Lane | Purpose |
|------|---------|
| `build_release` | Build an iOS Release IPA with the configured existing distribution signer and profile |
| `upload_testflight` | Upload the path in `CASHU_RELEASE_IPA` using the supplied App Store Connect API key |
| `upload_play` | Upload the path in `CASHU_RELEASE_AAB` to the selected `internal` or `beta` track |

## Adding Screenshots (later)

Store screenshots are managed through the reviewed store-release process. The
current `Fastfile` has no screenshot lane.

## Troubleshooting

| Issue | Next step |
|-------|-----------|
| "No matching provisioning profiles" | Check the existing profile name, team, bundle ID and NFC entitlement with the release owner. Keep the registered identity unchanged. |
| "App ID not found" | Confirm `com.islandbitcoin.provisioner` exists in the Apple Developer account before using the existing profile. |
| "Team not found" | Confirm `team_id` in `Appfile` matches the reviewed team. |
| Build fails on Hermes | Follow the iOS dependency recovery steps in the app README and component-release guide. |
