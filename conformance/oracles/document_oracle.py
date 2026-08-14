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
    manifest-required-field REJECT, distinct from the referenced-but-absent case's metadata WARNING (an absent FIELD is itself REJECT, via manifest_field_missing)."""
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


def _text_violation(s):
    """The section 4.3.2 item-2 violation class of one string: "ill-formed" (an unpaired
    surrogate) or "non-nfc", else None. Independently re-derived; shares no code with
    canonicalize.ts storedTextViolation.

    Well-formedness is tested first, and by a genuinely different mechanism than the
    reference: CPython detects a lone surrogate by refusing to UTF-8 encode it, where the
    reference scans code units. NFC is the one predicate the two implementations cannot
    derive independently — both ask their runtime's Unicode tables — so the independence
    here is that CPython's and V8's tables AGREE, not that the logic differs. A Unicode
    version skew between them would surface as a fixture disagreement.
    """
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        return "ill-formed"
    if unicodedata.normalize("NFC", s) != s:
        return "non-nfc"
    return None


def _walk_text_violations(value, out, in_derived=False, in_text_marks=False):
    """Record every section 4.3.2 item-2 violation class present in the HASHED material.

    Scans object KEYS as well as string values, and each maximal run of two or more
    adjacent text nodes as a CONCATENATION — a combining sequence split across a
    text-node boundary leaves each node's own value in NFC while the run is not.

    Scope is what canonicalization HASHES: section 5.4.2's rows and both codes bind a
    "hashed object key or string value", and a field canon deletes (crdt, a measurement
    display, a codeBlock tokens) is not hashed. Suppression stops at a TEXT NODE's marks,
    which canon does not recurse into, so a derived field carried under such a mark
    survives canonicalization and IS reported.
    """
    if isinstance(value, str):
        if in_derived:
            return
        v = _text_violation(value)
        if v:
            out.add(v)
    elif isinstance(value, list):
        run, run_nodes = "", 0
        for el in value:
            if isinstance(el, dict) and el.get("type") == "text" and isinstance(el.get("value"), str):
                run += el["value"]
                run_nodes += 1
            else:
                if not in_derived and run_nodes >= 2 and unicodedata.normalize("NFC", run) != run:
                    out.add("non-nfc")
                run, run_nodes = "", 0
            _walk_text_violations(el, out, in_derived, in_text_marks)
        if not in_derived and run_nodes >= 2 and unicodedata.normalize("NFC", run) != run:
            out.add("non-nfc")
    elif isinstance(value, dict):
        for k, v in value.items():
            if not in_derived:
                kv = _text_violation(k)
                if kv:
                    out.add(kv)
            _walk_text_violations(
                v,
                out,
                in_derived or (not in_text_marks and _is_derived_field(value, k)),
                in_text_marks or (k == "marks" and value.get("type") == "text"),
            )


def stored_text_violations(data, cd):
    """The set of section 4.3.2 item-2 violation classes in the document's HASHED basis:
    the whole content part, plus the five PROJECTED Dublin Core terms only.

    Scoping the metadata half to the projected terms is deliberate — section 4.3.1 keeps
    only title/description/creator/subject/language, so a non-NFC `terms.rights` never
    enters the document id and must not reject the document.
    """
    out = set()
    val = _content_value(data, cd)
    if val is not None:
        _walk_text_violations(val, out)
    m = manifest_obj(data, cd)
    meta = m.get("metadata") if isinstance(m, dict) else None
    dc_path = meta.get("dublinCore") if isinstance(meta, dict) else None
    if isinstance(dc_path, str):
        text = part_text(data, cd_map(cd), dc_path)
        if text is not None:
            try:
                dc = json.loads(text)
            except json.JSONDecodeError:
                dc = None
            terms = dc.get("terms") if isinstance(dc, dict) else None
            if isinstance(terms, dict):
                for t in ("title", "description", "creator", "subject", "language"):
                    if t in terms:
                        _walk_text_violations(terms[t], out)
    return out


def content_root_malformed(data, cd):
    """The content part parses but violates its root envelope (Content Blocks 2.2, 7.1):
    not an object, or `version`/`blocks` absent or of the wrong JSON type.

    Independently re-derived, sharing no code with content-classifier.ts checkContentRoot.
    Note the guard in classify_content above is the reason this defect class matters: that
    walk (and the reference implementation's, independently) descends only when `blocks` IS
    a list, so a non-list `blocks` withdraws every content-level defect class at once.

    The root is OPEN — an unrecognized extra member is NOT this defect — and the `version`
    VALUE is not checked, only its type; a value-invalid version has no section 5.4.2 row.
    Returns False when the part is absent or will not parse: those are other codes.

    Parseability is re-derived here rather than read off _content_value, which returns None
    for "absent", "unparseable" AND a content part of literal `null` — three states the
    shared helper's callers do not need to tell apart but this one does, since a `null`
    root IS this defect (the reference reports it; a None-means-absent reading would not).
    """
    m = manifest_obj(data, cd)
    if m is None:
        return False
    c = m.get("content")
    path = c.get("path") if isinstance(c, dict) else None
    if not isinstance(path, str):
        return False
    text = part_text(data, cd_map(cd), path)
    if text is None:
        return False  # absent: CDX-E-CONTENT-PART-MISSING
    try:
        val = json.loads(text)
    except json.JSONDecodeError:
        return False  # CDX-E-CONTENT-PART-UNPARSEABLE
    if not isinstance(val, dict):
        return True
    if not isinstance(val.get("version"), str):
        return True
    if not isinstance(val.get("blocks"), list):
        return True
    return False


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
    # A MISTYPED reference is not the empty-metadata basis: the reader treats the
    # declaration as unusable and suspends the recompute (dcResolvable = false), so
    # projecting {} here would model a different document. _dc_state draws the same
    # line; the two resolutions in this file must not disagree on it.
    if ("metadata" in m and not isinstance(meta, dict)) or (
        isinstance(meta, dict) and "dublinCore" in meta and not isinstance(meta["dublinCore"], str)
    ):
        raise OracleUnsupported("Dublin Core reference is mistyped; the id basis is indeterminate")
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
    """(state, parsed) for the Dublin Core part: one of 'no-manifest', 'unreferenced',
    'mistyped', 'absent', 'unparseable', 'duplicate-key', 'ok'. Mirrors the arms the reader distinguishes without
    reusing its own resolution. 'unreferenced' and 'mistyped' are MANIFEST defects
    (a required field absent or wrong-typed, both REJECT); only 'absent',
    'unparseable' and a missing term are the PART-level metadata row."""
    m = manifest_obj(data, cd)
    if m is None:
        # No usable manifest at all — the manifest-absent/unparseable rows, not a FIELD
        # defect. Kept distinct so manifest_field_missing cannot rubber-stamp a fixture
        # whose recipe simply dropped or corrupted manifest.json.
        return ("no-manifest", None)
    meta = m.get("metadata")
    if "metadata" in m and not isinstance(meta, dict):
        return ("mistyped", None)  # a mistyped required field is the manifest REJECT
    # `in` rather than a None test: JSON null is a PRESENT but wrong-typed value
    # (manifest.schema.json types dublinCore as a relativePath string), so it is mistyped,
    # not unreferenced. _metadata_reference_malformed below already models it this way.
    if isinstance(meta, dict) and "dublinCore" in meta and not isinstance(meta["dublinCore"], str):
        return ("mistyped", None)
    ref = meta.get("dublinCore") if isinstance(meta, dict) else None
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
    # 'unreferenced' is deliberately NOT here: an absent `metadata` or `metadata.dublinCore`
    # field is a malformed manifest (manifest_field_missing below), not a part-level defect.
    # Section 5.4.2's metadata row is explicitly PART-level.
    return _dc_state(data, cd)[0] == "absent"


