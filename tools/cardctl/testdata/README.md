# cardctl test fixtures

## `card-file-v1.json`

A v1 card file, generated with the `cashucard/client#5` toolchain and verified
as accepted by `parseCardFile`. That PR merged to `main` on 2026-08-28. Its
`serializeCardFile` emits `spent: false` for proofs headed to a card and refuses
`spent: true`, because `LOAD_PROOF` carries no spent bit. Full dumps with spent
slots come from `cardctl dump`.

Keeping the fixture TypeScript-verified prevents it from drifting into agreement
with an incorrect Python parser. The TypeScript check uses the client
implementation merged from PR #5. The paired cardctl implementation merged in
`cashucard/javacard#19` on 2026-08-28. The status block in
`spec/CARD-FILE.md` records the merge and implementation status.

A fixture proves that one file parsed once. `test_card_file.py` parses
`spec/CARD-FILE.md` and checks the Python parser and writer against its field
tables, so a contract-breaking rename fails. The Python suite reads the
document directly. The client suite still needs equivalent checks against the
same tables.
