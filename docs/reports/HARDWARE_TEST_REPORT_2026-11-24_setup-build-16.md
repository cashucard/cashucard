# Hardware test report: Cashu Card Setup 1.0.0 build 16 installs two kinds of card (2026-11-24)

The operator, who is the project owner, installed the released 3.1 card file on two cards with the phone app Cashu Card Setup
1.0.0 build 16. This report records what ran and what was read from the cards afterward. It records no more than that.

- **App:** Cashu Card Setup 1.0.0 build 16 on an iPhone. This was a development-signed Release build made from commit
  `a5ed77e` (the tree of main `9aad69d`). The released files (tag `provisioner-v1.0.0-build.16`, commit `c878b71`) differ from
  it by one display fix (#269, the card picture). **No card install by the released files themselves is on record.**
- **Service:** the ops service at `https://ops.cashucard.org`. A card maker name and a tag address were saved in the app (D239).
  The tag's address is the maker's saved test address and is not given here.
- **File:** `cashu-javacard-3.1.0.cap`, load file sha256 `b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da`,
  released as `firmware-v3.1.0`.
- **Reads:** a USB reader (ACS ACR122U) and a read with no login. It selects the Cashu applet, the tag app and the NDEF file,
  and reads the key information, the CPLC, the capability container and the card data. The three raw outputs were kept
  outside the repo. The NDEF payload bytes and the address text are left out here.
- **What the evidence is:** the operator's account of what the app showed, and these reads. No APDU transcript of the app's
  own exchange with either card was captured.

## Card 1: a J3R180 keyed for SCP02

CPLC IC type D321, chip serial 07297620. The contactless ATR historical bytes read `JTaxCoreV1`. Key information shows three
DES keys at key version 01 (`C0 04 01 01 80 10` and so on). The card data gives SCP 02, option 55.

It was installed twice: once alone, then again in a batch of two after the operator reset it with the app.

| Read | Result |
| --- | --- |
| After the first install | Cashu applet answers SELECT with `03 01`. The tag app answers. The NDEF file holds the address saved in the app with `#new`. The capability container gives the NDEF file's largest size as 72 (`0048`), which is 16 bytes of address after `https://` plus 56. |
| After the operator's reset | The Cashu applet answers `6A82` and the tag app answers `6A82`: both absent. The manager (ISD) still answers `9000`. |

## Card 2: a J3R452 keyed for SCP03

A Dangerous Things card, ATR text `J3R452DNGR`, CPLC IC type D600, IC serial 36799121. Key information shows three AES-128 keys
at key version 01 (`C0 04 01 01 88 10` and so on).

1. **First tap, refused as designed.** The card still carried a Cashu 3.0 applet, installed with desktop tools on 2026-11-22.
   The app never installs over an applet. Its screen says no manager authentication or installation was attempted. A read with
   no login confirmed key version 01 and the applet answering `03 00`.
2. **Applet deleted.** GlobalPlatformPro with the public default key deleted it (one login; the delete of package
   `F0434153485543415244`). A read with no login showed the applet absent.
3. **Installed with the app,** in a batch of two.
4. **Read with no login after the install:** the applet answers `03 01`. The tag app answers and its NDEF file holds the saved
   address with `#new`. The capability container size is 71 (`0047`), which is 15 bytes of address plus 56. The seller's NDEF
   tag was replaced. Key information still reads three AES keys at key version 01. Whether the values of the manager keys were
   rotated cannot be seen without a login and was not checked.

## The batch

In the batch of two, both installs finished ("two of two").

## What this shows

- The build 16 app installs the released 3.1 file on a J3R180 keyed for SCP02 and on a J3R452 keyed for SCP03, from a phone,
  through the ops service, with a saved maker name and address.
- After each install the applet answers `03 01` and the tag holds the saved address with `#new`.
- On the J3R180 the app's reset takes the applet and the tag off, and a second install followed.
- The app does not install over an existing applet.

## What this does not show

- No install by this app on a J3R180 keyed for SCP03. Card 58206920 was not used.
- No holder set-up (PIN, owner, mint) and no payment after these installs.
- No APDU transcript of the app's own exchange with either card.
- No install by the released app files themselves (see the App line above). The Android build installed no card.
- No check of the manager keys' values after the J3R452 install.