def manifest_field_missing(data, cd):
    # `metadata` is a required manifest field and `dublinCore` is required within it, so a
    # manifest carrying neither is missing a required field — the manifest REJECT row.
    return _dc_state(data, cd)[0] == "unreferenced"


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


def _resolve_link_href_for_merge(m, asset_map):
    """normalizeMarks' href resolution, WITHOUT resolveAssetRef's throw — branch order
    mirrors canonicalize.ts `resolveLinkHrefForMerge` exactly: a `#` reference and a
    scheme-bearing URL come back verbatim, THEN the map is consulted, and only a MISS that is
    `assets/`-rooted becomes the placeholder. Consulting the map before testing the prefix
    matters because buildAssetMap does not constrain an index entry's `path`: an entry whose
    path escapes its category directory registers a key that is not `assets/`-rooted, and
    gating the LOOKUP on that prefix would key two aliased hrefs differently and fail to merge
    nodes the canonicalizer merges."""
    if not (isinstance(m, dict) and m.get("type") == "link" and isinstance(m.get("href"), str)):
        return m
    href = m["href"]
    if href.startswith("#") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", href):
        return m
    resolved = asset_map.get(_normalize_path(href))
    if resolved is not None:
        return dict(m, href=resolved)
    return dict(m, href="\u0000unresolved-asset") if _is_packaged_asset_ref(href) else m


def _merge_key(node, asset_map=None):
    """The key mergeAdjacentText compares, modelled IN CANON'S ORDER: canon recurses into a
    child (deleting its derived fields, normalizing a text node's marks) and merges the
    array only afterwards. None when the node is not merge-eligible, so it breaks the run.
    `marks` is read verbatim when not a list — canon guards normalizeMarks on isArray and
    marksEqual then compares that raw value.

    A packaged-asset link href resolves through `asset_map` exactly as normalizeMarks does,
    so hrefs naming the same bytes under different paths compare EQUAL (their nodes merge)
    while hrefs naming different bytes stay distinct (their nodes do not). A miss falls back
    to a placeholder rather than raising: canon rejects such a document outright, and
    over-merging costs a missed collision where under-merging would be a FALSE
    INTEGRITY-ERROR on a document canon accepts."""
    if not (isinstance(node, dict) and node.get("type") == "text" and isinstance(node.get("value"), str)):
        return None
    kept = [k for k in node if not _is_derived_field(node, k)]
    if any(k not in ("type", "value", "marks") for k in kept):
        return None
    marks = node.get("marks")
    if isinstance(marks, list):
        amap = asset_map or {}
        masked = [_resolve_link_href_for_merge(m, amap) for m in marks]
        keyed = sorted(_jcs(m) for m in masked)
        normalized = "[" + ",".join(k for i, k in enumerate(keyed) if i == 0 or k != keyed[i - 1]) + "]"
    else:
        normalized = _jcs(marks if marks is not None else [])
    return normalized


def _drop_absorbed_text_nodes(arr, asset_map=None):
    """Remove each text node mergeAdjacentText would fold into its predecessor (§4.3.1
    item 4). The absorbed node's marks vanish with it, so two adjacent text nodes bearing
    the SAME `anchor` id are ONE id after canonicalization, not a collision."""
    out, prev_key = [], None
    for node in arr:
        key = _merge_key(node, asset_map)
        if key is not None and prev_key is not None and key == prev_key:
            continue
        prev_key = key
        out.append(node)
    return out


def _walk_content(value, visit, in_marks=False, in_array=False, parent_key=None, in_text_marks=False, asset_map=None):
    """Raw-content walk reproducing every canon transform that changes which ids exist:
    adjacent merge-eligible text nodes with equal mark sets collapse, marks identical
    within ONE TEXT NODE's array dedup, and derived fields drop. The last two are scoped
    like canon's: it normalizes `marks` under `case 'text'` alone (so a non-text node's
    duplicate marks genuinely survive) and does NOT recurse into a text node's marks (so a
    derived field carried on or under such a mark survives and its ids ARE relabelled)."""
    if isinstance(value, list):
        items = value if in_text_marks else _drop_absorbed_text_nodes(value, asset_map)
        for el in items:
            _walk_content(el, visit, in_marks, True, parent_key, in_text_marks, asset_map)
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
                _walk_content(deduped, visit, True, False, key, True, asset_map)
            else:
                _walk_content(child, visit, False, False, key, True, asset_map)
            continue
        _walk_content(child, visit, key == "marks" and isinstance(child, list), False, key, in_text_marks, asset_map)


def _collect_ids(content, asset_map=None):
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

    _walk_content(content, visit, asset_map=asset_map)
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
    # The asset map decides which adjacent text nodes MERGE, so it decides which ids
    # survive into the namespace — without it two nodes linking to DIFFERENT assets
    # over-merge and a real collision goes unseen.
    ids, duplicates = _collect_ids(content, _asset_map(data, cd))
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


# --- B1b-3c-1a: anchor POSITION validity (03a sections 2.2, 3, 7.3) ------------
# Independently re-derived. One genuine independence property worth naming: Python's
# len() on a str counts CODE POINTS natively, where the reference must opt in with
# Array.from — so the two implementations reach the same unit by different mechanisms,
# and an implementation that silently reverted to UTF-16 units would disagree here.

