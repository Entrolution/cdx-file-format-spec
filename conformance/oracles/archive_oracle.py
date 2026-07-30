#!/usr/bin/env python3
"""
Independent defect-presence oracle for the Level-1 container fixtures.

NON-NORMATIVE testing artifact. It exists to keep the container fixtures HONEST
under the suite's oracle discipline: a malformed fixture's defect must actually be
PRESENT in the committed `case.cdx` bytes, confirmed by an implementation that
shares no code with the TypeScript reader under test (scripts/lib/zip-reader.ts)
AND does not lean on Python's lenient `zipfile` for the malformed cases.

This tool is Python + standard library only. It hand-parses the ZIP central
directory and local file headers with `struct`, so a bug in the TS writer that
emitted a fixture the TS reader rejects *for the wrong reason* (e.g. a "duplicate"
the writer actually de-duplicated) is caught here rather than passing green.

Independence is by separate implementation, not a different algorithm for every
axis: the fixed ZIP layout forces the CD/LFH parsing to resemble the reader's, so
this is byte-level re-derivation in another language. Where the reader's logic is
subtlest (the stray-entry walk) the oracle deliberately diverges — it brute-scans
for the local-header signature rather than walking by declared sizes.

For each committed case:
  * it reads case.json for the intended finding codes;
  * for a malformed case it CONFIRMS the specific structural anomaly the code
    names is present in case.cdx (two central records of one name, a symlink mode
    bit, an unsafe name, a local/central name mismatch, a stray local header, an
    absurd declared size, or a missing EOCD);
  * for a clean case (no findings) it confirms `zipfile` opens the archive and
    enumerates its entries — corroborating it is a real, readable ZIP.

Usage: archive_oracle.py check
"""

import io
import json
import os
import struct
import sys
import zipfile
import zlib

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures", "container")

SIG_LFH = 0x04034B50
SIG_CD = 0x02014B50
SIG_EOCD = 0x06054B50

S_IFLNK = 0o120000

WINDOWS_DEVICES = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}


def find_eocd(data):
    """Return (cd_offset, cd_size, cd_count, eocd_pos) or None."""
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
    """Yield central-directory records as dicts, using the actual CD start
    (eocd_pos - cd_size) so a self-extracting-stub prefix is handled."""
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
        (ver_made, _need, flags, method, _t, _d, crc, comp, uncomp,
         namelen, extralen, commentlen, _disk, _iattr, extattr, local_off) = struct.unpack_from(
            "<HHHHHHIIIHHHHHII", data, p + 4)
        name_bytes = data[p + 46: p + 46 + namelen]
        out.append({
            "name_bytes": name_bytes,
            "method": method, "flags": flags, "crc": crc, "comp": comp, "uncomp": uncomp,
            "version_made_by": ver_made, "external_attrs": extattr,
            "local_offset": local_off + stub_delta,
        })
        p += 46 + namelen + extralen + commentlen
    return out


def first_lfh(data):
    for i in range(0, len(data) - 4):
        if struct.unpack_from("<I", data, i)[0] == SIG_LFH:
            return i
    return -1


def name_is_unsafe(name_bytes):
    try:
        name = name_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return True  # ill-formed / overlong UTF-8 is itself the defect
    if "\\" in name or name.startswith("/") or ":" in name:
        return True
    for seg in name.split("/"):
        if seg == "..":
            return True
        if seg and (seg.endswith(".") or seg.endswith(" ")) and seg not in (".", ".."):
            return True
        if seg.split(".")[0].lower() in WINDOWS_DEVICES:
            return True
    return False


# --- per-code defect-presence confirmations --------------------------------

def has_duplicate(cd):
    names = [e["name_bytes"] for e in cd]
    return len(names) != len(set(names))


def has_case_collision(cd):
    seen = {}
    for e in cd:
        n = e["name_bytes"].decode("utf-8", "replace")
        low = n.lower()
        if low in seen and seen[low] != n:
            return True
        seen.setdefault(low, n)
    return False


def has_lfh_cd_disagreement(data, cd):
    for e in cd:
        off = e["local_offset"]
        if off < 0 or off + 30 > len(data) or struct.unpack_from("<I", data, off)[0] != SIG_LFH:
            return True
        namelen = struct.unpack_from("<H", data, off + 26)[0]
        lfh_name = data[off + 30: off + 30 + namelen]
        if lfh_name != e["name_bytes"]:
            return True
    return False


def has_data_outside_cd(data, cd):
    eocd = find_eocd(data)
    if eocd is None:
        return False
    _cd_off, cd_size, _cd_count, eocd_pos = eocd
    cd_start = eocd_pos - cd_size
    cd_offsets = {e["local_offset"] for e in cd}
    # Brute-scan for every local-file-header signature before the central directory
    # — independent of any size-driven walk — and flag one the CD does not enumerate.
    i = 0
    while i + 4 <= cd_start:
        if struct.unpack_from("<I", data, i)[0] == SIG_LFH and i not in cd_offsets:
            return True
        i += 1
    return False


