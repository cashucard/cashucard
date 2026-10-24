# Install the Cashu Card applet: the guide for AI agents

This is the install guide at https://cashucard.org/guide, written for an AI agent that runs commands for a person on their own computer. It puts the Cashu Card applet, version 2.1, on a blank NXP J3R180 card in a PC/SC card reader, then checks that the card answers. Every command and expected answer here matches the guide.

## Rules

1. Run the commands in this file one at a time, exactly as written, and compare each output with the expected output before you run the next one.
2. Stop and ask the person when a login to the card is refused, when the CAP's sha256 differs from the one below, or when any output differs from what this file expects. A refused login counts towards a lock that is permanent, so a refused card is put aside and its login is never tried again.
3. Use gp's factory keys only, which is what gp does when it is given no key options. Keep to the commands in this file, and ask the person before anything else that writes to a card.
4. Work on one card at a time. Ask the person to put a card on the reader before step 3, and before each further card.
5. When a card is done, report what the last section lists.

## What the person needs

- Blank NXP J3R180 cards (JCOP 4, Java Card 3.0.5) with contact and contactless interfaces, unfused and initialized, on the factory GlobalPlatform keys `40` to `4F`. Shops are listed at https://cashucard.org/#buy.
- A PC/SC card reader. The project tests with the ACS ACR122U.
- A computer with a terminal, Git, Java 11 or later and GlobalPlatformPro 20.01.23 or later. Step 1 installs Java and GlobalPlatformPro.

## 1. Install the tools

On macOS, PC/SC ships with the system. Install Java with Homebrew:

```sh
brew install openjdk@17
```

On Debian or Ubuntu, install the PC/SC daemon and make sure `pcscd` is running. Install Java 11 or later from the distribution too:

```sh
sudo apt install pcscd libpcsclite-dev
```

Then install GlobalPlatformPro, the tool that talks to the card's manager, as a `gp` command:

```sh
curl -L https://github.com/martinpaljak/GlobalPlatformPro/releases/latest/download/gp.jar \
     -o /usr/local/bin/gp.jar

cat > /usr/local/bin/gp << 'EOF'
#!/bin/sh
exec java -jar /usr/local/bin/gp.jar "$@"
EOF
chmod +x /usr/local/bin/gp
```

## 2. Get the applet

The applet ships as one CAP file, `applet/target/cashu-javacard-2.1.0.cap`, holding three applets: an opener, the card's applet and an NFC tag.

```sh
git clone https://github.com/cashucard/cashucard
cd cashucard/applet
sha256sum target/cashu-javacard-2.1.0.cap
```

On a macOS release without `sha256sum`, run `shasum -a 256 target/cashu-javacard-2.1.0.cap`. Expected:

```
f27d92ba99581f4e42abda0efc038b2c31128f9b405bcec6de52f6a12ae4c7e5  target/cashu-javacard-2.1.0.cap
```

Stop if the hash differs.

## 3. Check the card

Ask the person to put one card on the reader. This command only reads:

```sh
gp -i -v
```

Expected on a J3R180, among the rest, together with key set version 01 holding three DES3 keys:

```
Supports SCP02 i=15 i=35 i=55 i=75
GP SCP02 (i=55)
```

Then log in with the factory keys and list what the card holds:

```sh
gp --list
```

Expected on a fresh card:

```
ISD: A000000151000000 (OP_READY)
```

If gp reports that the login failed, stop and tell the person to put that card aside. If the list already shows `F043415348554341524401`, the card already carries the applet: stop and ask the person, because a reinstall makes a new key and loses any balance on the card.

## 4. Install the applet

The chip takes the card's applet only once another applet from the same package exists, so the install is three commands in this order: the opener, the card's applet, then the NFC tag. From `cashucard/applet`:

```sh
gp --install target/cashu-javacard-2.1.0.cap --applet F04341534855434152444D
gp --create F043415348554341524401 --package F0434153485543415244 --applet F043415348554341524401
gp --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454
```

List the card again:

```sh
gp --list
```

Expected, among the rest:

```
APP: F04341534855434152444D (SELECTABLE)
APP: F043415348554341524401 (SELECTABLE)
APP: D2760000850101 (SELECTABLE)
```

## 5. Check the install

Select the card's applet by its whole AID. It answers with its version, 2.1, and `9000` for success:

```sh
gp --apdu 00A404000BF043415348554341524401
```

Expected:

```
0201 9000
```

Read its state with GET_INFO:

```sh
gp --apdu B0010000
```

Expected on a new card, with 128 empty slots and its PIN, owner and record still unset:

```
02 01 80 00 00 80 FF 00 04 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
SW: 9000
```

Read the card's public key with GET_PUBKEY:

```sh
gp --apdu B0100000
```

Expected: a 33-byte compressed secp256k1 public key, then `9000`.

Last, read the NFC tag the way a phone does: its name, the capability container and the NDEF file.

```sh
gp -d -a 00A4040007D2760000850101 -a 00A4000C02E103 -a 00B000000F -a 00A4000C02E104 -a 00B0000002 -a 00B0000214
```

Expected:

```
9000 / 9000 / 000F20003B00340406E104001600FF 9000 / 9000 / 0014 9000 / D101105504 + "getfoxy.io/card" 9000
```

When every answer matches, the card is installed.

## 6. Hand the card back

A card fresh from the install is empty and unowned, and any reader in range can give it a PIN, a record and an owner. Tell the person to keep the card until its holder sets it up from their own phone, in a wallet that supports Cashu Card, with "Set up this card". Setting up a bench card from the computer is in the guide's step 6, at https://cashucard.org/guide#setup; do it only when the person asks.

## Troubleshooting

- `gp --install` fails with `6F00`: check the order in step 4, since the chip takes the card's applet only after the opener. With the order right, suspect the size of the load file next.
- SELECT answers `6A82`: the requested applet was not found. An earlier 0.x or 1.x applet is one possible cause. Stop and ask the person.
- SELECT answers `9000` with no version: that SELECT named the package AID alone, `F0434153485543415244`, which reaches the opener. Select the whole AID, `F043415348554341524401`, as in step 5.
- The card refuses gp's keys: stop, as step 3 says.
- The CAP will not load: confirm the card model and Java Card version. Java Card 3.0.4 and earlier lack `ALG_EC_SVDP_DH_PLAIN_XY`; this guide targets the J3R180. Stop if the card differs.

## Reference

| Element | AID (hex) |
|---|---|
| Package | `F0434153485543415244` |
| Opener, made first | `F04341534855434152444D` |
| Card's applet | `F043415348554341524401` |
| Tag, class | `F043415348554341524454` |
| Tag, instance (the NFC Forum's NDEF Tag Application) | `D2760000850101` |

## Report

When a card is done, tell the person:

- whether each of steps 2 to 5 matched,
- the answer to the SELECT in step 5,
- the card's public key from GET_PUBKEY,
- and any output that differed, word for word.
