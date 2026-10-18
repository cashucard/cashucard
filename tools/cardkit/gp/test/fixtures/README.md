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
(`docs/HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md`), so the deletes come before
the install, and the card ends as it started: installed, on its factory keys.

## The captures

```sh
GP="java -jar $HOME/.javacard/gp-v25.10.20.jar"
F=tools/cardkit/gp/test/fixtures

# 1. What the card offers (SCP version, i, key set)
$GP -d -v -i > $F/gp-info.txt 2>&1

# 2. A login and the registry
$GP -d -v --list > $F/gp-list.txt 2>&1

# 3. Free memory, which needs no key
$GP -d -v -a 00A4040008A000000151000000 -a 80CAFF2100 > $F/gp-ff21.txt 2>&1

# 4. The four deletes, in the order the card takes them
$GP -d -v --delete D2760000850101 > $F/gp-delete-tag.txt 2>&1
$GP -d -v --delete F043415348554341524401 > $F/gp-delete-card.txt 2>&1
$GP -d -v --delete F04341534855434152444D > $F/gp-delete-opener.txt 2>&1
$GP -d -v --delete F0434153485543415244 > $F/gp-delete-package.txt 2>&1

# 5. The three-step install (docs/HARDWARE_DEPLOYMENT.md), from the tracked CAP
$GP -d -v --install applet/target/cashu-javacard-2.1.0.cap --applet F04341534855434152444D > $F/gp-install-opener.txt 2>&1
$GP -d -v --create F043415348554341524401 --package F0434153485543415244 --applet F043415348554341524401 > $F/gp-install-card.txt 2>&1
$GP -d -v --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454 > $F/gp-install-tag.txt 2>&1

# 6. A rotation to the spike set and back to the factory set
$GP -d -v --lock-enc 101112131415161718191A1B1C1D1E1F --lock-mac 202122232425262728292A2B2C2D2E2F --lock-dek 303132333435363738393A3B3C3D3E3F > $F/gp-lock-spike.txt 2>&1
$GP -d -v --key-enc 101112131415161718191A1B1C1D1E1F --key-mac 202122232425262728292A2B2C2D2E2F --key-dek 303132333435363738393A3B3C3D3E3F --lock 404142434445464748494A4B4C4D4E4F > $F/gp-unlock-factory.txt 2>&1

# 7. The card as it ends: the three applets, on the factory keys
$GP -d -v --list > $F/gp-list-after.txt 2>&1
```

After step 6, check that `gp-unlock-factory.txt` ends without an error before
anything else touches the card: until it has run, the card is on the spike set,
and a login with the factory keys would fail. If step 6's second command fails,
run nothing else and report it.

Then run the tests (`cd tools/cardkit && node --import tsx --test 'gp/test/**/*.test.ts'`):
every H0 test should now run and pass. A failure names the first byte that
differs between gp and cardkit; that is the answer the captures were for.
