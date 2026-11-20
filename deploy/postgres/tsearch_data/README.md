# The Bulgarian dictionary in Islestone's Postgres image

Sub-phase 2.7f; [ADR 0008](../../../docs/adr/0008-search-over-encrypted-fields.md) D2; [ADR 0007](../../../docs/adr/0007-third-party-licence-exceptions.md) E10; owner decisions 126, 145 and 146 (`docs/HANDOFF.md`).

`bulgarian.dict` and `bulgarian.affix` are the bgOffice Bulgarian spelling dictionary (OOo-spell-bg) in the form PostgreSQL's `ispell` text-search template reads. `deploy/postgres/Dockerfile` copies them into the image's `$SHAREDIR/tsearch_data`, where the `bulgarian_hunspell` dictionary of the `islestone_bg_en` text-search configuration (migration `20261207120000_search_configuration`) finds them.

## Source

- Project: bgOffice, <http://bgoffice.sourceforge.net/>.
- Release: `OOo-full-pack-bg-4.3.zip`, from <https://downloads.sourceforge.net/bgoffice/OOo-full-pack-bg-4.3.zip> (files dated 2010-06-17).
- Archive SHA512: `1c4acf0c8377c6ec3f0dd26c84a5232be88b1fecabcb08dfae4f45bf819c770427731cbf1b01d65d3a182cccc3d0bcaabf3ab85735221e2ff09fc47bd66341d7`, the value Gentoo's `app-dicts/myspell-bg/Manifest` records (gentoo/gentoo at `1d677101c0776fa2bf680550e2864f4f0a2e6ccd`).
- Files taken: `OOo-full-pack-bg-4.3/bg_BG.dic` (sha256 `c1d403ecf6588c3e23f9b57db2f905fda035e17c115d05736e1ce02ea17dacee`) and `OOo-full-pack-bg-4.3/bg_BG.aff` (sha256 `8c068e82c939f1bd138195de393c9dcc5e5401f8003fc1faf80f5e82da28ef3f`). Their licence statement is `OOo-full-pack-bg-4.3/Copyright_spell`, copied unchanged (apart from its line endings) as `Copyright_spell.txt` beside this file.

## Copyright and licence

Copyright (C) 2001-2010 Radostin Radnev <radnev@gmail.com>.

The release is distributed under the terms of either GNU General Public License Version 2 or later, or GNU Lesser General Public License Version 2.1 or later, or the Mozilla Public License Version 1.1 (`Copyright_spell.txt`). Islestone takes it under the Mozilla Public License Version 1.1 and, as that licence's section 6.2 permits ("You may also choose to use such Covered Code under the terms of any subsequent version of the License"), uses it under the **Mozilla Public License Version 2.0** (owner decision 145, ADR 0007 E10). `bulgarian.dict` and `bulgarian.affix` are therefore distributed under MPL-2.0; its text is `LICENSE-MPL-2.0.txt` beside this file.

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at <https://mozilla.org/MPL/2.0/>.

## What was changed (MPL-2.0 section 3.1)

The two files were re-encoded and nothing else. `../convert-bgoffice.sh` reproduces the conversion from the archive and checks every hash:

1. Both files from Windows-1251 to UTF-8 (`iconv -f CP1251 -t UTF-8`): PostgreSQL reads `ispell` dictionary files in UTF-8 only.
2. CRLF line endings to LF.
3. In the affix file, the encoding declaration `SET microsoft-cp1251` to `SET UTF-8`, so the declaration names the encoding the file is now in.
4. Renamed from `bg_BG.dic` / `bg_BG.aff` to `bulgarian.dict` / `bulgarian.affix`, the names PostgreSQL's `ispell` template looks for.

No word, flag or affix rule was added, removed or edited. The results:

| File | sha256 |
|---|---|
| `bulgarian.dict` | `44408b1ee50301e8f9a133b0ec92565bb8be49818c444d91821876d447f58906` |
| `bulgarian.affix` | `cb6bfc56d6b1e70c812061086d7ec5ad6aaf6d35acd927a035f1cee0188ea477` |

These are this directory's source form: the files themselves are both the source and what the image carries, and both are published, here and in `ghcr.io/rodnapamet/islestone-postgres`.

## Holding them in place

- `dictionary.json` (one directory up) records the source, the licence and these hashes; `tests/guards/postgres-dictionary-pinned.test.ts` fails when a file here differs from it, when a file is added or removed, or when the hashes and licence it records differ from ADR 0007 E10's. Changing the dictionary is an amendment to that ADR.
- `deploy/postgres/Dockerfile` checks the same hashes with `sha256sum -c` while it builds, so an image cannot carry other files under these names.
- `.gitattributes` keeps a checkout from rewriting their line endings.
