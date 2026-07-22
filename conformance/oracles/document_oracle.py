#!/usr/bin/env python3
"""
Independent defect-presence oracle for the Level-1 DOCUMENT (part-layer) fixtures.

NON-NORMATIVE testing artifact, the part-layer analogue of archive_oracle.py. It
keeps the document fixtures HONEST under the suite's oracle discipline: a malformed
fixture's defect must actually be PRESENT in the committed `case.cdx` bytes,
confirmed by an implementation that shares no code with the TypeScript part loader
under test (scripts/lib/part-loader.ts, scripts/lib/document-verdict.ts,
scripts/lib/manifest-projection.ts).

Python + standard library only. It hand-parses the ZIP central directory with
`struct` to reach a part's stored bytes (the document fixtures are all Store /
method 0), then re-derives each part-layer anomaly independently:

  * duplicate keys are confirmed with `json.loads(..., object_pairs_hook=...)`,
    which surfaces every key/value pair the parser saw (a naive `json.loads` would
    collapse the duplicate and hide it);
  * the manifest-field checks (state enum, version shape, content reference,
    content hash) re-implement the §4/§5.4.2 rules in Python;
  * version/extension support re-encodes the reference's own support envelope
    (spec 0.1; supported extensions = {cdx.security}), which is the definition of
    "unsupported".

For a clean case (no findings) it confirms the archive is a readable ZIP whose
manifest and referenced content part both parse as JSON and carry no duplicate key
— so a "reject-everything" reader could not pass it.

Usage: document_oracle.py check
"""

import io
import json
import math
import os
import re
import struct
import sys
import zipfile

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures", "document")

SIG_LFH = 0x04034B50
SIG_CD = 0x02014B50
SIG_EOCD = 0x06054B50

MANIFEST_STATES = {"draft", "review", "frozen", "published"}
VERSION_RE = re.compile(r"^\d+\.\d+$")
# Independent re-encoding of the reference's support envelope (its declared
# capabilities): spec 0.1, and the security extension only.
SUPPORTED_MAJOR = 0
SUPPORTED_MINOR = 1
SUPPORTED_EXTENSIONS = {"cdx.security"}
# Digest lengths mirror canonicalize.ts KNOWN_ALGORITHMS, re-encoded here.
HEX_LEN = {"sha256": 64, "sha384": 96, "sha512": 128, "sha3-256": 64, "sha3-512": 128, "blake3": 64}


def find_eocd(data):
    lo = max(0, len(data) - (0xFFFF + 22))
    for i in range(len(data) - 22, lo - 1, -1):
        if i < 0:
            break
        if struct.unpack_from("<I", data, i)[0] == SIG_EOCD:
            comment_len = struct.unpack_from("<H", data, i + 20)[0]
            if i + 22 + comment_len == len(data):
                cd_size = struct.unpack_from("<I", data, i + 12)[0]
                cd_offset = struct.unpack_from("<I", data, i + 16)[0]
                cd_count = struct.unpack_from("<H", data, i + 10)[0]
                return (cd_offset, cd_size, cd_count, i)
    return None


def parse_cd(data):
    eocd = find_eocd(data)
    if eocd is None:
        return []
    cd_offset, cd_size, cd_count, eocd_pos = eocd
    start = eocd_pos - cd_size
    stub_delta = start - cd_offset
    out = []
    p = start
    for _ in range(cd_count):
        if p + 46 > len(data) or struct.unpack_from("<I", data, p)[0] != SIG_CD:
            break
        (_ver_made, _need, _flags, method, _t, _d, _crc, comp, _uncomp,
         namelen, extralen, commentlen, _disk, _iattr, _extattr, local_off) = struct.unpack_from(
            "<HHHHHHIIIHHHHHII", data, p + 4)
        name_bytes = data[p + 46: p + 46 + namelen]
        out.append({
            "name": name_bytes.decode("utf-8", "replace"),
            "method": method, "comp": comp,
            "local_offset": local_off + stub_delta,
        })
        p += 46 + namelen + extralen + commentlen
    return out


