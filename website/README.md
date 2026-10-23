# Cashu Card protocol website

Public protocol introduction for https://cashucard.org. The operator console
remains independently hosted at https://ops.cashucard.org.

## Source and local preview

The site is buildless HTML, CSS and JavaScript in `dist/`. All fonts and images
are local. Run `python3 -m http.server 9117 --bind 127.0.0.1 --directory dist`,
then open http://127.0.0.1:9117. No package install or backend is needed.

`tools/browser-smoke.cjs` uses Node 22 and installed Chrome to check the
compact desktop and phone layouts, the four-step flow, keyboard controls,
implementation links and reduced motion. It creates and removes a separate browser
profile. Set SITE_TEST_ORIGIN to another preview origin if needed.

## Content and assets

Protocol facts come from lnflash/cashu-card's specification, APDU reference,
security model and license. The NUT-XX proposal remains a draft. Review the
source specification when changing the payment or ownership explanation.
Links point to the public protocol and the Cashu Card, Flash Mobile, Foxy iOS
and Flash POS repositories. Their roles are identified without implying every
integration is complete.

The original Cashu mascot is from https://cashu.space/cashu-no-bg.png.
Physical card artwork, illustrations and motion are native HTML/CSS/SVG.
Figtree fonts are bundled from the provisioner app under the SIL Open Font
License in `dist/assets/OFL.txt`. Reference implementation attribution is
retained in LICENSE; the site links to the project's credits and license.

## Motion and accessibility

The visual story starts once when the user reaches it, then stops after its
four stages. Play, pause, replay and step buttons control it directly. Each
stage animates the labeled transfer between participants. System reduced motion
disables autoplay and animation; the motion toggle provides the same control.
Content and the first story frame remain readable without JavaScript. Tabs
support arrows, Home and End. The site code uses no analytics, cookies, forms
or browser persistence. The hosting platform may set infrastructure cookies.

## Publication

This directory is the public source mirror of the protocol website. The Sites
checkout is `/Users/dread/Repos/cashu-card-protocol-site`, with its project
identity tracked in `.openai/hosting.json` there. Keep the published `dist/`
files and this mirror identical when editing. Use the Sites
source workflow to push the exact source, package `dist/` and publish the saved
version. The public site must use public access; custom-domain DNS records must
come from the Sites domain response. Do not point the apex to the ops Worker.
Keep ops.cashucard.org and its service configuration separate from this site.
