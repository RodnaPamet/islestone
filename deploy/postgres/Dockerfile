# syntax=docker/dockerfile:1
#
# Islestone's Postgres image (sub-phase 2.7f; ADR 0008 D2; owner decisions
# 126, 145 and 146): the pinned pgvector image plus the Bulgarian Hunspell
# dictionary that the `islestone_bg_en` text-search configuration reads
# (migration 20261207120000_search_configuration). Nothing else changes: the
# same PostgreSQL 17, pgvector 0.8.7, entrypoint, data directory and user.
#
#   ghcr.io/rodnapamet/islestone-postgres:<tag>   published by
#   .github/workflows/release.yml under the tag below, once per tag.
#
# Built where every database runs: production (deploy/docker-compose.prod.yml
# names the published tag), the local docker-compose.yml (`build:` this
# directory) and CI's Integration, E2E and DAST jobs (built in the job, so
# every pull request tests this file).
#
# Build context: this directory.
#   docker build -t islestone-postgres:dev deploy/postgres
#
# THE TAG. Bump it whenever anything here changes (the base digest, the
# dictionary, this file): a published tag is never rebuilt, and production's
# compose file names it. tests/guards/postgres-image-pinning.test.ts holds the
# compose file's tag equal to this label.
# islestone-postgres tag: 17-0.8.7-bg4.3-r1

# The base by tag AND index digest: the tag says what it is, the digest makes
# it immutable (the multi-platform index of pgvector/pgvector:0.8.7-pg17-trixie).
FROM pgvector/pgvector:0.8.7-pg17-trixie@sha256:89947206f52eac3a9df9b663df7e76987cbdc623be6576b3a524953d568700d7

LABEL org.opencontainers.image.title="islestone-postgres" \
      org.opencontainers.image.version="17-0.8.7-bg4.3-r1" \
      org.opencontainers.image.description="PostgreSQL 17 with pgvector 0.8.7 and the bgOffice Bulgarian Hunspell dictionary (MPL-2.0) for Islestone's islestone_bg_en text-search configuration" \
      org.opencontainers.image.licenses="PostgreSQL AND MPL-2.0"

# The dictionary, checked against the hashes ADR 0007 E10 records
# (deploy/postgres/dictionary.json) before it is installed: a build with any
# other file under these names fails here.
COPY tsearch_data/bulgarian.dict tsearch_data/bulgarian.affix /tmp/islestone-tsearch/
RUN set -eu; \
    cd /tmp/islestone-tsearch; \
    printf '%s  %s\n' \
        44408b1ee50301e8f9a133b0ec92565bb8be49818c444d91821876d447f58906 bulgarian.dict \
        cb6bfc56d6b1e70c812061086d7ec5ad6aaf6d35acd927a035f1cee0188ea477 bulgarian.affix \
        | sha256sum -c -; \
    dest="$(pg_config --sharedir)/tsearch_data"; \
    install -m 0644 -o root -g root bulgarian.dict bulgarian.affix "$dest/"; \
    rm -rf /tmp/islestone-tsearch

# Its licence, copyright statement and the statement of change travel with it
# (MPL-2.0 sections 3.1 and 3.2).
COPY tsearch_data/LICENSE-MPL-2.0.txt tsearch_data/Copyright_spell.txt tsearch_data/README.md /usr/share/doc/islestone-postgres/bgoffice-bulgarian/