def store_bytes(data, e):
    if e["method"] != 0:
        return None
    off = e["local_offset"]
    if off < 0 or off + 30 > len(data) or struct.unpack_from("<I", data, off)[0] != SIG_LFH:
        return None
    namelen = struct.unpack_from("<H", data, off + 26)[0]
    extralen = struct.unpack_from("<H", data, off + 28)[0]
    start = off + 30 + namelen + extralen
    return data[start: start + e["comp"]]


def cd_map(cd):
    return {e["name"]: e for e in cd}


def part_text(data, cdm, name):
    e = cdm.get(name)
    if e is None:
        return None
    b = store_bytes(data, e)
    return None if b is None else b.decode("utf-8", "replace")


def manifest_text(data, cd):
    return part_text(data, cd_map(cd), "manifest.json")


def manifest_obj(data, cd):
    """The parsed manifest dict, or None if absent / unparseable / not an object."""
    text = manifest_text(data, cd)
    if text is None:
        return None
    try:
        val = json.loads(text)
    except Exception:  # noqa: BLE001
        return None
    return val if isinstance(val, dict) else None


# --- independent structural predicates -------------------------------------

def has_duplicate_key(text):
    found = [False]

    def hook(pairs):
        keys = [k for k, _ in pairs]
        if len(keys) != len(set(keys)):
            found[0] = True
        return dict(pairs)

    try:
        json.loads(text, object_pairs_hook=hook)
    except Exception:  # noqa: BLE001
        return False
    return found[0]


def any_part_has_duplicate_key(data, cd):
    for e in cd:
        if e["name"].endswith(".json") and e["method"] == 0:
            text = part_text(data, {e["name"]: e}, e["name"])
            if text is not None and has_duplicate_key(text):
                return True
    return False


def walk_non_representable(v):
    if isinstance(v, bool):
        return False  # bool is an int subclass; not a number here
    if isinstance(v, int):
        return abs(v) > (2 ** 53 - 1)
    if isinstance(v, float):
        # Non-finite, or an integer-valued float beyond the safe-integer range
        # (e.g. 9007199254740993.0) — which the TS reader also rejects.
        return not math.isfinite(v) or (v.is_integer() and abs(v) > (2 ** 53 - 1))
    if isinstance(v, list):
        return any(walk_non_representable(x) for x in v)
    if isinstance(v, dict):
        return any(walk_non_representable(x) for x in v.values())
    return False


def content_has_non_representable_number(data, cd):
    # Scoped to the CONTENT part only, matching the reader: the content part is the
    # sole free-form hashed surface (projectMetadata hashes string terms only, §4.6),
    # so a non-representable number outside it is not a hashed number. Scanning every
    # part here would "confirm" a defect the reader correctly does not reject.
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    path = c.get("path") if isinstance(c, dict) else None
    if not isinstance(path, str):
        return False
    text = part_text(data, cd_map(cd), path)
    if text is None:
        return False
    try:
        val = json.loads(text)
    except json.JSONDecodeError:
        return False
    return walk_non_representable(val)


def is_unsafe_relative_path(p):
    # Independent of the reader's RELATIVE_PATH regex: a path is unsafe if it is
    # absolute, uses a backslash or drive/ADS colon, or has an empty / `.` / `..`
    # segment. `../secret.json` -> the `..` segment is unsafe.
    if not isinstance(p, str) or p.startswith("/") or "\\" in p or ":" in p:
        return True
    return any(seg in ("", ".", "..") for seg in p.split("/"))


def content_path_traversal(data, cd):
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    if not (isinstance(c, dict) and isinstance(c.get("path"), str)):
        return False
    return is_unsafe_relative_path(c["path"])


def content_unparseable(data, cd):
    # The content part is present but not valid JSON (and not a duplicate-key defect,
    # which has its own code). Independent confirmation that the injected content is
    # genuinely unparseable in the committed bytes.
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    path = c.get("path") if isinstance(c, dict) else None
    if not isinstance(path, str):
        return False
    text = part_text(data, cd_map(cd), path)
    if text is None:
        return False  # missing is a different code
    if has_duplicate_key(text):
        return False  # a duplicate-key defect is its own code
    try:
        json.loads(text)
        return False  # parses fine -> not unparseable
    except json.JSONDecodeError:
        return True


