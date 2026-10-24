# App icon

`cashu.png` is the exact mascot served at
[https://cashucard.org/assets/cashu.png](https://cashucard.org/assets/cashu.png),
matching `website/dist/assets/cashu.png`. The square icon uses the website's
`#10271E` background. Pixel edges are preserved with nearest-neighbor scaling.

Regenerate on macOS from the repository root:

```sh
swift apps/provisioner/scripts/generate-app-icons.swift
```

This writes both existing iOS catalogs, the 1024px master, the 512px Play icon,
Android legacy/round/adaptive assets at each density, the legacy upload icon
path, and both store feature-graphic paths. iOS/store icon images are
opaque squares; Android applies its adaptive mask to a separate foreground.

The Play asset is a 32-bit RGBA PNG with a fully opaque background, following
[Google Play's icon format](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).
iOS catalog/master PNGs use RGB with no alpha channel.


Store upload assets use this same mascot. The Play listing copy is in
`../play-assets/listing-en-US.txt`. The current Play screenshots are unedited
1080 × 1920 captures of Cards home and the read-only status screen from build
10's app code in an isolated Android 35 emulator. A local fixture account was
used; no physical card, production account or provisioning operation was used.
They replace the historical demo/PIN-personalization screenshots.

Before submitting a store update, verify the selected build and the listing
icon separately. Uploading a new launcher icon does not replace Google's
listing image. An Apple App Store draft can also retain an older selected build.
The 1024px icon in the submitted build remains the source for Apple's build
icon; see [Apple's app icon guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon/).