# ASCII digits and fullmatch, both deliberate — Python's regex defaults differ from the
# ECMA-262 semantics the schema's `contentAnchorUri` pattern is written in, and each default
# makes this oracle ACCEPT a suffix the reference rejects:
#   * `\d` on a str matches every Unicode decimal digit, so `#p1/0-٥` parses here (int('٥')
#     is 5) while JS `\d` and the schema's literal [0-9] reject it;
#   * `$` matches before a trailing newline, so `#p1/0-99\n` parses here and not there.
# Either way the oracle would "independently confirm" an out-of-range finding on a document
# the reference reports as structurally invalid — the shared-nothing check confirming a
# defect that is not there. `re.fullmatch` and an explicit [0-9] remove both.
_URI_POINT = re.compile(r"([0-9]+)")
_URI_RANGE = re.compile(r"([0-9]+)-([0-9]+)")


def _uri_position(value):
    """The position component of a Content Anchor URI: None, ('point', n), ('range', a, b),
    or ('bad', raw) for a suffix the URI grammar does not admit."""
    if not isinstance(value, str) or "/" not in value:
        return None
    raw = value.split("/", 1)[1]
    m = _URI_POINT.fullmatch(raw)
    if m:
        return ("point", int(m.group(1)))
    m = _URI_RANGE.fullmatch(raw)
    if m:
        return ("range", int(m.group(1)), int(m.group(2)))
    return ("bad", raw)


def _object_position(anchor):
    """The position a ContentAnchor OBJECT expresses (03a section 2.2's combination rule)."""
    has = lambda k: anchor.get(k) is not None or k in anchor  # noqa: E731
    ho, hs, he = has("offset"), has("start"), has("end")
    if not (ho or hs or he):
        return None
    if ho and (hs or he):
        return ("bad", "offset alongside start/end")
    if hs != he:
        return ("bad", "half range")
    # A JSON Schema "integer" accepts 1.0 and 1e0, which Python's json parses as float while
    # the reference's Number.isInteger accepts. Rejecting a float outright made this oracle
    # stricter than both the schema and the reference, so it refused a conformant anchor —
    # invisible to the obvious probe, since JSON.stringify writes 1.0 back out as 1 and only
    # hand-written bytes reach the case.
    def ok_int(v):
        if isinstance(v, bool):
            return False
        if isinstance(v, int):
            return v >= 0
        return isinstance(v, float) and v.is_integer() and v >= 0
    if ho:
        return ("point", anchor["offset"]) if ok_int(anchor.get("offset")) else ("bad", "offset")
    if ok_int(anchor.get("start")) and ok_int(anchor.get("end")):
        return ("range", anchor["start"], anchor["end"])
    return ("bad", "start/end")


# SYNC: transcribed from content.schema.json's block dispatch — the block types whose
# `children.items` are textNode. The reference derives this from the schema; the oracle
# re-encodes it by hand, as it does BLOCK_TYPES and KNOWN_MARKS, for the same
# shared-nothing reason. Matches 03a section 3's own enumeration: "paragraph, heading,
# figcaption, definitionTerm, and codeBlock".
#
# `codeBlock` reaches textNode through an allOf that narrows it (section 4: exactly one
# marks-free text node), not through a direct $ref. Both implementations dropped it at first
# — the reference by matching only a direct $ref, this file by copying that result rather
# than section 3 — which reported a conformant anchor into a code block as targeting a
# non-text-bearing block. Transcribe from the SPECIFICATION here, never from the reference's
# output, or the shared-nothing check confirms the reference's own mistake.
TEXT_BEARING_TYPES = {"codeBlock", "definitionTerm", "figcaption", "heading", "paragraph"}


def _anchor_targets(content):
    """id -> ('anchor-mark', 0) | ('text-bearing', code_point_length) | ('other', 0).

    Mirrors 03a section 3: a block's text content is the concatenation of its text-node
    children, and only a block whose children ARE text nodes has text content of its own.
    """
    targets = {}

    def visit(node, in_marks, in_array, parent_key):
        nid = _defined_id(node, in_marks, in_array, parent_key)
        if nid is None or nid in targets:
            return
        if in_marks:
            targets[nid] = ("anchor-mark", 0)
            return
        kids = node.get("children")
        # Text-bearing is decided by BOTH type and child shape. Shape alone cannot
        # separate an empty paragraph from an empty blockquote — they are structurally
        # identical and differ only in `type` — so a purely structural test would call an
        # empty container text-bearing and accept a position against it (03a section 3).
        if node.get("type") in TEXT_BEARING_TYPES and isinstance(kids, list) and all(
            isinstance(k, dict) and k.get("type") == "text" and isinstance(k.get("value"), str) for k in kids
        ):
            targets[nid] = ("text-bearing", len("".join(k["value"] for k in kids)))
        else:
            targets[nid] = ("other", 0)

    _walk_content(content, visit)
    return targets


def _position_verdict(pos, target):
    """'invalid' | 'out-of-range' | None for one position against its target."""
    if pos is None:
        return None
    if pos[0] == "bad":
        return "invalid"
    if pos[0] == "range" and not pos[1] < pos[2]:
        return "invalid"
    if target is None:
        return None  # unresolved: the dangling row owns it
    kind, length = target
    if kind in ("anchor-mark", "other"):
        return "invalid"
    largest = pos[1] if pos[0] == "point" else pos[2]
    return "out-of-range" if largest > length else None


def _anchor_position_findings(data, cd):
    """Anchor-position findings in the HASHED content, TAGGED BY 5.4.2 ROW.

    Yields 'invalid' and/or 'out-of-range:<row>' for row in {anchor, block, xref} — the
    same three rows the dangling arm above splits across, and derived here from the same
    two tables, because a position defect takes the row of the FIELD carrying it. The
    out-of-range rows disagree on the frozen/published column (the core-anchor row
    escalates; the cross-reference row is WARNING in every state), so an oracle returning
    one undifferentiated 'out-of-range' would confirm any of the three codes for any of
    the fields and could not catch a reader that routed them to the wrong row.

    The STRUCTURAL arm stays untagged, matching the single CDX-E-ANCHOR-POSITION-INVALID:
    its disposition is null in every row, so no row distinction is expressible.
    """
    content = _content_value(data, cd)
    out = set()
    if content is None:
        return out
    targets = _anchor_targets(content)

    def check(value, row):
        if not isinstance(value, str) or not value.startswith("#"):
            return
        v = _position_verdict(_uri_position(value), targets.get(_anchor_target(value)))
        if v == "out-of-range":
            out.add(f"out-of-range:{row}")
        elif v:
            out.add(v)

    def visit(node, in_marks, in_array, parent_key):
        t = node.get("type")
        if not isinstance(t, str):
            return
        if in_marks:
            spec = _MARK_REFS.get(t)
            if spec:
                check(node.get(spec[0]), spec[1])
            return
        spec = _BLOCK_REFS.get(t)
        if spec is None:
            return
        field, many = spec
        values = node.get(field) if many and isinstance(node.get(field), list) else [node.get(field)]
        for v in values:
            check(v, "block")

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


