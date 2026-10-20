# Fastlane Setup for Cashu Card Provisioner

## One-time Setup (run once)

```bash
cd /Users/dread/Repos/cashu-card/apps/provisioner

# 1. Install gems (already done)
bundle install

# 2. Authenticate with Apple (one-time, opens browser)
fastlane fastlane_spaceauth

# 3. Sync certificates/profiles from shared repo
# This pulls existing certs or creates new ones for com.islandbitcoin.provisioner
bundle exec fastlane match appstore

# If the new bundle ID needs a new profile, match will create it
# and commit to the shared flash-mobile-certificates repo
```

## Daily Release Commands

```bash
# Build + upload to TestFlight (internal) in one command
bundle exec fastlane beta

# Or just build locally (no upload)
bundle exec fastlane build_only

# Bump version (patch/minor/major)
bundle exec fastlane version bump_type:patch
# or: bundle exec fastlane version bump_type:minor
# or: bundle exec fastlane version bump_type:major
```

## What Each Lane Does

| Lane | Purpose |
|------|---------|
| `beta` | Match certs → bump build # → build → upload to TestFlight (internal) |
| `build_only` | Match certs (readonly) → bump build # → build IPA only |
| `version` | Bump version in Info.plist + build.gradle |

## Adding Screenshots (later)

```bash
# When you want to automate screenshots
bundle exec fastlane snapshot
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "No matching provisioning profiles" | `fastlane match appstore --force` to regenerate |
| "App ID not found" | Add `com.islandbitcoin.provisioner` to Apple Developer portal, then re-run match |
| "Team not found" | Check `team_id` in Appfile matches ASC |
| Build fails on Hermes | `cd ios && rm -rf Pods Podfile.lock && pod install` |
