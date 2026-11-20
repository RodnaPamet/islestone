#!/usr/bin/env bash
# Reproduce deploy/postgres/tsearch_data/bulgarian.{dict,affix} from the
# bgOffice release (sub-phase 2.7f; ADR 0007 E10; owner decision 145).
#
#   deploy/postgres/convert-bgoffice.sh [path/to/OOo-full-pack-bg-4.3.zip] [out-dir]
#
# Without an archive path it downloads the release from SourceForge. It checks
# the archive's SHA512 and the two source files' sha256 before converting, and
# the results' sha256 after, so a run either reproduces the committed files
# byte for byte or fails. The conversion is the whole of Islestone's change to
# the dictionary (MPL-2.0 section 3.1): CP1251 to UTF-8, CRLF to LF, and the
# affix file's `SET` line naming the new encoding.
#
# Run by hand when the dictionary is reviewed; never in CI or the image build
# (the image copies the committed files and checks their hashes).
set -euo pipefail

ARCHIVE_URL='https://downloads.sourceforge.net/bgoffice/OOo-full-pack-bg-4.3.zip'
ARCHIVE_SHA512='1c4acf0c8377c6ec3f0dd26c84a5232be88b1fecabcb08dfae4f45bf819c770427731cbf1b01d65d3a182cccc3d0bcaabf3ab85735221e2ff09fc47bd66341d7'
DIC_SHA256='c1d403ecf6588c3e23f9b57db2f905fda035e17c115d05736e1ce02ea17dacee'
AFF_SHA256='8c068e82c939f1bd138195de393c9dcc5e5401f8003fc1faf80f5e82da28ef3f'
DICT_OUT_SHA256='44408b1ee50301e8f9a133b0ec92565bb8be49818c444d91821876d447f58906'
AFFIX_OUT_SHA256='cb6bfc56d6b1e70c812061086d7ec5ad6aaf6d35acd927a035f1cee0188ea477'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="${1:-}"
out="${2:-$(cd "$(dirname "$0")" && pwd)/tsearch_data}"

if [ -z "$archive" ]; then
    archive="$work/OOo-full-pack-bg-4.3.zip"
    curl -fsSL -o "$archive" "$ARCHIVE_URL"
fi

check() { # check <sha-tool> <expected> <file>
    local got
    got="$("$1" "$3" | cut -d' ' -f1)"
    if [ "$got" != "$2" ]; then echo "convert-bgoffice: $3: expected $2, got $got" >&2; exit 1; fi
}

check sha512sum "$ARCHIVE_SHA512" "$archive"
unzip -q "$archive" -d "$work/x"
src="$work/x/OOo-full-pack-bg-4.3"
check sha256sum "$DIC_SHA256" "$src/bg_BG.dic"
check sha256sum "$AFF_SHA256" "$src/bg_BG.aff"

mkdir -p "$out"
iconv -f CP1251 -t UTF-8 "$src/bg_BG.dic" | sed 's/\r$//' > "$out/bulgarian.dict"
iconv -f CP1251 -t UTF-8 "$src/bg_BG.aff" | sed 's/\r$//; s/^SET microsoft-cp1251$/SET UTF-8/' > "$out/bulgarian.affix"

check sha256sum "$DICT_OUT_SHA256" "$out/bulgarian.dict"
check sha256sum "$AFFIX_OUT_SHA256" "$out/bulgarian.affix"
echo "convert-bgoffice: reproduced bulgarian.dict and bulgarian.affix in $out"
