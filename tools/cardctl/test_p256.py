#!/usr/bin/env python3
"""
P-256 ECDSA for the owner's proof, checked against RFC 6979 and the card.

The owner's proof is what administers a 2.0 card. A signer that is wrong
fails every owner command with 6A91, which on a bench reads as "the card is
broken"; a verifier that is wrong passes forgeries. Both halves are held here
to RFC 6979's own P-256/SHA-256 vectors, and to spec/vectors/owner.json, the
proofs the applet's own test suite made and the card verified.

Runs with no card, no reader and no pyscard.
"""
import json
import pathlib
import sys
import traceback

import p256

OWNER_JSON = pathlib.Path(__file__).resolve().parents[2] / "spec" / "vectors" / "owner.json"

# RFC 6979 appendix A.2.5: P-256, SHA-256.
RFC_X = 0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721
RFC_UX = 0x60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6
RFC_UY = 0x7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299
RFC_VECTORS = [
    (b"sample", 0xEFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716,
     0xF7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8),
    (b"test", 0xF1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367,
     0x019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083),
]


def test_the_public_key_is_rfc_6979s():
    pub = p256.public_key(RFC_X)
    assert pub == b"\x04" + RFC_UX.to_bytes(32, "big") + RFC_UY.to_bytes(32, "big"), pub.hex()


def test_signatures_are_rfc_6979s_deterministic_ones():
    for message, r, s in RFC_VECTORS:
        assert p256.sign_raw(RFC_X, message) == (r, s), message
        sig = p256.sign(RFC_X, message)
        assert p256.parse_der(sig) == (r, s)
        assert p256.verify(p256.public_key(RFC_X), message, sig)


def test_the_verifier_says_no():
    pub = p256.public_key(RFC_X)
    sig = p256.sign(RFC_X, b"sample")
    assert not p256.verify(pub, b"samplf", sig), "another message"
    r, s = p256.parse_der(sig)
    assert not p256.verify(pub, b"sample", p256.der(r, (s + 1) % p256.N)), "another s"
    assert not p256.verify(p256.public_key(RFC_X + 1), b"sample", sig), "another key"
    assert not p256.verify(pub, b"sample", sig[:-1]), "a truncated signature"
    assert not p256.verify(pub[:-1], b"sample", sig), "a truncated key"


def test_the_cards_own_vectors_verify():
    doc = json.loads(OWNER_JSON.read_text(encoding="utf-8"))
    pub = bytes.fromhex(doc["ownerKey"])
    assert doc["proofs"], "owner.json has proofs"
    labels = set()
    for proof in doc["proofs"]:
        message = proof["label"].encode("ascii") + bytes.fromhex(proof["nonce"]) + bytes.fromhex(proof["value"])
        assert p256.verify(pub, message, bytes.fromhex(proof["signature"])), proof["label"]
        labels.add(proof["label"])
    assert all(label.startswith("CashuCard/") for label in labels), labels


def test_owner_proof_and_data_frame_as_the_card_reads_them():
    nonce = bytes(range(16))
    value = (5000).to_bytes(4, "big")
    proof = p256.owner_proof(p256.TEST_OWNER_PRIVATE, "CashuCard/set-limit", nonce, value)
    assert p256.verify(p256.public_key(p256.TEST_OWNER_PRIVATE), b"CashuCard/set-limit" + nonce + value, proof)
    data = p256.owner_data(proof, value)
    assert data[0] == len(proof) and data[1:1 + len(proof)] == proof and data[1 + len(proof):] == value
    assert p256.owner_proof(p256.TEST_OWNER_PRIVATE, "CashuCard/set-limit", nonce, value) == proof, "deterministic"


def test_the_test_owner_key_is_fixed_and_on_the_curve():
    pub = p256.public_key(p256.TEST_OWNER_PRIVATE)
    p256.parse_public_key(pub)
    assert pub.hex() == p256.public_key(p256.TEST_OWNER_PRIVATE).hex()


if __name__ == "__main__":
    failed = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"ok    {name}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
