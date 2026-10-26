# iOS resource preparation check

2026-10-21 Pacific. Local checkout based on the reviewed release-preflight,
privacy and bench-gate changes. No pods, signing, archive, device operation or
store upload was performed.

Environment: Xcode 26.6 (17F113), iPhoneOS SDK 26.5, xcodeproj 1.28.1.

The target already compiles `CashuProvisioner/Images.xcassets`, which contains
AppIcon. It also referenced a nonexistent standalone `AppIcon.appiconset` in its
Resources phase, with a second unused file reference to the same missing path.
Resolving the target's actual resource references with xcodeproj failed before
the correction: `Missing resource: AppIcon.appiconset`.

Removed those redundant file/build/group references. The existing catalog,
icon images and `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` are unchanged.
Afterward every resource input resolves and AppIcon is in the single compiled
catalog. The 1024-pixel marketing icon has no alpha channel.

Apple's asset compiler then succeeded against that catalog with platform
`iphoneos`, minimum deployment target `15.1`, target device `iphone` and app icon
`AppIcon`, producing Assets.car, icon outputs and partial Info.plist in a temporary
local directory. Project plist syntax validation passed.

This proves resource paths and standalone asset compilation only. A clean signed
archive/export, aggregate privacy report, entitlement/profile continuity and
store validation remain release gates; an asset compile does not certify them.
