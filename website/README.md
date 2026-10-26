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

Protocol facts come from NUT-CCP (`CCP.md` in cashucard/nut), and from
cashucard/cashucard's APDU reference, security model and license. NUT-CCP
remains a draft. Review the source specification when changing the payment or
ownership explanation.
The hero describes offline terminal acceptance and later mint settlement as
separate events; an offline tap does not guarantee final settlement.
The site calls Cashu Card experimental on every page: the hero, the install
guide's facts, and each footer. The home page states the risks once, in
`#risks`, before where to get cards; `/faq` (`dist/faq.html`) answers holders',
merchants' and developers' questions from the security model, the decisions and
the dated reports, and `/developers` (`dist/developers.html`) links the draft,
the APDU reference, the vectors and the code. Both use the install guide's
layout and `guide.js`. When a doc they link moves, update its link here. There
is no page for merchants yet, by choice: it waits for more wallets and tills.
Footer links point to the draft NUT and the Cashu Card source, with the Cashu
Card Provisioner under Apps. The install guide's Apps also link Flash and Foxy
at their own sites, getflash.io and getfoxy.io, since its setup step sends a
new holder to the wallets there (D118).
The links do not claim completed integrations.

`dist/film/` holds the 48-second film ("How it works") at 1080p, a 720p copy
that narrow screens load, and its poster; `dist/assets/og.jpg` is the share
image, from the film's end frame. The film section is black, and the film's
scene fades to black at the frame's edge under its text layer, so the frame
has no visible edge on the page. In the film's key chapter the provisioner
app (apps/provisioner, its installation screen in the dark theme, with the
Cashu Card's face in place of its branded card art) installs the applet on a
blank card while the chip makes its key; its tap and settle chapters use the
same Android till as the steps.

`dist/seq/tap-3/` holds the 96 rendered frames of the "One tap, step by step"
section and `anchors.js`, the points its callouts follow. In it the till is an
Android phone running an unbranded point-of-sale app: the customer holds the
card to the phone's back while the camera watches the screen, whose flow
follows flash-pos's card checkout (a sheet asks for the card, the charge
screen names each step, a green screen marks the payment accepted). An
OFFLINE badge in the frame's top right turns to ONLINE when the phone comes
back online in step 6. Steps 1 to 5 take 0.15 of the frames each and the
settle step the last 0.25, because in it the card leaves and a night passes
before the phone comes online; the steps' `data-a` and `data-b`, the callouts
and the badge's switch in `motion.js` use those bounds. Media names carry a
version (`-2`) because `_headers` caches `/film/*` and `/seq/*` for a year:
publish a new render under a new number.

The film, the frames and `dist/assets/custom-cards-1.webp` are rendered with a
private fork of the Daylight Fob film renderer (a WebGL2 scene driven by
headless Chrome, with a synthesized score at -18 LUFS and a look-ahead limiter
rather than clipping); the render source lives in the private `cashucard/cashucard-film` repository. What
they state comes from NUT-CCP and `spec/APDU.md`: the card makes its
key on the chip and keeps it there, a wallet writes pieces into its 128
slots, the till names the pieces, the card signs once for the payment and
burns them, and an offline till accepts the payment and settles with the mint
later. The bill is an exact amount because an offline till cannot finish the
card's change. The phone and till screens are generic and name no wallet or
point-of-sale app; the film and the steps show the protocol itself, so app
and wallet names stay off them.

"Where to get cards" names the chip the applet runs on (NXP J3R180, Java Card
3.0.5, dual interface) and how to buy it: unfused and initialized, with the
default GlobalPlatform keys over SCP02. It links one Amazon listing that
states those for testing, and for volume CardLogix and Feitian's J3R180 on
Alibaba, with prices as listed on 23 October 2026; check them before relying
on them. The third option, custom printed cards with the applet installed,
shows three made-up designs under a "Coming soon" stamp. Its quantities and
its Lightning and Stripe checkouts are placeholders that are not connected to
anything yet. When a checkout goes live, `_headers`' content security policy
needs the provider's origins (it allows no connections or form posts today).

"Install the applet" (`#install`, the nav's "Install") gives the two ways to
put the applet on a blank card. The first is the Cashu Card Provisioner
(`apps/provisioner`; see the linked release for the build identity), for card issuers with an operator
account. It shows the app's icon (`dist/assets/provisioner-icon.png`, its
180-pixel iOS icon) and links the TestFlight public beta, Google Play's
testing opt-in for `com.islandbitcoin.provisioner` and the GitHub release
with the build's files and checksums. A Play visitor who has not joined the
test gets no store listing, so the opt-in page is the Android link; it lets
anyone join once Google approves open testing. Replace both beta links with
the store listings when the app is published. The second way is the install
guide, for a computer with a card reader.

`dist/guide.html` (with `guide.css` and `guide.js`) is the install guide at
`/guide`: the steps of `docs/HARDWARE_DEPLOYMENT.md` for someone with a blank
card and a reader, each command with its expected answer. It publishes the
tracked CAP's sha256, and CI's `cap` job fails when the CAP changes and the
guide does not; change the guide with the doc it comes from. `dist/guide.md`
is the same install for an AI agent working in someone's terminal: the steps
and expected answers as Markdown, with the points where the agent stops and
asks its person written as rules. The guide's "Hand the install to an AI
agent" box gives a one-line prompt that points an agent at it, and
`dist/llms.txt` lists it for agents that look there first. CI checks
`guide.md` for the CAP's sha256 too. The guide's reader is the ACS ACR122U,
the reader the project's hardware reports were run with.

The site carries the Cashu Card mark (D119, D120). The header's lockup
(`dist/assets/cashu-card-lockup.svg`), the tab icons (`dist/favicon.ico`,
`dist/assets/favicon.svg`, `dist/assets/apple-touch-icon.png`) and the hero
card's mark (`dist/assets/cashu-card-mark-green.svg`) are copies of files in
`brand/`; after `swift brand/generate.swift`, copy them here again. The film's
card face paints the same mark, and `dist/assets/provisioner-icon.png` is the
provisioner's new icon. The Cashu mascot (`dist/assets/cashu.png`, from
https://cashu.space/cashu-no-bg.png) stays only in the finish studies of
`dist/concepts.html`, which record the card before the mark.
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

## Ops-service documentation

`/developers#overview` separates card use from issuance, names each component's
operator and folds optional recovery infrastructure into a disclosure. Its ecosystem
diagram has desktop and phone compositions generated from the same component roles
by `python3 website/tools/ecosystem.py` (`--check` verifies the SVGs). The diagrams
show the same physical card on the payment and installation paths, distinguish
NFC, online APIs and recovery links, and retain a text explanation in the page. `/ops-service`
explains manager-key custody and provides the standalone Docker setup, HTTPS,
CCP service selection and backup/recovery procedures. The manual card guide links
both paths. The downloadable `dist/ops-compose.yaml` uses the public release
image pinned by digest, with no source build or platform-specific hosting dependency.
Update its image pin and the guide together after testing a new ops release.

## Publication

The site runs on a Cloudflare Worker, `cashu-card-site`
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
