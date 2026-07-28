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

import hashlib
import io
import json
import math
import os
import re
import struct
import sys
import unicodedata
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
# The subset of the CDX algorithms the standard library can compute — the same set
# canonicalize_oracle.py uses. `blake3` is deliberately absent (no stdlib impl), so a
# blake3 file-hash / document-id is UN-CONFIRMABLE by this oracle, consistent with the
# reference reader (canonicalize.ts) also refusing to compute it. No B1b-3a fixture
# uses blake3, so this is never exercised there.
HASHLIB = {"sha256": hashlib.sha256, "sha384": hashlib.sha384, "sha512": hashlib.sha512,
           "sha3-256": hashlib.sha3_256, "sha3-512": hashlib.sha3_512}


class OracleUnsupported(Exception):
    """Raised when a fixture's content is richer than this oracle's INDEPENDENT
    document-id recompute models (see _recompute_id's whitelist). It is a loud
    signal to EXTEND the oracle, never a silent pass — a negative id-mismatch
    fixture that trips it fails the check; a clean fixture that trips it has its
    id cross-check skipped (the TS reader + Level-0 canonicalize vectors cover it)."""

# --- B1b-2 content block/mark classifier: independently RE-ENCODED vocabulary ---
# The recognized sets are transcribed from content.schema.json (the $defs/block open
# escape, $defs/knownMarkTypes, and the core string-mark enum), NOT imported from the
# TypeScript classifier under test (content-classifier.ts) — the same shared-nothing
# re-encoding used for the version/extension support envelope above. A registered
# namespaced identifier (academic:theorem, legal:cite, …) is in the known set, so it
# is neither an unknown-namespaced nor an unknown-bare defect.
# SYNC: the deliberate cost of the shared-nothing design — a change to the block/mark
# enums in schemas/content.schema.json requires a manual update of the three sets
# below. A stale set diverges from the TS on any fixture exercising the changed type,
# so the adapter/oracle fixture agreement catches it.
BLOCK_TYPES = {
    "text", "paragraph", "heading", "list", "listItem", "blockquote",
    "codeBlock", "image", "table", "tableRow", "tableCell", "math",
    "definitionList", "definitionItem", "definitionTerm", "definitionDescription",
    "measurement", "signature", "svg", "barcode", "figure", "figcaption",
    "horizontalRule", "break", "admonition",
    "academic:abstract", "academic:theorem", "academic:proof", "academic:algorithm",
    "academic:equation-group", "academic:exercise-set", "academic:exercise",
    "semantic:footnote", "semantic:bibliography", "semantic:term", "semantic:ref",
    "semantic:glossary", "semantic:measurement",
    "legal:caption", "legal:signatureBlock", "legal:tableOfAuthorities",
    "forms:form", "forms:textInput", "forms:textArea", "forms:checkbox",
    "forms:radioGroup", "forms:dropdown", "forms:datePicker", "forms:signature",
    "forms:submit", "presentation:reference",
}
# Every recognized mark identifier (7 core string marks + 13 structured marks).
KNOWN_MARKS = {
    "bold", "italic", "underline", "strikethrough", "code", "superscript", "subscript",
    "link", "anchor", "math", "citation", "footnote", "entity", "glossary",
    "academic:theorem-ref", "academic:equation-ref", "academic:algorithm-ref",
    "presentation:index", "presentation:footnote", "legal:cite",
}
# The core marks valid as a bare string.
STRING_MARKS = {"bold", "italic", "underline", "strikethrough", "code", "superscript", "subscript"}
# Blocks whose parent is structurally constrained (structural-constraints.ts REQUIRED_PARENT).
REQUIRED_PARENT = {"figcaption": "figure", "tableCell": "tableRow", "tableRow": "table"}
# The schema's extension-type form: a non-empty prefix, a colon, a non-empty suffix.
NS_RE = re.compile(r"[A-Za-z0-9_-]+:[A-Za-z0-9._:-]+")
ROOT_DOCUMENT = " root-document"
ROOT_EXCERPT = " root-excerpt"
# Recursion bound (canonicalize.ts MAX_CANONICALIZATION_DEPTH, re-encoded); the walk
# stops descending past it, symmetric with the TS classifier.
MAX_CONTENT_DEPTH = 256


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


def _declared_part_paths(data, cd):
    """Every part path the manifest names. A part is not obliged to be called `.json`
    (the relative-path form permits any name), so an extension-only sweep would let a
    declared part's duplicate keys escape the state-invariant REJECT."""
    m = manifest_obj(data, cd) or {}
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    collab = m.get("collaboration") if isinstance(m.get("collaboration"), dict) else {}
    phantoms = m.get("phantoms") if isinstance(m.get("phantoms"), dict) else {}
    custom = list(meta.get("custom").values()) if isinstance(meta.get("custom"), dict) else []
    refs = [meta.get("dublinCore"), meta.get("jsonld"), m.get("provenance"),
            collab.get("comments"), collab.get("changes"), phantoms.get("clusters"), *custom]
    return {r for r in refs if isinstance(r, str)}


def any_part_has_duplicate_key(data, cd):
    declared = _declared_part_paths(data, cd)
    for e in cd:
        if (e["name"].endswith(".json") or e["name"] in declared) and e["method"] == 0:
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



