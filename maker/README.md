# The card maker's settings

`maker/maker.json` holds everything about a card maker that the repository's
tools need, and nothing else does. The card's load file names no maker: the
CAP built from this repository is the same, byte for byte, for every maker who
installs it ([D227](../docs/DECISIONS.md#d227)). The file here is the neutral
example, `"example": true`, whose tag says `https://example.com/card` (a name
kept for examples, RFC 2606, and nobody's site); the tools refuse to put it on a
card in the field.

| Field | What it is | Who reads it |
|---|---|---|
| `example` | `true` only in the shared repository's file. | `tools/maker/maker.py` refuses `tag-params` and `gp-tag` for it (`--allow-example` for a spare card on a bench); the set-up app takes nothing from it: its maker is set in the app ([D239](../docs/DECISIONS.md#d239)), and the example's name and address are refused there too (`apps/provisioner/src/maker.ts`). |
| `name` | The maker's name, 1 to 64 characters, as tools show it and as its rows of [`docs/CARD-DESIGNS.md`](../docs/CARD-DESIGNS.md) name it. | `maker.py check`. |
| `tagAddress` | The address the card's NFC tag carries, given in the tag's install parameters. The card adds `#new` or `#` and a code ([`spec/APDU.md`](../spec/APDU.md), "The NFC tag application"). `https://`, 9 to 127 characters, a letter or a digit after `https://`, printable ASCII, none of `"` `#` `<` `>` `\` `^` `` ` `` `{` `|` `}` ([`spec/vectors/tag-address.json`](../spec/vectors/tag-address.json)). One address for every card of the maker, published ([`docs/CARD-DESIGNS.md`](../docs/CARD-DESIGNS.md)): an address per card would make the tag a tracker that survives a reset ([D228](../docs/DECISIONS.md#d228)). `maker.py` refuses one that looks per card (a run of six digits or more, of eight hex digits or more, a UUID, `serial` or `uid` in the path or the query) unless `--allow-per-card` is given; a `gp --params` written by hand is not checked. | `maker.py tag-params` and `gp-tag` (the deployment guide's install); the set-up app only as a pre-fill: a fork's own file fills in the app's Card maker form, nothing installs until the maker is saved on the phone, and the address the app installs with is the saved one, which its batch screen shows (`apps/provisioner/src/releaseGates.ts`, `installGate`; D239). Its install reads the tag back and stops on any other address. |
| `securityDomain` | `null` to install into the card manager. Otherwise `{"aid": "<hex>"}`, the maker's own supplementary security domain that loads and installs go into, with `"dapPublicKey"` the public half of its release key where the domain asks for a DAP signature on every load. Never a private key. | `maker.py gp-tag` adds `--to <aid>`. The provisioner and cardkit install into the card manager only today (`sdAid` in `tools/cardkit/gp/provision.ts` is a caller's option). |
| `designCodes` | The card-face codes the maker registered in [`docs/CARD-DESIGNS.md`](../docs/CARD-DESIGNS.md), each a row under its `name`. | `maker.py check` holds the two together. |

`maker/maker.schema.json` is the rules as JSON Schema. `tools/maker/maker.py`
(Python 3.9, the standard library) and `tools/cardkit/gp/maker.ts` (`parseMaker`,
for the apps) check a file the same way and fail with a message that names the
field: a missing file, bad JSON, an unknown field, a missing one, or a value
that breaks a rule.

```bash
python3 tools/maker/maker.py check                    # the file is valid: what it holds
python3 tools/maker/maker.py tag-params               # the tag's install parameters, hex, for gp --params
python3 tools/maker/maker.py gp-tag                   # the whole gp command that makes the tag
python3 tools/maker/test_maker.py                     # its tests
```

Keys are never in this file: the card manager's keys, a fleet's master key and a
release key's private half are the operator's, kept as
[`docs/HARDWARE_DEPLOYMENT.md`](../docs/HARDWARE_DEPLOYMENT.md) says, and never in
a repository.

<a id="forks-for-a-card-maker"></a>

## The set-up app

The phone app (`apps/provisioner`, Cashu Card Setup) does not need this file. The
person making cards sets the maker's name and tag address in the app, once for each
ops service, under Settings, Card maker ([D239](../docs/DECISIONS.md#d239)). There
is no default and no list of makers: the app installs nothing until a name and an
address that pass the rules above are saved, and it refuses the example's. A fork's
own `maker/maker.json` pre-fills the Card maker form and no more: nothing installs
until the maker is saved on the phone. The example here pre-fills nothing.
The desktop tools (`tools/maker/maker.py`, `tools/cardctl`) read this file as before.

## Forks for a card maker

A card maker who keeps a fork of this repository changes `maker/maker.json` and
nothing else. Everything a maker needs to differ is a value in that file; the
applet, the tools, the tests and the documents are this repository's, so the
load file a maker installs is the one this repository builds and its sha256 is
the one this repository publishes. A maker that needs a new setting proposes the
field here, with the tool that reads it, rather than changing a tool in its fork.

To audit a maker's fork, compare it with the branch it follows:

```bash
git remote add upstream https://github.com/cashucard/cashucard.git
git fetch upstream
git diff --stat upstream/main...HEAD      # one file: maker/maker.json
git diff upstream/main...HEAD             # the maker's values, nothing else
python3 tools/maker/maker.py check        # and they pass the rules
```

Any other path in that diff is a change the maker carries on its own, to be read
as one. The CAP needs no diff of its own: `ant -f applet/build.xml cap` in the
fork and here gives the same load file (refcheck prints its sha256), since the
maker's values reach the card only at install.