def annotation_anchor_position_invalid(data, cd):
    """An out-of-hash annotation anchor carries a defective position — structurally
    invalid OR out of bounds. ONE class out of hash, where hashed content splits the two:
    both take the same section 5.4.2 row in both columns, so the split would record a
    distinction the specification does not make."""
    content = _content_value(data, cd)
    if content is None:
        return False
    targets = _anchor_targets(content)
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
        for array, anchor_field, _block_id_spec in _ANNOTATION_ANCHORS:
            for element in part.get(array) or []:
                if not isinstance(element, dict):
                    continue
                anchor = element.get(anchor_field)
                if isinstance(anchor, dict) and isinstance(anchor.get("blockId"), str):
                    if _position_verdict(_object_position(anchor), targets.get(anchor["blockId"])):
                        return True
                elif isinstance(anchor, str) and anchor.startswith("#"):
                    if _position_verdict(_uri_position(anchor), targets.get(_anchor_target(anchor))):
                        return True
    return False


def annotation_anchor_dangling(data, cd):
    content = _content_value(data, cd)
    if content is None:
        return False
    defined = set(_collect_ids(content, _asset_map(data, cd))[0])
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


# --- B1b-3b-2: assets, presentation, and the config-slot side files -----------
# INDEPENDENCE, stated plainly. Asset PATH RESOLUTION below is a genuine from-scratch
# re-derivation: joining `assets/<category>/` with an index entry's `path`, normalizing,
# and matching is simple enough to re-derive without reference to the TS, so a porting slip
# in the reader would show up here. The same holds for the hash chain (hashlib vs Node
# crypto) and the presence sweeps.
#
# What this section does NOT confirm is the DOCUMENT ID of an asset-bearing fixture.
# `_assert_inert_content` accepts only an empty `blocks` array, and an asset-bearing
# document necessarily has a non-empty one, so `confirm_clean` takes its OracleUnsupported
# path and the id arm is silently off for those cases. Confirming it would mean porting the
# whole of Document Hashing section 4.3.1 into Python — strip derived fields, resolve asset
# refs, normalize and dedupe marks, merge adjacent text, alpha-rename, JCS. That is out of
# proportion to this slice, so the coverage is placed elsewhere instead: the Level-0
# `document-id` vectors carry two hand-authored asset cases (expected canonical bytes
# transcribed by hand, digests taken with shasum), which pin exactly the resolution and
# transform ORDERING the Level-1 fixtures exercise.

_ASSET_DIR = "assets/"


def _asset_categories(data, cd):
    """`manifest.assets` as a dict of category -> declaration, or {}."""
    m = manifest_obj(data, cd) or {}
    assets = m.get("assets")
    return assets if isinstance(assets, dict) else {}


def _asset_index(data, cd, category):
    """The parsed index for a category, read from the DERIVED path, or None. Asset
    Embedding section 3.1 requires the declared `index` to EQUAL that path and section
    5.4.2 rejects a divergence, so for every loadable document the two name one file;
    reading the derived path keeps this oracle on the bytes the document ID is built
    from (section 4.3.1 item 2 derives every asset path from the category key)."""
    text = part_text(data, cd_map(cd), f"assets/{category}/index.json")
    if text is None:
        return None
    try:
        val = json.loads(text)
    except Exception:  # noqa: BLE001
        return None
    return val if isinstance(val, dict) else None


def _asset_entries(index):
    """The index's asset entries, or [] when it carries no `assets` array."""
    entries = index.get("assets") if isinstance(index, dict) else None
    return [a for a in entries if isinstance(a, dict)] if isinstance(entries, list) else []


def _unresolvable_categories(data, cd):
    """Categories whose index is absent or carries no `assets` array — their references
    are indeterminate rather than dangling."""
    out = set()
    for category in _asset_categories(data, cd):
        index = _asset_index(data, cd, category)
        if index is None or not isinstance(index.get("assets"), list):
            out.add(category)
    return out


def _asset_map(data, cd):
    """archive path -> declared hash, over the categories that loaded.

    The join is NORMALIZED, here and at every other `assets/<category>/<path>` join below:
    Asset Embedding section 3.2 matches a reference "after path normalization", so an entry
    whose `path` carries a dot segment is stored at, and referenced by, the normalized
    location. Joining without normalizing looks for an archive entry that cannot exist."""
    out = {}
    for category in _asset_categories(data, cd):
        index = _asset_index(data, cd, category)
        if index is None:
            continue
        for a in _asset_entries(index):
            if isinstance(a.get("path"), str) and isinstance(a.get("hash"), str):
                out[_normalize_path(f"assets/{category}/{a['path']}")] = a["hash"]
    return out


def asset_index_path_divergent(data, cd):
    for category, declared in _asset_categories(data, cd).items():
        index = declared.get("index") if isinstance(declared, dict) else None
        if isinstance(index, str) and index != f"assets/{category}/index.json":
            return True
    return False


def asset_index_unusable(data, cd):
    """An index PRESENT but unusable: not JSON, not an object, or no `assets` array."""
    cdm = cd_map(cd)
    for category in _asset_categories(data, cd):
        text = cdm.get(f"assets/{category}/index.json")
        if text is None:
            continue  # absent is CDX-E-PART-MISSING-BOUND
        index = _asset_index(data, cd, category)
        if index is None or not isinstance(index.get("assets"), list):
            return True
    return False


def asset_index_hash_mismatch(data, cd):
    cdm = cd_map(cd)
    for category, declared in _asset_categories(data, cd).items():
        if not isinstance(declared, dict) or not is_valid_content_hash(declared.get("hash")):
            continue
        e = cdm.get(f"assets/{category}/index.json")
        if e is None:
            continue
        raw = store_bytes(data, e)
        if raw is None:
            continue
        real = _hash_of(declared["hash"].split(":", 1)[0], raw)
        if real is not None and real != declared["hash"]:
            return True
    return False


