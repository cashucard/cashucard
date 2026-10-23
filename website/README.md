# Cashu Card protocol website

Public protocol introduction for https://cashucard.org. The operator console
remains independently hosted at https://ops.cashucard.org.

## Source and local preview

The site is buildless HTML, CSS and one script in `dist/`. Fonts, images and
the film are local. Run `node tools/preview.cjs` (Node 22), then open
http://127.0.0.1:9117. The preview applies `dist/_headers` and answers
byte-range requests, as the host must: Safari plays the film only from a
server that returns 206 for a range. No package install or backend is needed.

`tools/browser-smoke.cjs` uses Node 22 and installed Chrome to check desktop
and phone layouts, footer protocol and code links, the three card finishes,
the film (autoplay once in view, pause out of view, replay, sound, chapters,
arrow keys), reduced motion, the page without JavaScript, and that the host
answers ranges and applies `_headers` with no policy violations. It creates
and removes a separate browser profile. Set `SITE_TEST_ORIGIN` to another
preview origin if needed.

## Content and assets

Protocol facts come from lnflash/cashu-card's specification, APDU reference,
security model and license. The NUT-XX proposal remains a draft. Review the
source specification when changing the payment or ownership explanation.
The hero describes offline terminal acceptance and later mint settlement as
separate events; an offline tap does not guarantee final settlement.
Footer links point to the draft and the Cashu Card source, with Flash Mobile,
Foxy iOS and Flash POS grouped under Apps. The links do not claim completed
integrations.

`dist/film/` holds the 48-second film at 1080p, a 720p copy that narrow
screens load, and its poster; `dist/assets/og.jpg` is the share image, from
the film's end frame. `dist/seq/tap-1/` holds the 96 rendered frames of the
"One tap, step by step" section and `anchors.js`, the points its callouts
follow. Steps 1 to 5 take 0.15 of the frames each and the settle step the last
0.25, because in it the card leaves and a night passes before the till comes
online; the steps' `data-a` and `data-b` and the callouts in `motion.js` use
those bounds. Media names carry a version (`-1`) because `_headers` caches `/film/*`
and `/seq/*` for a year: publish a new render under a new number. Both are
rendered with a private fork of the Daylight Fob film renderer (a WebGL2 scene
driven by headless Chrome, with a synthesized score at -18 LUFS and a
look-ahead limiter rather than clipping); the render
source stays outside this repository. What they state comes from
`spec/NUT-XX.md` and `spec/APDU.md`: the card makes its key on the chip and
keeps it there, a wallet writes pieces into its 128 slots, the till names the
pieces, the card signs once for the payment and burns them, and an offline
till accepts the payment and settles with the mint later. The bill is an
exact amount because an offline till cannot finish the card's change. The
phone and till screens are generic and name no wallet or point-of-sale app;
the film and the steps show the protocol itself, so app and wallet names
stay off them.

The original Cashu mascot is from https://cashu.space/cashu-no-bg.png.
Physical card artwork is native HTML/CSS/SVG. `dist/concepts.html` is an
unindexed comparison of Ops Sage, Forest Emboss and Ivory Signal; Ops Sage is
on the homepage. Figtree fonts are bundled from the provisioner app under
the SIL Open Font License in `dist/assets/OFL.txt`. The site links to the
project's MIT license.

## Motion and accessibility

The hero card has a finite entrance and hover response. The steps section
scrubs its frames as the page scrolls on wide screens; on narrow screens and
with reduced motion it is a stepper with Previous and Next, and without
JavaScript the six steps read as a list beside one frame. The film plays once,
muted, when most of it is in view, pauses when it leaves the screen, and holds
its end frame with a replay control; visitors can pause, turn on sound, scrub
(also with the arrow keys) or jump to a chapter. The system's reduced-motion
preference disables the hero animation and the film's autoplay and scaling;
the film then waits for a press. Without JavaScript the browser's own video
controls appear and all content and links work. "The film as text" carries
each chapter's words. The site uses no analytics, forms or browser
persistence. The hosting platform may set infrastructure cookies.

## Publication

The site moves from Sites to a Cloudflare Worker, `cashu-card-site`
(`wrangler.jsonc`, `worker.js`), in the account that runs ops.cashucard.org.
`dist/` is served as static assets with `_headers` applied. Only `/film/*` runs
`worker.js`, which answers byte ranges: the asset server answers a range
request with the whole file, and Safari on iPhone plays video only from 206
responses. Workers Caching is on so Cloudflare serves those ranges from cache.
On 2026-10-23 the Sites host returned the whole file to a range request and
sent none of the `_headers` rules (D106).

From `website/`: `npx wrangler versions upload` gives a preview URL without
publishing; `npx wrangler deploy` publishes. The custom domain `cashucard.org`
needs the apex's Sites A records removed first (a Workers custom domain cannot
share a hostname with another record); to roll back, remove the custom domain
and restore the A records `172.66.3.26` and `162.159.143.30`, DNS only. Run
the smoke test against the preview URL before publishing. Keep
ops.cashucard.org and its service configuration separate from this site.
