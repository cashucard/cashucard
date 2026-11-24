# Card designs

Each card-face design has a three-character code using uppercase letters and
digits. A wallet uses that code to select its card artwork.

A card maker who wants a design of their own picks a code that is not in the
table below, adds a row for it under its name, lists the code in its
`maker/maker.json` (`designCodes`; `python3 tools/maker/maker.py check` holds the
two together), and gives its drawing to the wallets that draw it. Each code
identifies one registered design. A changed design gets a new code (FL1, then
FL2), so wallets can continue to display older printed cards correctly.

| code | design | whose |
|---|---|---|
| FL1 | Flash, first design: black card, the Flash bolt in a circle at its centre, chip at the top left, BEARER at the bottom right | Flash |
| FX1 | Foxy, first design: orange fur, a sleeping fox in a black circle at its centre, chip at the top left, ₿ and BEARER at the bottom right | Foxy |
| EL1 | Beaker, first design: black card, a beaker of orange liquid with a die in it and a sprout growing out of it at its centre, the liquid flowing and bubbling and the beaker swaying (still under Reduce Motion), chip at the top left, ₿ and BEARER at the bottom right | Foxy |

The "whose" column is the card maker's name as its `maker/maker.json` gives it.
The drawings are the wallets'; one wallet that draws all three is Foxy's
(getfoxy/iOS, https://github.com/getfoxy/iOS: `FC_DESIGNS` in
`build/app/26f-flashcard.js`, the drawing in `build/markup.html`).

## The maker's tag address

Each card maker publishes the one address its cards' NFC tag carries before the fragment
(`tagAddress` in its `maker/maker.json` for the desktop tools, [D227](DECISIONS.md#d227); the
card maker setting of the set-up app, [D239](DECISIONS.md#d239)), here or on its own
site, so that anyone can check a card against it. The address is the installer's choice
for each card and survives a reset, so nothing on the card stops an installer from giving
each card its own, which would make the tag a tracker; a card whose address is not its
maker's published one is suspect ([D228](DECISIONS.md#d228)). `python3 tools/maker/maker.py
check` refuses an address that looks per card (a long run of digits or hex, a UUID, a
serial or a uid in the path or the query) unless `--allow-per-card` is given. The set-up
app takes one address for each ops service, in its settings and never with a batch or a
card, shows it on the batch screen before any card is installed, and says there that the
maker publishes it.

## How a card names its design

Since card software 1.10 the card's record carries the code: three bytes
after the mint, written by `SET_CARD` when the phone gives them and read back
by `GET_CARD` (CASHU-CARD-SPEC.md 5.1). A phone that sets a card up writes the
design it chose for it (a maker's own phone app writes that maker's code), and every phone that
reads the card draws it so. A card of 1.9 or earlier has no such field: the
phone that set it up draws it as the design it wrote on its own file for it,
and any other phone draws it as FL1.