def asset_hash_mismatch(data, cd):
    """An asset's — or a present variant's — bytes differ from the index's declared hash."""
    cdm = cd_map(cd)
    for category in _asset_categories(data, cd):
        index = _asset_index(data, cd, category)
        if index is None:
            continue
        for a in _asset_entries(index):
            targets = [(a.get("path"), a.get("hash"))]
            if isinstance(a.get("variants"), list):
                targets += [(v.get("path"), v.get("hash")) for v in a["variants"] if isinstance(v, dict)]
            for path, declared in targets:
                if not isinstance(path, str) or not is_valid_content_hash(declared):
                    continue
                e = cdm.get(_normalize_path(f"assets/{category}/{path}"))
                if e is None:
                    continue  # absence is a different row
                raw = store_bytes(data, e)
                if raw is None:
                    continue
                real = _hash_of(declared.split(":", 1)[0], raw)
                if real is not None and real != declared:
                    return True
    return False


def asset_variant_missing(data, cd):
    cdm = cd_map(cd)
    for category in _asset_categories(data, cd):
        index = _asset_index(data, cd, category)
        if index is None:
            continue
        for a in _asset_entries(index):
            for v in a.get("variants", []) if isinstance(a.get("variants"), list) else []:
                if isinstance(v, dict) and isinstance(v.get("path"), str) and _normalize_path(f"assets/{category}/{v['path']}") not in cdm:
                    return True
    return False


def _presentation_entries(data, cd):
    m = manifest_obj(data, cd) or {}
    entries = m.get("presentation")
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def _config_file_refs(data, cd):
    """Every `{path, hash}` pair declared in an extension config slot — the set the
    manifest projection binds (Security Extension section 9.7). Re-derived by walking the
    four slots for two-key {path, hash} objects, as the projector does."""
    m = manifest_obj(data, cd) or {}
    found = []

    def visit(v):
        if isinstance(v, dict):
            if set(v.keys()) == {"path", "hash"} and isinstance(v.get("path"), str) and is_valid_content_hash(v.get("hash")):
                found.append((v["path"], v["hash"]))
                return
            for x in v.values():
                visit(x)
        elif isinstance(v, list):
            for x in v:
                visit(x)

    for slot in ("academic", "semantic", "legal", "collaboration"):
        visit(m.get(slot))
    return found


def part_missing_bound(data, cd):
    """A hash-BOUND referenced part absent from the archive: a declared presentation
    layer, a category's index file, or an asset the index lists."""
    cdm = cd_map(cd)
    for category in _asset_categories(data, cd):
        if f"assets/{category}/index.json" not in cdm:
            return True
        index = _asset_index(data, cd, category)
        if index is None:
            continue
        for a in _asset_entries(index):
            if isinstance(a.get("path"), str) and _normalize_path(f"assets/{category}/{a['path']}") not in cdm:
                return True
    for entry in _presentation_entries(data, cd):
        path = entry.get("path")
        if not isinstance(path, str):
            continue
        if path not in cdm:
            return True
        # The reader emits this code for a declared layer that is PRESENT but will not parse
        # too — a hash-bound part that cannot be obtained either way. A duplicate key is the
        # state-invariant REJECT instead, so it is excluded.
        text = part_text(data, cdm, path)
        if text is not None and not has_duplicate_key(text):
            try:
                json.loads(text)
            except json.JSONDecodeError:
                return True
    return False


def presentation_hash_mismatch(data, cd):
    cdm = cd_map(cd)
    for entry in _presentation_entries(data, cd):
        if not isinstance(entry.get("path"), str) or not is_valid_content_hash(entry.get("hash")):
            continue
        e = cdm.get(entry["path"])
        if e is None:
            continue
        raw = store_bytes(data, e)
        if raw is None:
            continue
        real = _hash_of(entry["hash"].split(":", 1)[0], raw)
        if real is not None and real != entry["hash"]:
            return True
    return False


_PRESENTATION_TYPES = {"paginated", "continuous", "responsive", "precise"}


def presentation_undeclared(data, cd):
    """A LAYOUT file under `presentation/` that no manifest.presentation[] entry declares, so
    no hash binds it (Presentation Layers section 12). Membership is decided by the file's own
    discriminator (section 13.3) — `presentationType` for a precise layout, `type` for a
    reactive one — not by location alone: an unrelated file parked under the directory is an
    unrecognized file, which State Machine section 5.4.2 IGNOREs."""
    declared = {e["path"] for e in _presentation_entries(data, cd) if isinstance(e.get("path"), str)}
    cdm = cd_map(cd)
    for e in cd:
        name = e["name"]
        if not name.startswith("presentation/") or name.endswith("/") or name in declared:
            continue
        text = part_text(data, cdm, name)
        if text is None:
            continue
        try:
            part = json.loads(text)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(part, dict):
            continue
        discriminator = part.get("presentationType", part.get("type"))
        if isinstance(discriminator, str) and discriminator in _PRESENTATION_TYPES:
            return True
    return False


def config_part_missing(data, cd):
    cdm = cd_map(cd)
    for path, _hash in _config_file_refs(data, cd):
        if path not in cdm:
            return True
        text = part_text(data, cdm, path)
        if text is None:
            continue
        try:
            json.loads(text)
        except json.JSONDecodeError:
            if not has_duplicate_key(text):
                return True
    return False


def config_file_hash_mismatch(data, cd):
    cdm = cd_map(cd)
    for path, declared in _config_file_refs(data, cd):
        e = cdm.get(path)
        if e is None:
            continue
        raw = store_bytes(data, e)
        if raw is None:
            continue
        real = _hash_of(declared.split(":", 1)[0], raw)
        if real is not None and real != declared:
            return True
    return False


def _config_value(data, cd, slot_key, member):
    """(declared, parsed-value) for `manifest.<slot>.<member>` — a {path, hash} reference.
    `declared and value is None` means the namespace is INDETERMINATE, not empty."""
    m = manifest_obj(data, cd) or {}
    slot = m.get(slot_key)
    ref = slot.get(member) if isinstance(slot, dict) else None
    path = ref.get("path") if isinstance(ref, dict) else None
    if not isinstance(path, str):
        return False, None
    text = part_text(data, cd_map(cd), path)
    if text is None:
        return True, None
    try:
        return True, json.loads(text)
    except Exception:  # noqa: BLE001
        return True, None


