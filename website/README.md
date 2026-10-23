# Cashu Card protocol website

Public protocol introduction for https://cashucard.org. The operator console
remains independently hosted at https://ops.cashucard.org.

## Source and local preview

The site is buildless HTML and CSS in `dist/`. Fonts and images are local. Run
`python3 -m http.server 9117 --bind 127.0.0.1 --directory dist`, then open
http://127.0.0.1:9117. No package install or backend is needed.

`tools/browser-smoke.cjs` uses Node 22 and installed Chrome to check desktop
and phone layouts, direct protocol and code links, the three card finishes and
reduced motion. It creates and removes a separate browser profile. Set
`SITE_TEST_ORIGIN` to another preview origin if needed.

## Content and assets

Protocol facts come from lnflash/cashu-card's specification, APDU reference,
security model and license. The NUT-XX proposal remains a draft. Review the
source specification when changing the payment or ownership explanation.
Links point to the draft and the Cashu Card, Flash Mobile, Foxy iOS and Flash
POS repositories. Their role labels do not claim completed integrations.

The original Cashu mascot is from https://cashu.space/cashu-no-bg.png.
Physical card artwork is native HTML/CSS/SVG. `dist/concepts.html` is an
unindexed comparison of Ops Sage, Forest Emboss and Ivory Signal; Ops Sage is
on the homepage. Figtree fonts are bundled from the provisioner app under
the SIL Open Font License in `dist/assets/OFL.txt`. The site links to the
project's MIT license.

## Motion and accessibility

The hero card has a finite entrance and hover response. The system's
reduced-motion preference disables these animations. All content and links
work without JavaScript. The site uses no analytics, forms or browser
persistence. The hosting platform may set infrastructure cookies.

## Publication

The Sites project identity is tracked in `.openai/hosting.json`. Use the Sites
source workflow to push the exact source, package `dist/` and publish the saved
version. Preserve public access. Keep ops.cashucard.org and its service
configuration separate from this site.
