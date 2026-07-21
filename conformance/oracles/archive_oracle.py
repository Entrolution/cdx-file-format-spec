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


def entry_crc_ok(data, e):
    off = e["local_offset"]
    if off < 0 or off + 30 > len(data) or struct.unpack_from("<I", data, off)[0] != SIG_LFH:
        return True  # a structural issue (disagreement) is confirmed elsewhere
    namelen = struct.unpack_from("<H", data, off + 26)[0]
    extralen = struct.unpack_from("<H", data, off + 28)[0]
    start = off + 30 + namelen + extralen
    stored = data[start: start + e["comp"]]
    if e["method"] == 8:
        try:
            raw = zlib.decompressobj(-15).decompress(stored)
        except Exception:  # noqa: BLE001
            return False
    else:
        raw = stored
    return (zlib.crc32(raw) & 0xFFFFFFFF) == e["crc"]


def has_crc_mismatch(data, cd):
    return any(not entry_crc_ok(data, e) for e in cd)


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
}


def check():
    if not os.path.isdir(FIXTURES):
        print(f"no fixtures directory at {FIXTURES}")
        return 1
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
            # Clean case: confirm it is a real, readable ZIP via an independent parser.
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    z.namelist()
                n_clean += 1
            except Exception as exc:  # noqa: BLE001
                print(f"FAIL {name}: expected a clean archive, zipfile could not read it: {exc}")
                failures += 1
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
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        sys.exit(check())
    print("usage: archive_oracle.py check", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