def _asset_reference_findings(data, cd):
    """Every unresolvable packaged-asset reference in the content, mirroring which nodes
    the canonicalizer actually resolves: `image`/`svg` `src` and `signature` `image`
    (honouring `external`), and a `link` mark href taken from the TEXT node that owns it —
    the canonicalizer resolves link hrefs only under `case 'text'`. References into an
    unresolvable category are indeterminate and excluded."""
    content = _content_value(data, cd)
    if content is None:
        return False
    amap = _asset_map(data, cd)
    unresolvable = _unresolvable_categories(data, cd)
    hits = []

    def check(value, external):
        if external or not isinstance(value, str):
            return
        if value.startswith("#") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value):
            return
        normalized = _normalize_path(value)
        if not (value.startswith(_ASSET_DIR) or normalized.startswith(_ASSET_DIR)):
            return
        if normalized in amap:
            return
        parts = normalized.split("/")
        if len(parts) >= 3 and parts[1] in unresolvable:
            return
        hits.append(normalized)

    def walk(node, in_text_marks):
        if isinstance(node, list):
            for x in node:
                walk(x, in_text_marks)
            return
        if not isinstance(node, dict):
            return
        if not in_text_marks:
            t = node.get("type")
            if t in ("image", "svg"):
                check(node.get("src"), node.get("external") is True)
            elif t == "signature":
                check(node.get("image"), node.get("external") is True)
            elif t == "text" and isinstance(node.get("marks"), list):
                for mk in node["marks"]:
                    if isinstance(mk, dict) and mk.get("type") == "link":
                        check(mk.get("href"), False)
        for key, child in node.items():
            walk(child, in_text_marks or (key == "marks" and node.get("type") == "text"))

    walk(content, False)
    return bool(hits)


def _presentation_reference_findings(data, cd):
    """A presentation rule targeting a block id the content does not define."""
    content = _content_value(data, cd)
    if content is None:
        return False
    ids = _collect_ids(content, _asset_map(data, cd))[0]
    cdm = cd_map(cd)
    for entry in _presentation_entries(data, cd):
        path = entry.get("path")
        if not isinstance(path, str):
            continue
        text = part_text(data, cdm, path)
        if text is None:
            continue
        try:
            part = json.loads(text)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(part, dict):
            continue
        targets = []
        for page in part.get("pages", []) if isinstance(part.get("pages"), list) else []:
            for el in page.get("elements", []) if isinstance(page, dict) and isinstance(page.get("elements"), list) else []:
                if not isinstance(el, dict):
                    continue
                targets.append(el.get("blockId"))
                if isinstance(el.get("blockIds"), list):
                    targets += el["blockIds"]
        for section in part.get("sections", []) if isinstance(part.get("sections"), list) else []:
            if isinstance(section, dict) and isinstance(section.get("blockRefs"), list):
                targets += section["blockRefs"]
        if any(isinstance(t, str) and t not in ids for t in targets):
            return True
    return False


def _semantic_reference_findings(data, cd):
    """{'citation', 'glossary'} for the namespaces that have a dangling reference. A
    DECLARED-but-unloadable side file leaves its namespace indeterminate, so nothing in it
    is reported."""
    content = _content_value(data, cd)
    if content is None:
        return set()
    bib_declared, bib_value = _config_value(data, cd, "semantic", "bibliography")
    gls_declared, gls_value = _config_value(data, cd, "semantic", "glossary")

    # PRECEDENCE, not union (Semantic Extension sections 4.4 and 8.3): a DECLARED external
    # side file is the single authoritative source and the in-document fallback is not
    # consulted; with no declaration, the in-document source IS the namespace. `None` means
    # indeterminate — declared but unloadable.
    def walk_blocks(node, visit):
        if isinstance(node, list):
            for x in node:
                walk_blocks(x, visit)
        elif isinstance(node, dict):
            visit(node)
            for x in node.values():
                walk_blocks(x, visit)

    bib_ids = None if (bib_declared and bib_value is None) else set()
    if bib_ids is not None:
        if bib_declared:
            if isinstance(bib_value, dict) and isinstance(bib_value.get("entries"), list):
                bib_ids |= {e["id"] for e in bib_value["entries"] if isinstance(e, dict) and isinstance(e.get("id"), str)}
        else:
            def visit_bib(node):
                if node.get("type") == "semantic:bibliography" and isinstance(node.get("entries"), list):
                    bib_ids.update(e["id"] for e in node["entries"] if isinstance(e, dict) and isinstance(e.get("id"), str))
            walk_blocks(content, visit_bib)

    gls_ids = None if (gls_declared and gls_value is None) else set()
    if gls_ids is not None:
        if gls_declared:
            if isinstance(gls_value, dict) and isinstance(gls_value.get("terms"), list):
                gls_ids |= {t["id"] for t in gls_value["terms"] if isinstance(t, dict) and isinstance(t.get("id"), str)}
        else:
            # Section 8.3 rule 2: the in-document `semantic:term` blocks are the source.
            def visit_term(node):
                if node.get("type") == "semantic:term" and isinstance(node.get("id"), str):
                    gls_ids.add(node["id"])
            walk_blocks(content, visit_term)

    out = set()

    def walk(node, in_marks):
        if isinstance(node, list):
            for x in node:
                walk(x, in_marks)
            return
        if not isinstance(node, dict):
            return
        t = node.get("type")
        if in_marks and t == "citation" and isinstance(node.get("refs"), list) and bib_ids is not None:
            if any(isinstance(r, str) and r not in bib_ids for r in node["refs"]):
                out.add("citation")
        if in_marks and t == "glossary" and gls_ids is not None and isinstance(node.get("ref"), str) and node["ref"] not in gls_ids:
            out.add("glossary")
        if not in_marks and t == "semantic:term" and isinstance(node.get("see"), list) and gls_ids is not None:
            if any(isinstance(s, str) and s not in gls_ids for s in node["see"]):
                out.add("glossary")
        for key, child in node.items():
            walk(child, key == "marks" and isinstance(child, list))

    walk(content, False)
    return out