def _metadata_reference_malformed(data, cd):
    """`metadata` present but not an object, or `metadata.dublinCore` present but not a
    string. Both are required manifest fields, so a MISTYPED one is the section 5.4.2
    manifest-required-field REJECT, distinct from the absent case's metadata WARNING."""
    m = manifest_obj(data, cd)
    if m is None:
        return False
    if "metadata" not in m:
        return False
    meta = m["metadata"]
    if not isinstance(meta, dict):
        return True
    return "dublinCore" in meta and not isinstance(meta["dublinCore"], str)

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


# --- B1b-2 content block/mark classifier: independent re-derivation ----------
# A from-scratch reimplementation of content-classifier.ts, sharing no code with it.
# It walks the parsed content value and records which classifier defect classes are
# present; each confirmer below reports one class. Positive cases must record none.

def _content_value(data, cd):
    """The parsed content value referenced by the manifest, or None."""
    m = manifest_obj(data, cd)
    if m is None:
        return None
    c = m.get("content")
    path = c.get("path") if isinstance(c, dict) else None
    if not isinstance(path, str):
        return None
    text = part_text(data, cd_map(cd), path)
    if text is None:
        return None
    try:
        return json.loads(text)  # duplicate keys / big numbers are other codes' concern
    except json.JSONDecodeError:
        return None


def _block_malformed(block, parent_type):
    """checkBlock re-derived: upward containment + figure/definitionItem cardinality."""
    t = block.get("type")
    if t in REQUIRED_PARENT and parent_type != ROOT_EXCERPT and parent_type != REQUIRED_PARENT[t]:
        return True
    if t == "figure" and isinstance(block.get("children"), list):
        content = caption = 0
        for c in block["children"]:
            if isinstance(c, dict) and c.get("type") == "figcaption":
                caption += 1
            else:
                content += 1
        if content != 1 or caption > 1:
            return True
    if t == "definitionItem" and isinstance(block.get("children"), list):
        terms = descs = 0
        for c in block["children"]:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "definitionTerm":
                terms += 1
            elif c.get("type") == "definitionDescription":
                descs += 1
        if terms < 1 or descs < 1:
            return True
    return False


def _mark_malformed(t, mark):
    if t == "link":
        return not isinstance(mark.get("href"), str)
    if t == "anchor":
        return not isinstance(mark.get("id"), str)
    if t == "math":
        return not (isinstance(mark.get("format"), str) and isinstance(mark.get("source"), str))
    return t in STRING_MARKS  # a core string mark carried as an object is malformed


def _classify_mark(m, out):
    if isinstance(m, str):
        if m in STRING_MARKS:
            return
        if m in KNOWN_MARKS:
            out.add("mark_malformed")
        elif NS_RE.fullmatch(m):
            out.add("mark_ns")
        else:
            out.add("mark_bare")
        return
    if isinstance(m, dict):
        t = m.get("type")
        if not isinstance(t, str):
            out.add("mark_bare")
        elif t in KNOWN_MARKS:
            if _mark_malformed(t, m):
                out.add("mark_malformed")
        elif NS_RE.fullmatch(t):
            out.add("mark_ns")
        else:
            out.add("mark_bare")
        return
    out.add("mark_bare")  # neither string nor object


def _bad_container(node):
    # Mirror of content-classifier.ts hasMalformedContainer: a node-bearing field of
    # the wrong shape (children/subfigures/marks not a list; caption neither list nor
    # str). Applied to a block and to each subfigure object.
    return (
        ("children" in node and not isinstance(node["children"], list))
        or ("subfigures" in node and not isinstance(node["subfigures"], list))
        or ("marks" in node and not isinstance(node["marks"], list))
        or ("caption" in node and not isinstance(node["caption"], list) and not isinstance(node["caption"], str))
    )


def _walk(elements, parent_type, out, depth):
    # Mirror of content-classifier.ts `walk`: descend ONLY into CORE blocks. Unknown
    # blocks are opaque (namespaced=IGNORE render-a-fallback, bare=REJECT) and a
    # REGISTERED extension block (namespaced type in the known set) is recognized but
    # its interior is extension-defined, so it is not descended either. Classify marks
    # on the blocks that carry them, and bound the recursion depth.
    if depth > MAX_CONTENT_DEPTH:
        return
    for el in elements:
        if not isinstance(el, dict):
            out.add("block_bare")  # non-object in a block position: fail closed
            continue
        t = el.get("type")
        if isinstance(t, str) and t in BLOCK_TYPES:
            if NS_RE.fullmatch(t):
                continue  # registered extension block: recognized, opaque interior (deferred)
            bad_container = _bad_container(el) or (
                isinstance(el.get("subfigures"), list)
                and any((not isinstance(sf, dict)) or _bad_container(sf) for sf in el["subfigures"])
            )
            if _block_malformed(el, parent_type) or bad_container:
                out.add("block_malformed")
            if isinstance(el.get("marks"), list):
                for m in el["marks"]:
                    _classify_mark(m, out)
            if isinstance(el.get("children"), list):
                _walk(el["children"], t, out, depth + 1)
            if isinstance(el.get("caption"), list):
                _walk(el["caption"], t, out, depth + 1)
            subs = el.get("subfigures")
            if isinstance(subs, list):
                for sf in subs:
                    if not isinstance(sf, dict):
                        continue
                    if isinstance(sf.get("children"), list):
                        _walk(sf["children"], t, out, depth + 1)
                    if isinstance(sf.get("caption"), list):
                        _walk(sf["caption"], t, out, depth + 1)
            continue
        if isinstance(t, str) and NS_RE.fullmatch(t):
            out.add("block_ns")  # opaque: not descended
            continue
        out.add("block_bare")  # opaque: document is refused


