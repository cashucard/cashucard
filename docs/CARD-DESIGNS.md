# Card designs

Each design a card's face can have is named by a code of three characters:
capital letters and digits, nothing else. Foxy draws a card in the design its
code names.

A card maker who wants a design of their own picks a code that is not in the
table below, adds a row for it, and adds its drawing to the wallet. A code is
taken once it is in this table, and is never used for a second design: a
design that changes gets a new code (FL1, then FL2), so a card printed with
the old one is still drawn as it was printed.

| code | design | whose | drawn in Foxy |
|---|---|---|---|
| FL1 | Flash, first design: black card, the Flash bolt in a circle at its centre, chip at the top left, BEARER at the bottom right | Flash | yes |
| FX1 | Foxy, first design: orange fur, a sleeping fox in a black circle at its centre, chip at the top left, ₿ and BEARER at the bottom right | Foxy | yes |
| EL1 | Beaker, first design: black card, a beaker of orange liquid with a die in it and a sprout growing out of it at its centre, the liquid flowing and bubbling and the beaker swaying (still under Reduce Motion), chip at the top left, ₿ and BEARER at the bottom right | Foxy | yes |

Where the wallet keeps them: `FC_DESIGNS` in `build/app/26f-flashcard.js` of
the wallet repository (getfoxy/iOS, https://github.com/getfoxy/iOS), and the
drawing itself in `build/markup.html` there (the card on the FLASHCARD screen).

## How a card names its design

Since card software 1.10 the card's record carries the code: three bytes
after the mint, written by `SET_CARD` when the phone gives them and read back
by `GET_CARD` (FOXY-CARD-SPEC.md 5.1). A phone that sets a card up writes the
design it chose for it (Foxy's own phone writes FX1), and every phone that
reads the card draws it so. A card of 1.9 or earlier has no such field: the
phone that set it up draws it as the design it wrote on its own file for it,
and any other phone draws it as FL1.