def has_symlink(cd):
    for e in cd:
        if (e["version_made_by"] >> 8) == 3 and ((e["external_attrs"] >> 16) & 0o170000) == S_IFLNK:
            return True
    return False


def has_bomb(cd):
    # Thresholds mirror zip-reader.ts DEFAULT_BOUNDS (500 MB per entry; 1000:1 ratio
    # above a 1 MiB floor) so the oracle confirms exactly what a conformant reader
    # flags — a bomb fixture must exceed any plausible conformant bound.
    for e in cd:
        if e["uncomp"] > 500 * 1024 * 1024:
            return True
        if e["comp"] > 0 and e["uncomp"] / e["comp"] > 1000 and e["uncomp"] > 1024 * 1024:
            return True
    return False


# Container Format section 3.2's COMPLETE permitted set. Anything else makes the container
# non-conformant; a reader must not guess a method from the data.
METHOD_STORE, METHOD_DEFLATE, METHOD_ZSTD = 0, 8, 93
PERMITTED_METHODS = {METHOD_STORE, METHOD_DEFLATE, METHOD_ZSTD}

# Zstandard is RECOMMENDED, not required (section 3.2), and Python only gained a stdlib
# decoder in 3.14 — so this is feature-detected exactly as the reader's is. Where it is
# absent, a method-93 entry is integrity-indeterminate here too, and this oracle says so
# rather than guessing.
try:
    from compression import zstd as _zstd  # Python 3.14+
    def _zstd_decompress(b):
        return _zstd.decompress(b)
except ImportError:
    _zstd_decompress = None


def entry_bytes(data, e):
    """(decoded_bytes, failure) for one entry. `failure` is None on success, else one of
    'method-forbidden' / 'method-unsupported' / 'corrupt' — the same three-way split the
    reader makes, because they carry OPPOSITE dispositions: a forbidden method rejects the
    container, an unimplemented but permitted one is not a defect at all."""
    off = e["local_offset"]
    # Method first, and BOTH method outcomes before anything structural — mirroring
    # zip-reader.ts, which settles the method without touching the archive. Ordering these
    # differently would make the two disagree for a method-93 entry with a bad offset, at the
    # very seam scripts/test-container-reader.ts exists to pin.
    if e["method"] not in PERMITTED_METHODS:
        return None, "method-forbidden"
    if e["method"] == METHOD_ZSTD and _zstd_decompress is None:
        return None, "method-unsupported"
    if off < 0 or off + 30 > len(data) or struct.unpack_from("<I", data, off)[0] != SIG_LFH:
        return None, "structural"  # a disagreement, confirmed elsewhere
    namelen = struct.unpack_from("<H", data, off + 26)[0]
    extralen = struct.unpack_from("<H", data, off + 28)[0]
    start = off + 30 + namelen + extralen
    stored = data[start: start + e["comp"]]
    if e["method"] == METHOD_STORE:
        return stored, None
    try:
        if e["method"] == METHOD_DEFLATE:
            # `decompress()` alone does NOT raise on a TRUNCATED stream — it returns whatever
            # it managed and leaves `eof` False. Node's inflateRawSync throws there, so
            # without the eof test the oracle would confirm a CRC mismatch over partial bytes
            # while the reader reports the entry undecodable: a silent divergence at exactly
            # the seam this three-way split exists to define.
            d = zlib.decompressobj(-15)
            raw = d.decompress(stored) + d.flush()
            if not d.eof:
                return None, "corrupt"
        else:
            raw = _zstd_decompress(stored)
    except Exception:  # noqa: BLE001
        return None, "corrupt"
    return raw, None


def entry_crc_ok(data, e):
    """True iff the entry's CRC-32 was CHECKED AND MATCHED, or could not be checked at all.

    SAY WHAT THIS BUYS AND WHAT IT DOES NOT. A failure to obtain the bytes returns True here
    because it is not a CRC MISMATCH — each failure kind has its own confirmer. But that means
    a zstd-less Python (anything before 3.14, including the ubuntu-24.04 python3 CI runs)
    DECLINES to verify a method-93 entry's checksum rather than verifying it: the clean-case
    check for positive-zstd-entry passes there without the CRC ever being computed. That is
    honest — the oracle cannot decode what it has no decoder for — but it is strictly less
    confirmation than the same run gives on Python 3.14+, and it is recorded rather than left
    to look like full coverage. The TypeScript reader verifies it wherever Node has zstd, and
    the suite scopes the fixture by the `compression:zstd` capability."""
    raw, failure = entry_bytes(data, e)
    if failure is not None:
        return True
    return (zlib.crc32(raw) & 0xFFFFFFFF) == e["crc"]