def classify_content(data, cd):
    """The set of classifier defect classes present in the content tree."""
    out = set()
    val = _content_value(data, cd)
    if isinstance(val, dict) and isinstance(val.get("blocks"), list):
        _walk(val["blocks"], ROOT_DOCUMENT, out, 1)
    return out


# --- B1b-3a "declared vs computed": file-hash + document-id recompute ----------
# Independent (shared-nothing) confirmers for the §5.4.2 "File `hash` or document-ID
# mismatch" row. The file-hash check re-hashes the stored content bytes with `hashlib`
# (vs the reader's Node crypto). The document-id check re-derives the canonical id from
# scratch, reusing canonicalize_oracle.py's JCS+digest approach — NOT importing the TS.

def _hash_of(algorithm, raw):
    """`algorithm:hexdigest` over raw bytes, or None if the algorithm is un-computable
    here (blake3). Mirrors canonicalize_oracle.py's digest()."""
    fn = HASHLIB.get(algorithm)
    return None if fn is None else f"{algorithm}:{fn(raw).hexdigest()}"


def file_hash_mismatch(data, cd):
    """The declared file-level content.hash differs from sha256(stored content bytes).
    Present iff both are readable, the hash is well-formed and computable, and they differ."""
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    if not (isinstance(c, dict) and isinstance(c.get("path"), str) and isinstance(c.get("hash"), str)):
        return False  # a shape defect is CDX-E-MANIFEST-REFERENCE-MALFORMED
    declared = c["hash"]
    if not is_valid_content_hash(declared):
        return False  # a malformed hash is CDX-E-MANIFEST-HASH-MALFORMED
    e = cd_map(cd).get(c["path"])
    if e is None:
        return False  # a missing content part is CDX-E-CONTENT-PART-MISSING
    raw = store_bytes(data, e)
    if raw is None:
        return False  # non-Store / unreadable (the document fixtures are all Store)
    real = _hash_of(declared.split(":", 1)[0], raw)
    return real is not None and real != declared  # blake3 → un-confirmable


def _dublin_core_value(data, cd):
    """The parsed Dublin Core object the document id projects over. Mirrors the reader's
    dc-resolution gate: UNREFERENCED (no metadata.dublinCore) → `{}` (the id was computed
    over empty metadata); REFERENCED-AND-CLEAN → the parsed value. A REFERENCED-BUT-
    UNLOADABLE part (absent, duplicate-key, or unparseable) is INDETERMINATE, not `{}` —
    the reader skips the recompute for it (the missing/unparseable-DC defect is a B1b-3b
    row), so the oracle raises OracleUnsupported rather than recompute over a wrong basis."""
    m = manifest_obj(data, cd)
    if m is None:
        return {}
    meta = m.get("metadata")
    ref = meta.get("dublinCore") if isinstance(meta, dict) else None
    if not isinstance(ref, str):
        return {}  # unreferenced → empty-metadata basis
    text = part_text(data, cd_map(cd), ref)
    if text is None:
        raise OracleUnsupported("Dublin Core part referenced but absent")
    if has_duplicate_key(text):
        raise OracleUnsupported("Dublin Core part has a duplicate key")  # reader's parseStrictJson rejects it
    try:
        return json.loads(text)  # a non-object value is rejected downstream by _project_metadata
    except json.JSONDecodeError:
        raise OracleUnsupported("Dublin Core part referenced but unparseable")


def _require_inert_string(s):
    """Reject a string the reference canonicalizer would refuse (validateStoredByteInvariants,
    §4.3.2): not well-formed Unicode (a lone surrogate), or not in NFC. The reference throws
    on these — so the id is indeterminate and the oracle must not compute a (wrong) one, and
    must not crash on the later UTF-8 encode. Distinguishing absent (`t not in terms`) from a
    present JSON `null` matches the reference too (projectMetadata throws on a null term)."""
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        raise OracleUnsupported("metadata string is not well-formed Unicode")
    if unicodedata.normalize("NFC", s) != s:
        raise OracleUnsupported("metadata string is not in NFC")


def _project_metadata(dc):
    """Re-encode canonicalize.ts projectMetadata (§4.3.1): title/description as strings,
    creator/subject/language as string arrays (scalars coerced), empty values omitted. A
    malformed term (present but non-string / non-array, incl. a present `null`) or a string
    the reference rejects (non-NFC / ill-formed) raises OracleUnsupported, never silently
    drops — the reference throws on exactly these, so the id would be indeterminate."""
    out = {}
    if not isinstance(dc, dict):
        raise OracleUnsupported("Dublin Core is not an object")
    if "terms" not in dc:
        return out  # absent terms → no projected metadata
    terms = dc["terms"]  # a present `null` is not a dict → raises below, matching the reference
    if not isinstance(terms, dict):
        raise OracleUnsupported("Dublin Core `terms` is not an object")
    for t in ("title", "description"):
        if t not in terms:
            continue  # absent → omit (a present `null` falls through and raises below)
        v = terms[t]
        if not isinstance(v, str):
            raise OracleUnsupported(f"term {t} is not a string")
        _require_inert_string(v)
        if v != "":
            out[t] = v
    for t in ("creator", "subject", "language"):
        if t not in terms:
            continue
        v = terms[t]
        if isinstance(v, str):
            _require_inert_string(v)
            if v != "":
                out[t] = [v]
        elif isinstance(v, list):
            if not all(isinstance(e, str) for e in v):
                raise OracleUnsupported(f"term {t} array is not all strings")
            for e in v:
                _require_inert_string(e)
            ne = [e for e in v if e != ""]
            if ne:
                out[t] = ne
        else:
            raise OracleUnsupported(f"term {t} is neither a string nor an array")
    return out


