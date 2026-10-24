# App icon

The icon is the Cashu Card mark, the cashew drawn as a card's chip, on the
site's deep green (D119). `brand/generate.swift` draws it, with the rest of the
brand library in [`brand/`](../../../../brand/). Regenerate on macOS from
anywhere:

```sh
swift brand/generate.swift
```

This writes both existing iOS catalogs, the 1024px master, the 512px Play icon,
Android legacy/round/adaptive assets at each density, the legacy upload icon
path, and both store feature-graphic paths. iOS/store icon images are
opaque squares; Android applies its adaptive mask to a separate foreground.
Icons of 40px and below, such as iOS's 20pt@2x, use the plain cashew: there the
chip's lines would be under a pixel wide.

The Play asset is a 32-bit RGBA PNG with a fully opaque background, following
[Google Play's icon format](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).
iOS catalog/master PNGs use RGB with no alpha channel.


Store upload assets use this same mark. The Play listing copy is in
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