def has_crc_mismatch(data, cd):
    return any(not entry_crc_ok(data, e) for e in cd)


def has_forbidden_method(data, cd):
    return any(e["method"] not in PERMITTED_METHODS for e in cd)


def has_undecodable_entry(data, cd):
    """An entry using a permitted method this oracle CAN perform, whose bytes still will not
    decode. Distinct from a CRC mismatch: no checksum can be computed at all."""
    return any(entry_bytes(data, e)[1] == "corrupt" for e in cd)


def has_indeterminate_entry(data, cd):
    return any(entry_bytes(data, e)[1] == "method-unsupported" for e in cd)


def has_first_file_not_manifest(data):
    off = first_lfh(data)
    if off < 0 or off + 30 > len(data):
        return False
    namelen = struct.unpack_from("<H", data, off + 26)[0]
    name = data[off + 30: off + 30 + namelen].decode("utf-8", "replace")
    return name != "manifest.json"


def has_encryption(cd):
    return any((e["flags"] & 0x0001) != 0 for e in cd)


def has_multi_volume(data):
    eocd = find_eocd(data)
    if eocd is None:
        return False
    _cd_off, _cd_size, _cd_count, pos = eocd
    disk_this = struct.unpack_from("<H", data, pos + 4)[0]
    disk_cd = struct.unpack_from("<H", data, pos + 6)[0]
    return disk_this != 0 or disk_cd != 0


CONFIRMERS = {
    "CDX-E-ARCHIVE-DUPLICATE-ENTRY": lambda data, cd: has_duplicate(cd),
    "CDX-E-ARCHIVE-CASE-COLLISION": lambda data, cd: has_case_collision(cd),
    "CDX-E-ARCHIVE-LFH-CD-DISAGREEMENT": lambda data, cd: has_lfh_cd_disagreement(data, cd),
    "CDX-E-ARCHIVE-DATA-OUTSIDE-CD": lambda data, cd: has_data_outside_cd(data, cd),
    "CDX-E-ARCHIVE-UNSAFE-NAME": lambda data, cd: any(name_is_unsafe(e["name_bytes"]) for e in cd),
    "CDX-E-ARCHIVE-SYMLINK-ENTRY": lambda data, cd: has_symlink(cd),
    "CDX-E-ARCHIVE-DECOMPRESSION-BOMB": lambda data, cd: has_bomb(cd),
    "CDX-E-ARCHIVE-UNREADABLE": lambda data, cd: find_eocd(data) is None,
    "CDX-E-ARCHIVE-CRC-MISMATCH": lambda data, cd: has_crc_mismatch(data, cd),
    "CDX-E-ARCHIVE-FIRST-FILE-NOT-MANIFEST": lambda data, cd: has_first_file_not_manifest(data),
    "CDX-E-ARCHIVE-ENCRYPTION-USED": lambda data, cd: has_encryption(cd),
    "CDX-E-ARCHIVE-MULTI-VOLUME": lambda data, cd: has_multi_volume(data),
    "CDX-E-ARCHIVE-COMPRESSION-METHOD-FORBIDDEN": has_forbidden_method,
    "CDX-E-ARCHIVE-ENTRY-UNDECODABLE": has_undecodable_entry,
    "CDX-E-ARCHIVE-ENTRY-INTEGRITY-INDETERMINATE": has_indeterminate_entry,
}


# Returned by `confirm_clean` when the ORACLE — not the archive — is the limitation.
UNCONFIRMABLE = "__unconfirmable__"