def _assert_inert_content(content):
    """WHITELIST guard: the id recompute below assumes the canonical content transform
    (canonicalize.ts §4.3.1 — strip derived fields, resolve asset refs, normalize marks,
    merge text, relabel ids) is the IDENTITY. That holds ONLY for the transform-trivial
    content B1b-3a fixtures use: a root object with keys ⊆ {version, blocks}, a STRING
    version, and an EMPTY blocks array. Anything else (non-empty blocks, marks, ids,
    asset refs, crdt, numbers, …) is transformed and/or risks JCS number formatting, so
    the identity assumption would compute a WRONG id — raise, forcing the oracle to be
    extended, never silently mis-confirm. (canonicalize_oracle.py makes the analogous
    faithfulness assumption for hand-authored canonical objects.)"""
    if not isinstance(content, dict):
        raise OracleUnsupported("content value is not an object")
    for k, v in content.items():
        if k == "version":
            if not isinstance(v, str):
                raise OracleUnsupported("content.version is not a string")
            _require_inert_string(v)  # NFC + well-formed, mirroring validateStoredByteInvariants
        elif k == "blocks":
            if v != []:
                raise OracleUnsupported("content.blocks is not empty (non-inert; extend the oracle)")
        else:
            raise OracleUnsupported(f"content carries an un-modelled key {k!r}")


def _jcs(obj):
    """RFC 8785 JCS for ASCII-key, number-free content — as canonicalize_oracle.py."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _recompute_id(content, dc, algorithm):
    """The INDEPENDENT canonical document id for transform-inert content: build the
    {content, metadata} envelope (§4.2), JCS it, and digest. Raises OracleUnsupported
    if the content is not provably inert or the algorithm is un-computable here."""
    _assert_inert_content(content)
    if algorithm not in HASHLIB:
        raise OracleUnsupported(f"un-computable id algorithm {algorithm!r}")
    envelope = {"content": content, "metadata": _project_metadata(dc)}
    return _hash_of(algorithm, _jcs(envelope).encode("utf-8"))


def document_id_mismatch(data, cd):
    """The declared manifest.id differs from the recomputed canonical document id.
    Only for a real (non-pending, well-formed) id; may raise OracleUnsupported for
    content the oracle does not model (a loud signal, surfaced by check())."""
    m = manifest_obj(data, cd)
    if m is None:
        return False
    declared = m.get("id")
    if not (isinstance(declared, str) and is_valid_content_hash(declared)):
        return False  # pending / malformed id is not this row
    content = _content_value(data, cd)
    if content is None:
        return False
    recomputed = _recompute_id(content, _dublin_core_value(data, cd), declared.split(":", 1)[0])
    return recomputed != declared


# --- B1b-3b-1: required metadata, path-only parts, reference resolution --------
# Independent (shared-nothing) confirmers. The identifier namespace and the reference
# fields are RE-ENCODED from the specification here, never imported from the TypeScript:
# Document Hashing §4.3.1 item 5 for the namespace, and the same section's reference
# rewriting for which fields hold a Content Anchor URI.


def _dublin_core_defect(dc):
    """'malformed' | 'missing-term' | None. 'malformed' is everything the metadata
    projection REJECTS (§4.3.1) — a non-object `terms`, a wrong-typed string term, or an
    array term that is neither a string nor an array of strings. Kept distinct because the
    projection THROWS on those, which would otherwise silently disable the document-ID
    recompute; 'missing-term' is the narrower §3.3.1/§3.3.2 requirement and still projects."""
    terms = dc.get("terms")
    if terms is None and "terms" not in dc:
        return "missing-term"  # projects as {}, but title/creator are absent
    if not isinstance(terms, dict):
        return "malformed"
    for t in ("title", "description"):
        if t in terms and not isinstance(terms[t], str):
            return "malformed"
    for t in ("creator", "subject", "language"):
        if t not in terms or isinstance(terms[t], str):
            continue
        if not isinstance(terms[t], list) or not all(isinstance(e, str) for e in terms[t]):
            return "malformed"
    title = terms.get("title")
    if not isinstance(title, str) or title == "":
        return "missing-term"
    creator = terms.get("creator")
    if isinstance(creator, str):
        return "missing-term" if creator == "" else None
    if isinstance(creator, list) and any(isinstance(c, str) and c != "" for c in creator):
        return None
    return "missing-term"


def _dc_state(data, cd):
    """(state, parsed) for the Dublin Core part: one of 'unreferenced', 'absent',
    'unparseable', 'ok'. Mirrors the four arms of the missing-metadata row without
    reusing the reader's own resolution."""
    m = manifest_obj(data, cd)
    if m is None:
        return ("unreferenced", None)
    meta = m.get("metadata")
    if "metadata" in m and not isinstance(meta, dict):
        return ("mistyped", None)  # a mistyped required field is the manifest REJECT
    ref = meta.get("dublinCore") if isinstance(meta, dict) else None
    if ref is not None and not isinstance(ref, str):
        return ("mistyped", None)
    if not isinstance(ref, str):
        return ("unreferenced", None)
    text = part_text(data, cd_map(cd), ref)
    if text is None:
        return ("absent", None)
    if has_duplicate_key(text):
        return ("duplicate-key", None)  # the state-invariant REJECT, not this row
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return ("unparseable", None)
    return ("ok", value) if isinstance(value, dict) else ("unparseable", None)


