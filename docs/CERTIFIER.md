# Becoming a Cashu Card certifier

A wallet can check a lot about a Cashu Card for itself: that the card holds the key it
names (`AUTH`), that its money is real when a mint is in reach, and that it answers the
protocol as [`spec/APDU.md`](../spec/APDU.md) says. It cannot check two things from
outside: what code the card runs, and whether the card's key has ever left the chip. A
certifier vouches for those two things, card by card or batch by batch, and signs to say
so. Wallets that trust a certifier treat its cards as safe to load and safe to take
offline.

That trust is the whole job. This page says what a certifier promises, what its process
has to cover, what it must protect, and what it takes on. What the card itself does with a
certificate (it stores it, checks that it names the card's own key, and gives it to any
reader) is [D192](DECISIONS.md#d192) and [The certificate](../spec/APDU.md#the-certificate);
the certificate's format is NUT-CCP's
[certificate profile](https://github.com/cashucard/nut/blob/main/profiles/certificate.md).
Who a wallet believes is the wallet's choice, not the card's.

## What you are vouching for

Each certificate you issue says, for every card it covers:

1. The card runs the released Cashu Card software, byte for byte: the load file whose hash
   the certificate names, built reproducibly from the tagged source
   ([`HARDWARE_DEPLOYMENT.md`](HARDWARE_DEPLOYMENT.md) has the build and the published
   hashes). The certificate's `build=` is the SHA-256 of the load file exactly as it is
   LOADed onto the card, not of the CAP archive: the CAP's MANIFEST carries the time it was
   built, so a CAP built again from the same source has another hash and the same load
   file. Both are published side by side; name the load file's. The load file is, in this
   order:
   - the tag `C4`;
   - the BER length of what follows: one byte under 128, `81` and one byte under 256,
     `82` and two bytes (big-endian) above;
   - the CAP's components Header, Directory, Import, Applet, Class, Method, StaticField,
     Export, ConstantPool and RefLocation, in that order, those the CAP has, each whole as
     the CAP stores it (its own tag and size included). The Descriptor and Debug
     components are not part of it.

   `tools/refcheck.py` (its `LOADED` list) counts these bytes, and
   `tools/cardkit/make-assets.py` (`load_file`) builds and hashes them.
2. The card made its own key on the chip, and that key has never been outside it.
3. Nobody can load new code onto the card after it leaves you.
4. The card came from a chip source you trust and passed your checks.

If any of these is not true for a card, do not certify it.

## What your process must cover

- **Chips.** Buy from the chip maker or its authorized distributors, in whole lots, and keep
  the lot numbers. Cards bought from resellers often arrive with loading keys someone else
  knows.
- **Fresh-card checks.** Before installing anything, check that each card is blank: nothing
  installed, the expected free memory, the maker's factory record matching what you
  ordered. Set aside any card that is not.
- **Installing.** Install only the released file, and check its hash first. The card makes
  its key on the chip at install. Write and seal the certificate (`CERT_WRITE`) before the
  card is given a PIN: a card that has ever had one takes no certificate. Lock loading so
  that no code can be added or changed afterwards.
- **Reading back.** Before you sign, read every card back on a separate machine: have each
  one prove it holds the key you are about to vouch for (`AUTH`), and check that your signed
  statement covers exactly those cards and no others. A key slipped into a batch by a
  compromised computer is the easiest way to fool an honest certifier.
- **Records.** Keep a record of every batch: when it was made, which chips, which software,
  what was signed. You will need it the day something goes wrong.
- **No personal data tied to a card.** Never record which person, email, name or address
  goes with which card or card key. A certified card keeps its key across its holders, so
  any such record would tie a person to that card for as long as it is used. Whatever a
  sale needs (an address to post to) is handled apart from the card and not kept once the
  order is done.

## Your keys

Your keys are what make your word checkable. Whoever holds them can speak for you.

**Which keys.**

- The keys you sign certificates with. Many certifiers keep a top key that is used rarely
  and only to vouch for a day-to-day signing key, so that the day-to-day key can be replaced
  without the top one ever being exposed.
- The keys that let a card be changed after it leaves you (its loading keys), if you keep
  any.
- Whatever controls how wallets learn to trust you: the accounts and machines that publish
  your keys or your batches.

**Keeping them safe.**

- Make them offline, with randomness you can trust, on a machine that never touches a
  network.
- Never type, store or paste them on an online computer, in a chat, in a cloud service or in
  a file that leaves the offline machine.
- Keep backups in at least two separate safe places, so that one fire or theft does not end
  your ability to sign or to withdraw.
- Sign one batch at a time, never in a hurry, and never because someone asks urgently.
- Consider needing two people to sign, so that no single person can be tricked or forced
  into it.
- Keep quiet about who holds the keys and where; that alone removes much of the reason to
  pressure anyone.

**If a key leaks.**

- Anyone with your signing key can make cards that wallets believe are yours. Those cards
  can take what holders load on them, and pay offline receivers with copies.
- Every certificate signed with that key becomes doubtful, the honest ones included.
- Withdraw the key at once, and tell wallets to stop trusting every card under it, for
  loading and for offline payments, until you show otherwise. Those cards can still pay a
  wallet that is online, because the mint checks that money.
- A sealed certificate can never be changed on a card, so honest cards cannot be signed
  again in the field. Wallets trust a batch again only by its exact statement (its top),
  never by the key that signed it: a key that leaked can sign other batches. A batch can be
  trusted again only if you can show that it holds
  exactly the cards you made, from the keys you read back from each card when you made it,
  kept on a separate machine from the one that signed. A batch you cannot show that way
  stays untrusted: a key taken from a compromised machine may have been used to slip a
  foreign card into it before you signed.
- Until wallets are updated, forged cards may be believed. Plan how fast you can tell them.
- Anyone with a card's loading keys and the card in hand can wipe it, destroying the money
  on it, or change its code.

**If a key is lost.** You can no longer sign new batches, and if it was the key that
withdraws batches, you can no longer withdraw a bad one. Backups are part of safety, not a
convenience.

## Your records

Keep only what lets you stand behind a batch: when it was made, which chip lot, which
software, what was signed. Keep nothing about people. Protect the records as you would your
keys: they are what you need on the day a batch turns out bad.

## When a card or a batch turns out bad

Say so at once, and tell wallets how to stop believing it (a withdrawn batch, a blocked
key). Wallets can protect people only from a bad batch they have been told about. Decide in
advance who acts if you cannot: a certifier that disappears leaves its cards trusted with no
one to withdraw them.

## What you take on

- **The cards cannot be fixed in the field.** With loading locked, a flaw in the software
  stays on every card already sold, and replacing cards is the only remedy. Examine the
  software closely before your first batch.
- **Blame.** When a card you vouched for fails, or a holder loses money, people will look to
  you. Say clearly, when you sell, what a certificate promises and what it does not.
- **Pressure.** Anyone who wants to pass off bad cards has a reason to steal from you, trick
  you, or lean on you.

## What happens when certification goes wrong

- **To the holder:** whoever controls a falsely certified card may hold its key or have
  changed its code, and may spend what is loaded on it. Its PIN and its limits may not hold.
- **To a receiver offline:** the pieces it is paid with may be copies, or may be taken back
  by whoever holds the key, and the receiver has no way to tell until it reaches a mint.

A card with no certificate, or one from a certifier a wallet does not know, carries the same
risks. That is why wallets treat such cards with caution, and why a certificate is worth
only as much as the certifier behind it.