def confirm_clean(data):
    """None if this archive is independently confirmable as clean, else why not.

    Extracted from `check` so the selftest can drive the REAL guard rather than its parts —
    an earlier selftest asserted the helpers directly and therefore survived deleting the
    guard from the clean-case path entirely.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.namelist()
    except Exception as exc:  # noqa: BLE001
        return f"expected a clean archive, zipfile could not read it: {exc}"
    cd = parse_cd(data)
    # A genuinely clean archive uses only permitted methods and decodes under them. Without
    # these a reader that silently skipped an entry it could not decode would still pass
    # every positive fixture, which is the hole these codes closed.
    if has_forbidden_method(data, cd):
        return "clean case uses a compression method outside section 3.2's permitted set"
    if has_undecodable_entry(data, cd):
        return "clean case has an entry that will not decode under its declared method"
    if has_crc_mismatch(data, cd):
        return "clean case has a CRC-32 mismatch"
    # REFUSE TO BLESS WHAT THIS ORACLE CANNOT READ. Every guard above returns "no defect"
    # when the bytes could not be obtained, so on a Python without compression.zstd a
    # method-93 clean case passed all of them without a single payload byte being examined —
    # zeroing its payload went undetected. Declining is a limitation; declaring it clean is a
    # false confirmation. Signalled as UNCONFIRMABLE rather than as a defect: it is a fact
    # about this Python, not about the archive.
    if has_indeterminate_entry(data, cd):
        return UNCONFIRMABLE
    return None


def check():
    if not os.path.isdir(FIXTURES):
        print(f"no fixtures directory at {FIXTURES}")
        return 1
    failures = 0
    n_malformed = 0
    n_clean = 0
    unconfirmable = []
    for name in sorted(os.listdir(FIXTURES)):
        cdir = os.path.join(FIXTURES, name)
        if not os.path.isdir(cdir):
            continue
        case = json.load(open(os.path.join(cdir, "case.json"), encoding="utf-8"))
        data = open(os.path.join(cdir, "case.cdx"), "rb").read()
        codes = [f["code"] for f in case.get("expect", {}).get("findings", [])]
        if not codes:
            # Clean case: confirm it is a real, readable ZIP via an independent parser.
            err = confirm_clean(data)
            if err == UNCONFIRMABLE:
                # Not a pass and not a failure. Counted and named, so a green run can never
                # be mistaken for full confirmation — the honest middle the suite already
                # uses when a capability is absent.
                unconfirmable.append(name)
                continue
            if err is not None:
                print(f"FAIL {name}: {err}")
                failures += 1
                continue
            n_clean += 1
            continue
        cd = parse_cd(data)
        for code in codes:
            confirm = CONFIRMERS.get(code)
            if confirm is None:
                # A malformed fixture whose defect this oracle cannot independently
                # confirm defeats the oracle's whole purpose — fail, do not skip.
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
    print(f"confirmed {n_malformed} injected defect(s) present; {n_clean} clean archive(s) readable.")
    if unconfirmable:
        print(f"  UNCONFIRMED by this Python ({len(unconfirmable)}): {', '.join(unconfirmable)}")
        print(f"  Zstandard decoding needs Python 3.14+ (compression.zstd); this is "
              f"{'.'.join(str(v) for v in sys.version_info[:3])}. These cases are NOT verified "
              f"here — CI pins 3.14 so they are verified there.")
    return 0


def selftest():
    """Assert the oracle REFUSES to bless a clean case whose bytes it cannot read.

    This guard only fires on a Python without `compression.zstd`, so on 3.14+ the normal
    `check` run never exercises it — and a regression that removed it would go unnoticed
    exactly where it matters (an older Python, which is what most CI images ship). So the
    decoder is forced off and the clean-case guards are re-run against the Zstandard fixture,
    which must then FAIL. Verified by mutation: without the guard this returns "clean".
    """
    global _zstd_decompress
    target = os.path.join(FIXTURES, "positive-zstd-entry", "case.cdx")
    if not os.path.exists(target):
        print("FAIL selftest: positive-zstd-entry fixture is missing")
        return 1
    data = open(target, "rb").read()
    cd = parse_cd(data)
    saved, _zstd_decompress = _zstd_decompress, None
    try:
        # Drive the REAL clean-case guard, not its parts.
        if confirm_clean(data) != UNCONFIRMABLE:
            print("FAIL selftest: with the zstd decoder forced off, the clean-case guard did "
                  "not mark the Zstandard fixture unconfirmable — it is vacuous and would "
                  "confirm bytes it never read")
            return 1
        if has_undecodable_entry(data, cd) or has_forbidden_method(data, cd) or has_crc_mismatch(data, cd):
            print("FAIL selftest: a permitted-but-unimplemented method must not be reported "
                  "as a defect (State Machine section 5.4.2 note 6)")
            return 1
    finally:
        _zstd_decompress = saved

    # The remaining clean-case guards cannot be exercised by any CLEAN fixture — a fixture
    # carrying those defects is by definition not clean — so drive them from the malformed
    # ones. Without this they are unmutatable: deleting either left every gate green.
    for fixture, why in (
        ("reject-compression-method-forbidden", "a forbidden compression method"),
        ("reject-entry-undecodable", "an entry that will not decode"),
        ("reject-entry-truncated-deflate", "a truncated compressed stream"),
    ):
        path = os.path.join(FIXTURES, fixture, "case.cdx")
        if not os.path.exists(path):
            print(f"FAIL selftest: fixture {fixture} is missing")
            return 1
        if confirm_clean(open(path, "rb").read()) is None:
            print(f"FAIL selftest: the clean-case guard blessed {fixture}, which carries {why}")
            return 1

    print("selftest: the clean-case guards refuse every archive this oracle cannot confirm")
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        sys.exit(selftest() or check())
    print("usage: archive_oracle.py check", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