def metadata_part_missing(data, cd):
    return _dc_state(data, cd)[0] in ("unreferenced", "absent")


def metadata_part_unparseable(data, cd):
    state, value = _dc_state(data, cd)
    # A loaded-but-unprojectable part counts too: the reader reports it here rather than
    # letting the projection throw inside the id recompute's catch.
    return state == "unparseable" or (state == "ok" and _dublin_core_defect(value) == "malformed")


def metadata_term_missing(data, cd):
    state, value = _dc_state(data, cd)
    return state == "ok" and _dublin_core_defect(value) == "missing-term"


def part_missing_unbound(data, cd):
    """A manifest reference carrying a path but NO hash whose target is not in the
    archive. Re-derived from the manifest schema: `provenance` and `metadata.jsonld` are
    bare relativePath strings, as are `collaboration.comments`/`.changes` and
    `phantoms.clusters`. A `{path, hash}` reference is a DIFFERENT row (it is bound by
    the manifest projection) and is deliberately not collected here."""
    m = manifest_obj(data, cd)
    if m is None:
        return False
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    collab = m.get("collaboration") if isinstance(m.get("collaboration"), dict) else {}
    phantoms = m.get("phantoms") if isinstance(m.get("phantoms"), dict) else {}
    custom = list(meta.get("custom").values()) if isinstance(meta.get("custom"), dict) else []
    refs = [m.get("provenance"), meta.get("jsonld"), collab.get("comments"),
            collab.get("changes"), phantoms.get("clusters"), *custom]
    names = {e["name"] for e in cd}
    return any(isinstance(r, str) and r not in names for r in refs)


# Field keys whose ARRAY items carry a relabelled sub-block id though they have no block
# `type` (§4.3.1 item 5), and the key whose items address a SEPARATE namespace.
_SUB_BLOCK_ID_ARRAYS = {"lines", "subfigures"}
_DATA_PAYLOAD_ID_ARRAYS = {"entries"}


def _defined_id(node, in_marks, in_array, parent_key):
    """§4.3.1 item 5's namespace, keyed on WHERE the node sits, not merely its shape.
    Inside `marks` only an `anchor` mark contributes. Outside it, a typed object is a
    block unless it is a data-payload entry; an untyped object contributes only as a
    `lines`/`subfigures` item. A `text` node's id is preserved verbatim, so it is out."""
    if in_marks:
        return node.get("id") if node.get("type") == "anchor" and isinstance(node.get("id"), str) else None
    if not isinstance(node.get("id"), str):
        return None
    if node.get("type") == "text":
        return None
    named_array_item = in_array and parent_key is not None
    if isinstance(node.get("type"), str):
        return None if named_array_item and parent_key in _DATA_PAYLOAD_ID_ARRAYS else node["id"]
    return node["id"] if named_array_item and parent_key in _SUB_BLOCK_ID_ARRAYS else None


def _is_derived_field(node, key):
    """Fields canon deletes before relabelling (§4.3.1 item 1; §4.1a), so ids inside them
    are not in the namespace at all."""
    if not isinstance(node.get("type"), str):
        return False
    if key == "crdt":
        return True
    if key == "display":
        return node["type"] == "measurement"
    if key == "tokens":
        return node["type"] == "codeBlock"
    return False


def _normalize_path(p):
    """Resolve ./.. segments, as canonicalize.ts normalizePath does."""
    out = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if out and out[-1] != "..":
                out.pop()
            else:
                out.append("..")
            continue
        out.append(seg)
    return "/".join(out)


def _is_packaged_asset_ref(v):
    """A link href resolveAssetRef would actually rewrite. ONLY an `assets/`-rooted path
    can hit the asset map — every key is `assets/<category>/…` and anything else comes
    back verbatim — so masking a wider set would merge nodes canon keeps distinct and
    destroy a real id collision."""
    if not isinstance(v, str) or v.startswith("#") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", v):
        return False
    return v.startswith("assets/") or _normalize_path(v).startswith("assets/")


def _merge_key(node):
    """The key mergeAdjacentText compares, modelled IN CANON'S ORDER: canon recurses into a
    child (deleting its derived fields, normalizing a text node's marks) and merges the
    array only afterwards. None when the node is not merge-eligible, so it breaks the run.
    `marks` is read verbatim when not a list — canon guards normalizeMarks on isArray and
    marksEqual then compares that raw value. A packaged-asset link href keys as one
    placeholder: canon resolves it to an asset hash before comparing, and without the asset
    index (B1b-3b-2) equality is undecidable — over-merging costs a missed collision,
    under-merging would be a FALSE INTEGRITY-ERROR on a document canon accepts."""
    if not (isinstance(node, dict) and node.get("type") == "text" and isinstance(node.get("value"), str)):
        return None
    kept = [k for k in node if not _is_derived_field(node, k)]
    if any(k not in ("type", "value", "marks") for k in kept):
        return None
    marks = node.get("marks")
    if isinstance(marks, list):
        masked = [dict(m, href=" asset") if isinstance(m, dict) and m.get("type") == "link"
                  and _is_packaged_asset_ref(m.get("href")) else m for m in marks]
        keyed = sorted(_jcs(m) for m in masked)
        normalized = "[" + ",".join(k for i, k in enumerate(keyed) if i == 0 or k != keyed[i - 1]) + "]"
    else:
        normalized = _jcs(marks if marks is not None else [])
    return normalized


