# Cashu Card brand

The Cashu Card mark is the Cashu cashew drawn as a card's chip, the part of the card that makes its key and keeps it. This folder holds the brand marks, visual assets and architecture diagrams. `generate.swift` draws the mark and its derived artwork from one set of shapes and colors ([D119](../docs/DECISIONS.md#d119)): change it, run it on macOS, and commit what it writes.

```sh
swift brand/generate.swift
```

## The mark

| File | Use |
| --- | --- |
| `mark/cashu-card-mark.svg` | The color mark, in the chip's lime-gold gradient: on the deep green and other dark grounds. |
| `mark/cashu-card-mark-green.svg` | One color, deep green: on light grounds, in print and for embossing. |
| `mark/cashu-card-mark-white.svg` | One color, white: on photos and colored grounds. |
| `mark/cashu-card-mark-small.svg`, `-small-green.svg` | The plain cashew, for 40 px and below, where the chip's lines would be under a pixel wide. |
| `mark/*-1024.png` | The color, green and white marks as 1024 px PNGs. |

## The icon

| File | Use |
| --- | --- |
| `icon/cashu-card-icon.svg`, `-1024.png` | The app icon: the mark at 62% of the side, on the deep green lit from the upper right. It is square; iOS and the stores round the corners. |
| `icon/cashu-card-avatar-400.png` | Social profiles. The mark sits smaller, so a circle crop keeps room around it. |

## The wordmark

`lockup/cashu-card-lockup-on-dark` and `-on-light` (SVG and PNG) set the mark beside "cashucard": "cashu" in Figtree 800 and "card" in Figtree 400, tracked in by 0.065 em, with the mark at 1.25 em and a 0.32 em gap. The letters are outlines, so the files work without the font.

## Web

`web/favicon.svg` (the plain cashew on a rounded tile), `favicon.ico` (16, 32 and 48 px), `favicon-32.png`, `apple-touch-icon.png` (180 px), and `icon-192.png` and `icon-512.png` for a web app manifest.

## Colors and type

`tokens.json` and `tokens.css` list every color with its use. The main ones:

| Token | Value | Use |
| --- | --- | --- |
| `ground` | `#10271E` | Deep green: the background of the site, the icons and the film. |
| `ink` | `#EDF3E7` | Text on the deep green. |
| `lime` | `#D3F39A` | The accent: buttons and highlights. |
| `chip-light`, `chip-mid`, `chip-deep` | `#ECF9BD`, `#CFE98F`, `#A6CC6A` | The mark's gradient, corner to corner. |
| `paper` | `#F3F7EE` | Light background. |

Figtree is the typeface for every word in the brand. `fonts/Figtree-Variable.ttf` covers every weight, under the SIL Open Font License in `fonts/OFL.txt`.

## Using the mark

- Keep clear space of at least a quarter of the mark's height on every side.
- Use the full mark from 41 px up, or 10 mm in print, and the plain cashew below that.
- Put the color mark on the deep green or another dark ground, the green mark on light grounds, and the white mark on photos.
- Keep the mark's shape, angle and gradient as drawn. Stretching, turning, outlining or recoloring it makes a different mark.

## Print: merchant materials

These are ready for when merchant materials are wanted. While Cashu Card is experimental, they stay here in the library. `generate.swift` draws each piece three ways: an SVG in millimetres, a 300 dpi PNG and a vector PDF. Send the PDF to a printer. Its TrimBox marks the cut and its BleedBox the edge of the artwork, and every word is outlined, so no font is needed.

| File | Size | Use |
| --- | --- | --- |
| `print/sticker/cashu-card-accepted-here-dark` and `-light` | 100 mm circle, plus 2 mm bleed (104 mm artwork) | A door or window sticker: the mark, "Cashu Card accepted here" and cashucard.org. Die-cut on the 100 mm circle. The dark one suits glass; the light one suits dark doors and walls. |
| `print/counter-card/cashu-card-counter-card-dark` and `-light` | A6 portrait, 105 x 148 mm, plus 3 mm bleed (111 x 154 mm artwork) | A card for the counter or an A6 stand: "Pay with Cashu Card", a phone with a card laid on it, "Tap your card on the phone to pay.", cashucard.org and "Cashu Card is experimental." |

Keep words 4 mm inside the sticker's cut and 6 mm inside the counter card's trim. The tap is shown as a card on a phone, without the contactless symbol, which is EMVCo's mark.

## What uses it

`generate.swift` writes the provisioner's app and store icons in `apps/provisioner/` (iOS catalogs, Android launcher and adaptive icons, the Play icon and the feature graphic). cashucard.org's favicon and header, the card face in the film and the social kit move to the mark next.

## Architecture diagrams

[The Cashu Card ecosystem](diagrams/README.md): editable desktop and phone SVGs, a published preview, connection legend and hosting notes. The diagram generator writes both the library assets and their website copies.
