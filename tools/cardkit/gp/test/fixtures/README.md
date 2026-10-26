# Gate H0: GlobalPlatformPro captures of the spare J3R180

`gp/test/transcripts.test.ts` replays these logs through cardkit: the handshake
must prove the keys, and every command gp sent under the C-MAC must be the one
cardkit sends, byte for byte. While a file is missing its test is skipped with
`pending H0 fixtures`; once it is here the test is required.

Taken by the owner only, on the spare card (CPLC serial 09336320) in the ACR122U
on the Mac. No agent runs any of this.

## Before you start

- Run every command as written, from the repository root, with
  `java -jar ~/.javacard/gp-v25.10.20.jar`. Never the zsh alias `gp`, which is
  `git push`.
- `-d` prints the APDUs; `-v` adds gp's own account. The output goes to the
  file the test reads; keep the names exactly.
- One command at a time. If any of them prints `6982`, `6983`, `6300` or
  "card LOCKED", stop and do not run it again: failed logins lock the card
  manager for good (`FORK.md`).
- The only keys in these logs are the factory set (`40` to `4F`) and the spike's
  public test set (`10` to `3F`). Nothing in them is secret.

The spare was left with the 2.1 applet installed, empty and with no owner
(`docs/reports/HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md`), so the deletes come before
the install, and the card ends as it started: installed, on its factory keys.

## The captures

```sh
GP="java -jar $HOME/.javacard/gp-v25.10.20.jar"
F=tools/cardkit/gp/test/fixtures

# 1. What the card offers (SCP version, i, key set): GET DATA only, no login
$GP -d -v -i > $F/gp-info.txt 2>&1

# 2. A login (the SCP and key set the card opens) and the registry
$GP -d -v --list > $F/gp-list.txt 2>&1

# 3. Free memory, which needs no key
$GP -d -v -a 00A4040008A000000151000000 -a 80CAFF2100 > $F/gp-ff21.txt 2>&1

# 4. The four deletes, in the order the card takes them
$GP -d -v --delete D2760000850101 > $F/gp-delete-tag.txt 2>&1
$GP -d -v --delete F043415348554341524401 > $F/gp-delete-card.txt 2>&1
$GP -d -v --delete F04341534855434152444D > $F/gp-delete-opener.txt 2>&1
$GP -d -v --delete F0434153485543415244 > $F/gp-delete-package.txt 2>&1

# 5. A DELETE of what is not there, twice in one login: the hello applet's
#    instance, then its package (-s sends each under the C-MAC)
$GP -d -v -s 80E400000D4F0BF04341534848454C4C4F01 -s 80E400000C4F0AF04341534848454C4C4F > $F/gp-delete-absent.txt 2>&1

# 6. The three-step install (docs/HARDWARE_DEPLOYMENT.md), from the tracked CAP
$GP -d -v --install applet/target/cashu-javacard-2.1.0.cap --applet F04341534855434152444D > $F/gp-install-opener.txt 2>&1
$GP -d -v --create F043415348554341524401 --package F0434153485543415244 --applet F043415348554341524401 > $F/gp-install-card.txt 2>&1
$GP -d -v --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454 > $F/gp-install-tag.txt 2>&1

# 7. A rotation to the spike set and back to the factory set
$GP -d -v --lock-enc 101112131415161718191A1B1C1D1E1F --lock-mac 202122232425262728292A2B2C2D2E2F --lock-dek 303132333435363738393A3B3C3D3E3F > $F/gp-lock-spike.txt 2>&1
$GP -d -v --key-enc 101112131415161718191A1B1C1D1E1F --key-mac 202122232425262728292A2B2C2D2E2F --key-dek 303132333435363738393A3B3C3D3E3F --lock 404142434445464748494A4B4C4D4E4F > $F/gp-unlock-factory.txt 2>&1

# 8. The card as it ends: the three applets, on the factory keys
$GP -d -v --list > $F/gp-list-after.txt 2>&1
```

Step 5 is what the install's sweep leans on when a card is clean: a DELETE of an
AID that is not there must answer `6A88` and leave the login open for the next
command. The hello applet has never been on this card, so both of its AIDs are
absent; if `gp-list.txt` (step 2) lists `F04341534848454C4C4F` or
`F04341534848454C4C4F01`, skip step 5 and say so. Both of its DELETE commands
should answer `6A88`.

After step 7, check that `gp-unlock-factory.txt` ends without an error before
anything else touches the card: until it has run, the card is on the spike set,
and a login with the factory keys would fail. If step 7's second command fails,
run nothing else and report it.

Then run the tests (`cd tools/cardkit && node --import tsx --test 'gp/test/**/*.test.ts'`):
every H0 test should now run and pass. A failure names the first byte that
differs between gp and cardkit; that is the answer the captures were for.

`gp-install-opener.txt` is held to the load file its LOAD blocks carry, by
sha256 (`H0_LOAD_FILE_SHA256` in `transcripts.test.ts`, the 2.1.0 CAP's), and
not to the provisioner's asset, so a later CAP leaves it passing. A failure at
that hash means step 6 installed another CAP, not that cardkit differs from gp.