def _drop_absorbed_text_nodes(arr):
    """Remove each text node mergeAdjacentText would fold into its predecessor (§4.3.1
    item 4). The absorbed node's marks vanish with it, so two adjacent text nodes bearing
    the SAME `anchor` id are ONE id after canonicalization, not a collision."""
    out, prev_key = [], None
    for node in arr:
        key = _merge_key(node)
        if key is not None and prev_key is not None and key == prev_key:
            continue
        prev_key = key
        out.append(node)
    return out


def _walk_content(value, visit, in_marks=False, in_array=False, parent_key=None, in_text_marks=False):
    """Raw-content walk reproducing every canon transform that changes which ids exist:
    adjacent merge-eligible text nodes with equal mark sets collapse, marks identical
    within ONE TEXT NODE's array dedup, and derived fields drop. The last two are scoped
    like canon's: it normalizes `marks` under `case 'text'` alone (so a non-text node's
    duplicate marks genuinely survive) and does NOT recurse into a text node's marks (so a
    derived field carried on or under such a mark survives and its ids ARE relabelled)."""
    if isinstance(value, list):
        items = value if in_text_marks else _drop_absorbed_text_nodes(value)
        for el in items:
            _walk_content(el, visit, in_marks, True, parent_key, in_text_marks)
        return
    if not isinstance(value, dict):
        return
    visit(value, in_marks, in_array, parent_key)
    for key in sorted(value.keys()):
        if not in_text_marks and _is_derived_field(value, key):
            continue
        child = value[key]
        if key == "marks" and value.get("type") == "text":
            # canon's skip is `type == 'text' and key == 'marks'` with NO list test, so the
            # subtree survives either way: in_text_marks must be set for a non-list `marks`
            # too, or derived fields inside one are erased here and kept there. in_marks
            # still requires a list, matching rewriteIds' dispatch.
            if isinstance(child, list):
                seen, deduped = set(), []
                for mark in child:
                    k = _jcs(mark)
                    if k in seen:
                        continue
                    seen.add(k)
                    deduped.append(mark)
                _walk_content(deduped, visit, True, False, key, True)
            else:
                _walk_content(child, visit, False, False, key, True)
            continue
        _walk_content(child, visit, key == "marks" and isinstance(child, list), False, key, in_text_marks)


def _collect_ids(content):
    """(unique ids in first-occurrence order, ids defined more than once)."""
    seen, ids, duplicates = set(), [], []

    def visit(node, in_marks, in_array, parent_key):
        i = _defined_id(node, in_marks, in_array, parent_key)
        if i is None:
            return
        if i in seen:
            duplicates.append(i)
        else:
            seen.add(i)
            ids.append(i)

    _walk_content(content, visit)
    return ids, duplicates


def _anchor_target(value):
    """The id of a Content Anchor URI `#id[/offset[-end]]`, or None if not a `#` ref."""
    if not isinstance(value, str) or not value.startswith("#"):
        return None
    slash = value.find("/")
    return value[1:] if slash == -1 else value[1:slash]


# The Content Anchor URI fields of §4.3.1 item 5, split by which §5.4.2 row a dangle hits.
_MARK_REFS = {"link": ("href", "anchor"), "academic:theorem-ref": ("target", "xref"),
              "academic:equation-ref": ("target", "xref"), "academic:algorithm-ref": ("target", "xref")}
_BLOCK_REFS = {"academic:proof": ("of", False), "academic:theorem": ("uses", True),
               "semantic:ref": ("target", False), "presentation:reference": ("target", False)}


def _content_reference_findings(data, cd):
    """{'anchor', 'block', 'xref', 'collision'} present in the content part."""
    content = _content_value(data, cd)
    out = set()
    if content is None:
        return out
    ids, duplicates = _collect_ids(content)
    if duplicates:
        out.add("collision")
    defined = set(ids)

    def visit(node, in_marks, in_array, parent_key):
        t = node.get("type")
        if not isinstance(t, str):
            return
        if in_marks:
            spec = _MARK_REFS.get(t)
            if spec and _anchor_target(node.get(spec[0])) not in (None, *defined):
                out.add(spec[1])
            return
        spec = _BLOCK_REFS.get(t)
        if spec is None:
            return
        field, many = spec
        values = node.get(field) if many and isinstance(node.get(field), list) else [node.get(field)]
        for v in values:
            if _anchor_target(v) not in (None, *defined):
                out.add("block")

    _walk_content(content, visit)
    return out


# Out-of-hash annotation parts, and the anchor positions their schemas DECLARE. A
# generic sweep would be wrong: phantoms embed a full content tree and collaboration
# change records carry verbatim before/after block snapshots naming removed content.
_ANNOTATION_ANCHORS = [("annotations", "anchor", None), ("comments", "anchor", None),
                       ("changes", "anchor", ("position", ("before", "after"))), ("clusters", "anchor", None)]