def _footnote_findings(data, cd):
    """{'dangling', 'ambiguous'} for the footnote defects present (Semantic Extension 4.5.2).

    Independent of the TypeScript resolver and of `_semantic_reference_findings` above: the
    footnote namespace is not a flat id set. A mark resolves by `id` when both sides carry
    one, otherwise by its `number` or `symbol` marker, and a marker matching more than one
    block is ambiguous rather than dangling. Counting the blocks per marker is what tells
    those two apart, so a set would collapse the distinction this pair of codes exists to
    draw. No side file is consulted: 4.5.2 gives footnotes none, so unlike the citation and
    glossary arms there is no indeterminate case.

    MODELLING LIMIT, stated so it is not mistaken for agreement. Of the three canon transforms
    that change which nodes exist (CollectOptions.rawInput in canonicalize.ts), this walk
    models only DERIVED-FIELD DELETION. It does not model adjacent-text merging or mark dedup,
    so a `semantic:footnote` carried on the marks of a text node canon ABSORBS into its
    predecessor is counted here and not by the reader. Narrow, and no fixture reaches it, but
    the direction is the harmful one: an over-collecting oracle can CONFIRM a clean case the
    reader would report. Closing it means porting `mergeKeyOf`, which needs the asset map.
    """
    content = _content_value(data, cd)
    if content is None:
        return set()

    ids = set()
    numbers = {}
    symbols = {}
    marks = []

    def marker(value):
        """The marker key a JSON number contributes, or None.

        JSON has ONE number type, so ANY number is a marker — this must not key on the
        Python type. `json.loads` yields `int` for `1` and `float` for `1.0`, but they are
        the same JSON value and 4.3.1's JCS renders both as `1`; Python dicts unify them
        for free, since `1 == 1.0` and their hashes are equal. Rejecting non-integers here
        instead (an earlier version did) makes the oracle disagree with the FORMAT rather
        than with the implementation: a schema-invalid `1.5` is not rejected by either side,
        so the oracle would silently fail to model a mark the reader does resolve. `True` is
        an `int` in Python but is not a JSON number, so it is excluded explicitly.
        """
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        return None

    def is_derived_field(node, key):
        """Mirror of `isDerivedField` (canonicalize.ts) — 4.3.1 item 1 and 4.1a.

        Deliberately keyed the same way the canonicalizer keys it, not approximately: canon
        strips only under a TYPED node, `display` only on a `measurement`, and `tokens` only
        on a `codeBlock`. An earlier version here erased `crdt`/`tokens` unconditionally and
        keyed `display` on the enclosing PROPERTY name, which both over- and under-erased
        against `canonicalContent`. Over-erasure is the harmful direction: it would let the
        oracle CONFIRM a dangling expectation the reader raised for a different reason.
        """
        if not isinstance(node.get("type"), str):
            return False
        if key == "crdt":
            return True
        if key == "display":
            return node["type"] == "measurement"
        if key == "tokens":
            return node["type"] == "codeBlock"
        return False

    def walk(node, in_marks, in_text_marks=False):
        if isinstance(node, list):
            for x in node:
                walk(x, in_marks, in_text_marks)
            return
        if not isinstance(node, dict):
            return
        t = node.get("type")
        if not in_marks and t == "semantic:footnote":
            if isinstance(node.get("id"), str):
                ids.add(node["id"])
            n = marker(node.get("number"))
            if n is not None:
                numbers[n] = numbers.get(n, 0) + 1
            s = node.get("symbol")
            if isinstance(s, str):
                symbols[s] = symbols.get(s, 0) + 1
        if in_marks and t == "footnote":
            marks.append(node)
        for key, child in node.items():
            # 4.3.1 item 1 DELETES these before the canonical form exists, so a footnote block
            # buried in one is not a resolution target. Modelled here because this oracle now
            # guards clean cases: without it, a clean fixture the reference implementation
            # correctly reports as dangling would be confirmed loadable.
            #
            # The erasure stops AT OR BELOW a TEXT node's `marks` — canon normalizes that
            # subtree in place and then does not recurse into it, so a derived field carried
            # there survives. `in_text_marks` is therefore STICKY once set, matching
            # WalkContext.inTextMarks; an earlier version reused `in_marks`, which both reset
            # at the next non-`marks` key and fired for a `marks` array on a non-text node.
            if not in_text_marks and is_derived_field(node, key):
                continue
            child_in_marks = key == "marks" and isinstance(child, list)
            walk(child, child_in_marks, in_text_marks or (child_in_marks and t == "text"))

    walk(content, False)

    out = set()
    for mark in marks:
        if isinstance(mark.get("id"), str) and mark["id"] in ids:
            continue  # id match takes precedence
        n = marker(mark.get("number"))
        has_key = isinstance(mark.get("id"), str) or n is not None or isinstance(mark.get("symbol"), str)
        if not has_key:
            # No resolution key at all: a structurally malformed mark (4.5.1 requires either
            # `number` or `symbol`), not a reference whose target is absent. Reported by
            # neither implementation — see resolveFootnoteMark.
            continue
        count = None
        if n is not None:
            count = numbers.get(n, 0)
        if (count is None or count == 0) and isinstance(mark.get("symbol"), str):
            count = symbols.get(mark["symbol"], 0)
        if count is None or count == 0:
            out.add("dangling")
        elif count > 1:
            out.add("ambiguous")
    return out