def is_valid_content_hash(h):
    if not isinstance(h, str) or ":" not in h:
        return False
    alg, _, dig = h.partition(":")
    return alg in HEX_LEN and len(dig) == HEX_LEN[alg] and all(c in "0123456789abcdef" for c in dig)


def content_part_missing(data, cd):
    cdm = cd_map(cd)
    m = manifest_obj(data, cd)
    if m is None:
        return False
    path = (m.get("content") or {}).get("path") if isinstance(m.get("content"), dict) else None
    return not (isinstance(path, str) and path in cdm)


def manifest_unparseable(data, cd):
    text = manifest_text(data, cd)
    if text is None:
        return False  # absent is a different code
    try:
        val = json.loads(text)
    except json.JSONDecodeError:
        # A genuine JSON parse error => unparseable. (Narrowed from a bare `except`
        # so an extraction/byte-read bug crashes the oracle loudly instead of
        # false-confirming; part_text always returns a str via errors="replace", so
        # no UnicodeDecodeError arises here.) A duplicate-key manifest does NOT reach
        # this branch — Python's json.loads accepts duplicate keys — so it is
        # reported under its own code (CDX-E-PART-DUPLICATE-KEYS), not this one.
        return True
    return not isinstance(val, dict)  # valid JSON but not a manifest object


def state_unknown(data, cd):
    m = manifest_obj(data, cd)
    return m is not None and m.get("state") not in MANIFEST_STATES


def version_malformed(data, cd):
    m = manifest_obj(data, cd)
    return m is not None and not (isinstance(m.get("cdx"), str) and VERSION_RE.match(m["cdx"]))


def reference_malformed(data, cd):
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    return not (isinstance(c, dict) and isinstance(c.get("path"), str) and isinstance(c.get("hash"), str))


def hash_malformed(data, cd):
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    if not (isinstance(c, dict) and isinstance(c.get("path"), str) and isinstance(c.get("hash"), str)):
        return False  # a shape defect is CDX-E-MANIFEST-REFERENCE-MALFORMED
    return not is_valid_content_hash(c["hash"])


def _major_minor(m):
    cdx = m.get("cdx")
    if not (isinstance(cdx, str) and VERSION_RE.match(cdx)):
        return None
    a, b = cdx.split(".")
    return int(a), int(b)


def major_unsupported(data, cd):
    m = manifest_obj(data, cd)
    mm = _major_minor(m) if m else None
    return mm is not None and mm[0] != SUPPORTED_MAJOR


def minor_unsupported(data, cd):
    m = manifest_obj(data, cd)
    mm = _major_minor(m) if m else None
    return mm is not None and mm[0] == SUPPORTED_MAJOR and mm[1] > SUPPORTED_MINOR


def _unsupported_extension(m, required):
    exts = m.get("extensions") if m else None
    if not isinstance(exts, list):
        return False
    for e in exts:
        if isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] not in SUPPORTED_EXTENSIONS:
            # Fail-closed, matching the TS mapper: an entry is required unless
            # `required` is explicitly false (a missing/non-boolean value is required).
            is_required = e.get("required") is not False
            if is_required is required:
                return True
    return False


def required_extension_unsupported(data, cd):
    m = manifest_obj(data, cd)
    return m is not None and _unsupported_extension(m, required=True)


def optional_extension_unsupported(data, cd):
    m = manifest_obj(data, cd)
    return m is not None and _unsupported_extension(m, required=False)