_OUT_OF_HASH_DIRS = ("collaboration/", "phantoms/", "forms/")
_OUT_OF_HASH_FILES = ("security/annotations.json",)


def _out_of_hash_paths(data, cd):
    """The conventional out-of-hash locations, plus EVERY path-only manifest reference
    wherever it points — the same set whose absence is the unbound-part row. Covering
    absence but not corruption would report the milder defect and miss the worse one.
    The manifest and content parts have their own rows and are excluded."""
    m = manifest_obj(data, cd) or {}
    paths = {e["name"] for e in cd
             if e["name"].endswith(".json") and (e["name"] in _OUT_OF_HASH_FILES or e["name"].startswith(_OUT_OF_HASH_DIRS))}
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    collab = m.get("collaboration") if isinstance(m.get("collaboration"), dict) else {}
    phantoms = m.get("phantoms") if isinstance(m.get("phantoms"), dict) else {}
    custom = list(meta.get("custom").values()) if isinstance(meta.get("custom"), dict) else []
    for ref in (m.get("provenance"), meta.get("jsonld"), collab.get("comments"),
                collab.get("changes"), phantoms.get("clusters"), *custom):
        if isinstance(ref, str):
            paths.add(ref)
    content = m.get("content")
    paths.discard("manifest.json")
    if isinstance(content, dict) and isinstance(content.get("path"), str):
        paths.discard(content["path"])
    return paths


def extension_data_part_unparseable(data, cd):
    """An out-of-hash extension data part present but not well-formed JSON. A duplicate
    key is the state-invariant REJECT instead, so it is excluded here."""
    cdm = cd_map(cd)
    for path in sorted(_out_of_hash_paths(data, cd)):
        text = part_text(data, cdm, path)
        if text is None or has_duplicate_key(text):
            continue
        try:
            json.loads(text)
        except json.JSONDecodeError:
            return True
    return False


def _annotation_paths(data, cd):
    """Scoped tighter than the unparseable sweep: only an ANNOTATION layer anchors into
    content, so an unrelated path-only part that happens to carry a `changes` array is not
    read as one."""
    m = manifest_obj(data, cd) or {}
    collab = m.get("collaboration") if isinstance(m.get("collaboration"), dict) else {}
    phantoms = m.get("phantoms") if isinstance(m.get("phantoms"), dict) else {}
    paths = {p for p in _out_of_hash_paths(data, cd)
             if p in _OUT_OF_HASH_FILES or p.startswith(_OUT_OF_HASH_DIRS)}
    for ref in (collab.get("comments"), collab.get("changes"), phantoms.get("clusters")):
        if isinstance(ref, str):
            paths.add(ref)
    return paths


def annotation_anchor_dangling(data, cd):
    content = _content_value(data, cd)
    if content is None:
        return False
    defined = set(_collect_ids(content)[0])
    cdm = cd_map(cd)
    for path in sorted(_annotation_paths(data, cd)):
        text = part_text(data, cdm, path)
        if text is None:
            continue
        try:
            part = json.loads(text)
        except json.JSONDecodeError:
            continue
        if not isinstance(part, dict):
            continue
        for array, anchor_field, block_id_spec in _ANNOTATION_ANCHORS:
            for element in part.get(array) or []:
                if not isinstance(element, dict):
                    continue
                anchor = element.get(anchor_field)
                if isinstance(anchor, dict) and isinstance(anchor.get("blockId"), str):
                    if anchor["blockId"] not in defined:
                        return True
                elif isinstance(anchor, str) and _anchor_target(anchor) not in (None, *defined):
                    return True
                if block_id_spec is not None:
                    holder = element.get(block_id_spec[0])
                    if isinstance(holder, dict):
                        for key in block_id_spec[1]:
                            v = holder.get(key)
                            if isinstance(v, str) and v not in defined:
                                return True
    return False