CONFIRMERS = {
    "CDX-E-FOOTNOTE-REFERENCE-DANGLING": lambda data, cd: "dangling" in _footnote_findings(data, cd),
    "CDX-E-FOOTNOTE-REFERENCE-AMBIGUOUS": lambda data, cd: "ambiguous" in _footnote_findings(data, cd),
    "CDX-E-CONTENT-ROOT-MALFORMED": content_root_malformed,
    "CDX-E-PART-STRING-NOT-NFC": lambda data, cd: "non-nfc" in stored_text_violations(data, cd),
    "CDX-E-PART-STRING-ILL-FORMED": lambda data, cd: "ill-formed" in stored_text_violations(data, cd),
    "CDX-E-PART-DUPLICATE-KEYS": any_part_has_duplicate_key,
    "CDX-E-PART-MISSING-BOUND": part_missing_bound,
    "CDX-E-ASSET-INDEX-UNUSABLE": asset_index_unusable,
    "CDX-E-ASSET-INDEX-HASH-MISMATCH": asset_index_hash_mismatch,
    "CDX-E-ASSET-HASH-MISMATCH": asset_hash_mismatch,
    "CDX-E-ASSET-VARIANT-MISSING": asset_variant_missing,
    "CDX-E-ASSET-INDEX-PATH-DIVERGENT": asset_index_path_divergent,
    "CDX-E-ASSET-REFERENCE-DANGLING": _asset_reference_findings,
    "CDX-E-PRESENTATION-HASH-MISMATCH": presentation_hash_mismatch,
    "CDX-E-PRESENTATION-UNDECLARED": presentation_undeclared,
    "CDX-E-PRESENTATION-REFERENCE-DANGLING": _presentation_reference_findings,
    "CDX-E-CONFIG-PART-MISSING": config_part_missing,
    "CDX-E-CONFIG-FILE-HASH-MISMATCH": config_file_hash_mismatch,
    "CDX-E-CITATION-REFERENCE-DANGLING": lambda data, cd: "citation" in _semantic_reference_findings(data, cd),
    "CDX-E-GLOSSARY-REFERENCE-DANGLING": lambda data, cd: "glossary" in _semantic_reference_findings(data, cd),
    "CDX-E-MANIFEST-FIELD-MISSING": manifest_field_missing,
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
    "CDX-E-ANCHOR-POSITION-OUT-OF-RANGE": lambda data, cd: "out-of-range:anchor" in _anchor_position_findings(data, cd),
    "CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE": lambda data, cd: "out-of-range:block" in _anchor_position_findings(data, cd),
    "CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE": lambda data, cd: "out-of-range:xref" in _anchor_position_findings(data, cd),
    "CDX-E-ANNOTATION-ANCHOR-POSITION-INVALID": annotation_anchor_position_invalid,
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
    # B1b-3c-1a: a genuinely clean fixture's content root must satisfy its envelope.
    # This arm is not optional and is checked BEFORE the classifier below: classify_content
    # descends only when `blocks` is a list, so a clean fixture whose envelope silently
    # broke would report no classifier findings and be confirmed loadable — the walk going
    # quiet is indistinguishable from the walk finding nothing.
    if content_root_malformed(data, cd):
        return "clean case content root violates its envelope (not an object, or version/blocks absent or mistyped)"
    # B1b-3c-1a: a genuinely clean fixture's hashed basis must satisfy section 4.3.2's
    # stored-byte TEXT invariants in every state, so a clean case carrying one is not
    # clean. Without this arm the astral positive control would have NO independent
    # confirmation: it exists to prove a well-formed surrogate PAIR is accepted, and a
    # reader that silently stopped checking well-formedness would still pass it.
    text_violations = stored_text_violations(data, cd)
    if text_violations:
        return f"clean case hashed basis violates the stored-byte text invariants: {sorted(text_violations)}"
    # B1b-3c-1a: a clean fixture's anchor positions must be valid and in bounds. Without
    # this arm the two positive controls (an in-bounds range, and one ending exactly at
    # the text length) would have NO independent confirmation — both exist to prove a
    # check does NOT fire, which a reader that stopped checking entirely also satisfies.
    position_findings = _anchor_position_findings(data, cd)
    if position_findings:
        return f"clean case content has anchor-position finding(s): {sorted(position_findings)}"
    if annotation_anchor_position_invalid(data, cd):
        return "clean case out-of-hash annotation anchor carries a defective position"
    # B1b-2: a genuinely clean fixture's content tree must carry no unknown/malformed
    # block or mark — otherwise it would not be CLEAN. Independently re-derive.
    findings = classify_content(data, cd)
    if findings:
        return f"clean case content has block/mark classifier finding(s): {sorted(findings)}"
    # B1b-3b-1: a genuinely clean document must have required metadata, no dangling
    # reference of any kind, no id collision, and no unreadable out-of-hash part — a
    # reader that skipped any of these checks would otherwise pass this fixture.
    dc_state, dc_value = _dc_state(data, cd)
    if dc_state in ("no-manifest", "unreferenced", "mistyped", "absent"):
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
    # B1b-3b-2: a genuinely clean document's hash-bound material must all be present and
    # verified — every asset index, asset and variant; every declared presentation layer;
    # every config-slot side file — and every asset, presentation and cross-reference must
    # resolve. Without these arms a reader that skipped the whole asset chain would still
    # pass positive-asset-resolved.
    if part_missing_bound(data, cd):
        return "clean case is missing a hash-bound part (asset index, listed asset, or presentation layer)"
    if asset_index_unusable(data, cd):
        return "clean case has an asset index that cannot be used to resolve the category"
    if asset_index_path_divergent(data, cd):
        return "clean case declares an asset index path that differs from the derived location"
    if asset_index_hash_mismatch(data, cd):
        return "clean case asset index does not match its declared hash"
    if asset_hash_mismatch(data, cd):
        return "clean case asset or variant does not match its declared hash"
    if asset_variant_missing(data, cd):
        return "clean case lists an image variant the archive omits"
    if _asset_reference_findings(data, cd):
        return "clean case content references an asset that resolves to no registered asset"
    if presentation_hash_mismatch(data, cd):
        return "clean case presentation layer does not match its declared hash"
    if presentation_undeclared(data, cd):
        return "clean case ships a presentation file no manifest.presentation[] entry declares"
    if _presentation_reference_findings(data, cd):
        return "clean case presentation targets a block id the content does not define"
    if config_part_missing(data, cd):
        return "clean case declares a config-slot side file that is absent or unparseable"
    if config_file_hash_mismatch(data, cd):
        return "clean case config-slot side file does not match its declared hash"
    semantic = _semantic_reference_findings(data, cd)
    if semantic:
        return f"clean case has dangling cross-reference(s): {sorted(semantic)}"
    # Without this arm the positive footnote fixture had NO independent confirmation: the
    # footnote confirmer was wired into CONFIRMERS (which only ever checks that an EXPECTED
    # defect is present) but not here, so a clean fixture whose footnotes silently stopped
    # resolving would still be reported loadable — the one check that would catch a shared
    # error between the two implementations.
    footnotes = _footnote_findings(data, cd)
    if footnotes:
        return f"clean case has footnote resolution defect(s): {sorted(footnotes)}"
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
            #
            # SAY IT PLAINLY: every ASSET-BEARING positive lands here, because
            # _assert_inert_content accepts only an empty `blocks` array and an
            # asset-bearing document necessarily has a non-empty one. So the ids of
            # positive-asset-resolved, positive-asset-variant-resolved and
            # positive-aliased-assets-merge are NOT confirmed by this oracle. Their
            # coverage is the two hand-authored asset vectors in
            # conformance/vectors/document-id.json, whose expected canonical bytes were
            # transcribed by hand and digested with shasum — that is where the asset
            # resolution and transform ordering are independently pinned.
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
