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
and Android legacy/round/adaptive assets at each density. iOS/store images are
opaque squares; Android applies its adaptive mask to a separate foreground.