CONFIRMERS = {
    "CDX-E-PART-DUPLICATE-KEYS": any_part_has_duplicate_key,
    "CDX-E-METADATA-PART-MISSING": metadata_part_missing,
    "CDX-E-METADATA-PART-UNPARSEABLE": metadata_part_unparseable,
    "CDX-E-METADATA-TERM-MISSING": metadata_term_missing,
    "CDX-E-PART-MISSING-UNBOUND": part_missing_unbound,
    "CDX-E-EXTENSION-DATA-PART-UNPARSEABLE": extension_data_part_unparseable,
    "CDX-E-ANNOTATION-ANCHOR-DANGLING": annotation_anchor_dangling,
    "CDX-E-ANCHOR-DANGLING": lambda data, cd: "anchor" in _content_reference_findings(data, cd),
    "CDX-E-BLOCK-REFERENCE-DANGLING": lambda data, cd: "block" in _content_reference_findings(data, cd),
    "CDX-E-CROSS-REFERENCE-DANGLING": lambda data, cd: "xref" in _content_reference_findings(data, cd),
    "CDX-E-ID-COLLISION": lambda data, cd: "collision" in _content_reference_findings(data, cd),
    "CDX-E-BLOCK-TYPE-UNKNOWN-BARE": lambda data, cd: "block_bare" in classify_content(data, cd),
    "CDX-E-BLOCK-TYPE-UNKNOWN-NAMESPACED": lambda data, cd: "block_ns" in classify_content(data, cd),
    "CDX-E-BLOCK-MALFORMED": lambda data, cd: "block_malformed" in classify_content(data, cd),
    "CDX-E-MARK-TYPE-UNKNOWN-BARE": lambda data, cd: "mark_bare" in classify_content(data, cd),
    "CDX-E-MARK-TYPE-UNKNOWN-NAMESPACED": lambda data, cd: "mark_ns" in classify_content(data, cd),
    "CDX-E-MARK-MALFORMED": lambda data, cd: "mark_malformed" in classify_content(data, cd),
    "CDX-E-PART-NUMBER-NON-REPRESENTABLE": content_has_non_representable_number,
    "CDX-E-CONTENT-PART-MISSING": content_part_missing,
    "CDX-E-CONTENT-PART-UNPARSEABLE": content_unparseable,
    "CDX-E-MANIFEST-ABSENT": lambda data, cd: not any(e["name"] == "manifest.json" for e in cd),
    "CDX-E-MANIFEST-UNPARSEABLE": manifest_unparseable,
    "CDX-E-MANIFEST-STATE-UNKNOWN": state_unknown,
    "CDX-E-MANIFEST-VERSION-MALFORMED": version_malformed,
    "CDX-E-MANIFEST-REFERENCE-MALFORMED": lambda data, cd: reference_malformed(data, cd) or _metadata_reference_malformed(data, cd),
    "CDX-E-MANIFEST-HASH-MALFORMED": hash_malformed,
    "CDX-E-MANIFEST-PATH-TRAVERSAL": content_path_traversal,
    "CDX-E-VERSION-MAJOR-UNSUPPORTED": major_unsupported,
    "CDX-E-VERSION-MINOR-UNSUPPORTED": minor_unsupported,
    "CDX-E-EXTENSION-REQUIRED-UNSUPPORTED": required_extension_unsupported,
    "CDX-E-EXTENSION-OPTIONAL-UNSUPPORTED": optional_extension_unsupported,
    "CDX-E-FILE-HASH-MISMATCH": file_hash_mismatch,
    "CDX-E-DOCUMENT-ID-MISMATCH": document_id_mismatch,
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
    # AND every manifest-declared part path, matching the reader's sweep (a part need
    # not be named `.json`).
    declared_clean = _declared_part_paths(data, cd)
    for e in cd:
        if (e["name"].endswith(".json") or e["name"] in declared_clean) and e["method"] == 0:
            text = part_text(data, {e["name"]: e}, e["name"])
            if text is not None and has_duplicate_key(text):
                return f"clean case part {e['name']} has a duplicate key"
    # B1b-2: a genuinely clean fixture's content tree must carry no unknown/malformed
    # block or mark — otherwise it would not be CLEAN. Independently re-derive.
    findings = classify_content(data, cd)
    if findings:
        return f"clean case content has block/mark classifier finding(s): {sorted(findings)}"
    # B1b-3b-1: a genuinely clean document must have required metadata, no dangling
    # reference of any kind, no id collision, and no unreadable out-of-hash part — a
    # reader that skipped any of these checks would otherwise pass this fixture.
    dc_state, dc_value = _dc_state(data, cd)
    if dc_state in ("unreferenced", "absent"):
        return "clean case has no readable Dublin Core part"
    if dc_state == "unparseable":
        return "clean case Dublin Core part is not a JSON object"
    if dc_state == "ok" and _dublin_core_defect(dc_value) is not None:
        return "clean case Dublin Core is malformed or omits a required term (title / creator)"
    if part_missing_unbound(data, cd):
        return "clean case declares a path-only part reference that the archive omits"
    if extension_data_part_unparseable(data, cd):
        return "clean case has an unparseable out-of-hash extension data part"
    if annotation_anchor_dangling(data, cd):
        return "clean case has an out-of-hash annotation anchored at no content id"
    refs = _content_reference_findings(data, cd)
    if refs:
        return f"clean case content has reference finding(s): {sorted(refs)}"
    # B1b-3a: a clean fixture's declared file hash must match the stored bytes, and — for
    # a document carrying a real id — the recomputed canonical document id must match it.
    # Otherwise a reader that skips hash/id verification would wrongly pass this fixture.
    if file_hash_mismatch(data, cd):
        return "clean case content.hash does not match the stored content bytes"
    declared_id = manifest.get("id")
    if isinstance(declared_id, str) and is_valid_content_hash(declared_id):
        try:
            recomputed = _recompute_id(json.loads(ctext), _dublin_core_value(data, cd), declared_id.split(":", 1)[0])
            if recomputed != declared_id:
                return "clean case recomputed document id does not match manifest.id"
        except OracleUnsupported:
            pass  # content richer than the oracle models — the TS reader + Level-0
            # canonicalize vectors cover its id; a wrong id would still make the reader
            # emit CDX-E-DOCUMENT-ID-MISMATCH and fail check:conformance.
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
            try:
                confirmed = confirm(data, cd)
            except OracleUnsupported as exc:
                # A negative fixture whose content the id recompute does not model —
                # a loud signal to extend the oracle's whitelist, never a silent pass.
                print(f"FAIL {name}: confirmer for {code} cannot model this fixture ({exc}); extend the oracle")
                failures += 1
                continue
            if confirmed:
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
