#!/usr/bin/env python3
"""
Independent oracle for the `canonicalize` conformance vectors.

NON-NORMATIVE. This is a testing artifact. It exists to keep the canonicalization
vectors HONEST under the suite's oracle discipline: expected values must come from
an implementation independent of the one under test, never snapshotted from it.

This tool is written in Python and depends only on the standard library
(`json`, `hashlib`) — it shares no code with this repository's TypeScript
canonicalizer. It plays two roles:

  * `gen`   — given a hand-authored *canonical object* (the post-canonicalization
              {content, metadata} structure a human derived by reasoning about the
              §4.3 rules), emit the RFC 8785 (JCS) serialization and the
              algorithm-prefixed digest of exactly those bytes. Used while
              authoring a vector's `expectedCanonicalJcs` / `expectedId`.

  * `check` — re-derive, for every transform vector in canonicalize.json, the
              digest of the committed `expectedCanonicalJcs` bytes and assert it
              equals the committed `expectedId`. This proves the byte→hash link
              with a tool that is not Node, complementing the reference adapter's
              corroboration of the bytes themselves (two independent serializers
              agreeing on the JCS is strong evidence it is correct).

Faithfulness note: `json.dumps(..., sort_keys=True, separators=(',', ':'),
ensure_ascii=False)` matches RFC 8785 for the content these vectors use — keys are
ASCII (so code-point and UTF-16 key ordering coincide) and numbers are authored in
already-normalized form (no -0, no exponent forms). Where a vector carries astral
characters in a string VALUE, array order is authored explicitly and json.dumps
preserves it. The reference adapter (this repo's TS canonicalizer) independently
reproduces every `expectedCanonicalJcs`, so any divergence would fail the gate.
"""

import hashlib
import json
import sys

_HASH = {
    "sha256": hashlib.sha256,
    "sha384": hashlib.sha384,
    "sha512": hashlib.sha512,
    "sha3-256": hashlib.sha3_256,
    "sha3-512": hashlib.sha3_512,
}


def jcs(obj) -> str:
    """RFC 8785 JCS for the (ASCII-key, pre-normalized-number) content used here."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(algorithm: str, data: str) -> str:
    if algorithm not in _HASH:
        raise SystemExit(f"unsupported algorithm: {algorithm}")
    return f"{algorithm}:{_HASH[algorithm](data.encode('utf-8')).hexdigest()}"


def gen() -> int:
    """Read a hand-authored canonical object from stdin; emit its JCS and id.

    Stdin is JSON: either {"canonical": <object>, "algorithm": "sha256"} or a bare
    <object> (algorithm defaults to sha256).
    """
    raw = json.load(sys.stdin)
    if isinstance(raw, dict) and "canonical" in raw:
        obj = raw["canonical"]
        algorithm = raw.get("algorithm", "sha256")
    else:
        obj, algorithm = raw, "sha256"
    body = jcs(obj)
    print(json.dumps({"expectedCanonicalJcs": body, "expectedId": digest(algorithm, body)}, ensure_ascii=False))
    return 0


def check(path: str) -> int:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    failures = 0
    checked = 0
    for v in doc.get("vectors", []):
        body = v.get("expectedCanonicalJcs")
        expected = v.get("expectedId")
        if body is None or expected is None:
            continue  # a reject vector, or one that pins no id
        algorithm = v.get("algorithm", "sha256")
        actual = digest(algorithm, body)
        if actual != expected:
            print(f"  MISMATCH {v['name']}: expectedId {expected} != sha({algorithm}) {actual}")
            failures += 1
        else:
            checked += 1
    if failures:
        print(f"{failures} vector(s) failed the independent byte->hash check.")
        return 1
    print(f"OK: {checked} canonicalize vector id(s) match the independent digest of their bytes.")
    return 0


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "gen":
        return gen()
    path = sys.argv[2] if len(sys.argv) >= 3 and sys.argv[1] == "check" else "conformance/vectors/canonicalize.json"
    return check(path)


if __name__ == "__main__":
    raise SystemExit(main())