CONFIRMERS = {
    "CDX-E-PART-DUPLICATE-KEYS": any_part_has_duplicate_key,
    "CDX-E-PART-NUMBER-NON-REPRESENTABLE": content_has_non_representable_number,
    "CDX-E-CONTENT-PART-MISSING": content_part_missing,
    "CDX-E-CONTENT-PART-UNPARSEABLE": content_unparseable,
    "CDX-E-MANIFEST-ABSENT": lambda data, cd: not any(e["name"] == "manifest.json" for e in cd),
    "CDX-E-MANIFEST-UNPARSEABLE": manifest_unparseable,
    "CDX-E-MANIFEST-STATE-UNKNOWN": state_unknown,
    "CDX-E-MANIFEST-VERSION-MALFORMED": version_malformed,
    "CDX-E-MANIFEST-REFERENCE-MALFORMED": reference_malformed,
    "CDX-E-MANIFEST-HASH-MALFORMED": hash_malformed,
    "CDX-E-MANIFEST-PATH-TRAVERSAL": content_path_traversal,
    "CDX-E-VERSION-MAJOR-UNSUPPORTED": major_unsupported,
    "CDX-E-VERSION-MINOR-UNSUPPORTED": minor_unsupported,
    "CDX-E-EXTENSION-REQUIRED-UNSUPPORTED": required_extension_unsupported,
    "CDX-E-EXTENSION-OPTIONAL-UNSUPPORTED": optional_extension_unsupported,
}


def confirm_clean(name, data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.namelist()
    except Exception as exc:  # noqa: BLE001
        return f"expected a clean archive, zipfile could not read it: {exc}"
    cd = parse_cd(data)
    cdm = cd_map(cd)
    mtext = part_text(data, cdm, "manifest.json")
    if mtext is None:
        return "clean case has no readable manifest.json"
    if has_duplicate_key(mtext):
        return "clean case manifest has a duplicate key"
    try:
        manifest = json.loads(mtext)
    except Exception as exc:  # noqa: BLE001
        return f"clean case manifest is not valid JSON: {exc}"
    path = (manifest.get("content") or {}).get("path") if isinstance(manifest.get("content"), dict) else None
    if not isinstance(path, str) or path not in cdm:
        return "clean case manifest does not reference an existing content part"
    ctext = part_text(data, cdm, path)
    if ctext is None or has_duplicate_key(ctext):
        return "clean case content part is missing or has a duplicate key"
    try:
        json.loads(ctext)
    except Exception as exc:  # noqa: BLE001
        return f"clean case content part is not valid JSON: {exc}"
    # §5.4.3: a duplicate key in ANY part REJECTs, so a genuinely clean fixture must
    # have none anywhere — not only in the manifest and content. Scan every JSON part
    # (Dublin Core, presentation, asset-index, ...), matching the reader's sweep.
    for e in cd:
        if e["name"].endswith(".json") and e["method"] == 0:
            text = part_text(data, {e["name"]: e}, e["name"])
            if text is not None and has_duplicate_key(text):
                return f"clean case part {e['name']} has a duplicate key"
    return None


def check():
    if not os.path.isdir(FIXTURES):
        print(f"FAIL: no fixtures directory at {FIXTURES}")
        return 1  # the document track is committed; a missing directory is a failure
    failures = 0
    n_malformed = 0
    n_clean = 0
    for name in sorted(os.listdir(FIXTURES)):
        cdir = os.path.join(FIXTURES, name)
        if not os.path.isdir(cdir):
            continue
        case = json.load(open(os.path.join(cdir, "case.json"), encoding="utf-8"))
        data = open(os.path.join(cdir, "case.cdx"), "rb").read()
        codes = [f["code"] for f in case.get("expect", {}).get("findings", [])]
        if not codes:
            err = confirm_clean(name, data)
            if err is None:
                n_clean += 1
            else:
                print(f"FAIL {name}: {err}")
                failures += 1
            continue
        cd = parse_cd(data)
        for code in codes:
            confirm = CONFIRMERS.get(code)
            if confirm is None:
                print(f"FAIL {name}: no independent confirmer for {code} (add one to CONFIRMERS)")
                failures += 1
                continue
            if confirm(data, cd):
                n_malformed += 1
            else:
                print(f"FAIL {name}: could not independently confirm {code} in case.cdx")
                failures += 1
    if failures:
        print(f"{failures} defect(s) not independently confirmed.")
        return 1
    print(f"confirmed {n_malformed} injected defect(s) present; {n_clean} clean document(s) loadable.")
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        sys.exit(check())
    print("usage: document_oracle.py check", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
