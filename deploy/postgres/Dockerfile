# syntax=docker/dockerfile:1
#
# Islestone's Postgres image (sub-phase 2.7f; ADR 0008 D2; owner decisions
# 126, 145 and 146): the pinned pgvector image plus the Bulgarian Hunspell
# dictionary that the `islestone_bg_en` text-search configuration reads
# (migration 20261207120000_search_configuration), with the Debian packages
# that carried fixed HIGH vulnerabilities upgraded (owner decision 247) and
# `gosu` rebuilt from source on a current Go (owner decision 248). Nothing
# else changes: the same PostgreSQL 17, pgvector 0.8.7, entrypoint, data
# directory and user.
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
# dictionary, the Go image, gosu's release, this file): a published tag is
# never rebuilt, and production's compose file names it. tests/guards/postgres-image-pinning.test.ts holds the
# compose file's tag equal to this label.
# islestone-postgres tag: 17-0.8.7-bg4.3-r2

# gosu, built from source (owner decision 248). The base image's
# /usr/local/bin/gosu was built with Go 1.24.6, whose standard library
# carries fixed CRITICAL and HIGH vulnerabilities that Trivy reports against
# the binary. This stage builds the same program, tianon/gosu (Apache-2.0),
# at its release tag, refusing any checkout that is not the commit the tag
# named when it was pinned, with a current Go image pinned by index digest,
# CGO off and upstream's own build flags (its Dockerfile at that tag: `-v
# -trimpath -ldflags '-d -w' -buildvcs=true`). Its module dependencies are
# checked against the release's go.sum (`go mod download`, `go mod verify`). Bump the Go
# image (and the tag above) when Trivy reports its standard library, and
# gosu's tag and commit together. PROVENANCE.md and NOTICE record it.
FROM golang:1.27.4-trixie@sha256:430985542100b871e108ccc00e8dcc5eef08ca14ee5825e98ebf563d8ffec4ee AS gosu

ARG GOSU_VERSION=1.20
ARG GOSU_COMMIT=29b939aa5bd4dc588af765b8248f6e39150d2565
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src/gosu
RUN set -eu; \
    git clone --quiet --depth 1 --branch "$GOSU_VERSION" https://github.com/tianon/gosu.git .; \
    test "$(git rev-parse HEAD)" = "$GOSU_COMMIT"; \
    go mod download; \
    go mod verify; \
    go build -v -trimpath -ldflags '-d -w' -buildvcs=true -o /out/gosu github.com/tianon/gosu; \
    go version -m /out/gosu; \
    install -D -m 0644 LICENSE /out/doc/LICENSE; \
    install -m 0644 "$(go env GOROOT)/LICENSE" /out/doc/LICENSE.go; \
    install -m 0644 "$(go list -m -f '{{.Dir}}' golang.org/x/sys)/LICENSE" /out/doc/LICENSE.golang.org-x-sys; \
    install -m 0644 "$(go list -m -f '{{.Dir}}' github.com/moby/sys/user)/LICENSE" /out/doc/LICENSE.github.com-moby-sys-user

# The base by tag AND index digest: the tag says what it is, the digest makes
# it immutable (the multi-platform index of pgvector/pgvector:0.8.7-pg17-trixie).
FROM pgvector/pgvector:0.8.7-pg17-trixie@sha256:89947206f52eac3a9df9b663df7e76987cbdc623be6576b3a524953d568700d7

LABEL org.opencontainers.image.title="islestone-postgres" \
      org.opencontainers.image.version="17-0.8.7-bg4.3-r2" \
      org.opencontainers.image.description="PostgreSQL 17 with pgvector 0.8.7 and the bgOffice Bulgarian Hunspell dictionary (MPL-2.0) for Islestone's islestone_bg_en text-search configuration" \
      org.opencontainers.image.licenses="PostgreSQL AND MPL-2.0 AND Apache-2.0"

# Debian packages with fixed HIGH vulnerabilities in the base (owner decision
# 247; Trivy 0.70.0, 2026-11-26): krb5's four libraries, zlib and zstd.
# Only these are upgraded, from trixie and trixie-security, with no new
# package pulled in; then the build refuses an install older than the fixed
# version, so a stale mirror fails here rather than publishing the
# vulnerable package. Rebuilds are rare (a published tag is never rebuilt);
# when Trivy reports another package, add it here and bump the tag.
RUN set -eu; \
    apt-get update; \
    apt-get install --only-upgrade -y --no-install-recommends \
        libgssapi-krb5-2 libk5crypto3 libkrb5-3 libkrb5support0 \
        zlib1g libzstd1 zstd; \
    rm -rf /var/lib/apt/lists/*; \
    for pair in \
        libgssapi-krb5-2=1.21.3-5+deb13u2 libk5crypto3=1.21.3-5+deb13u2 \
        libkrb5-3=1.21.3-5+deb13u2 libkrb5support0=1.21.3-5+deb13u2 \
        zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 \
        libzstd1=1.5.7+dfsg-1+deb13u1 zstd=1.5.7+dfsg-1+deb13u1; \
    do \
        pkg="${pair%%=*}"; fixed="${pair#*=}"; \
        installed="$(dpkg-query -W -f '${Version}' "$pkg")"; \
        dpkg --compare-versions "$installed" ge "$fixed" || { echo "$pkg $installed is older than $fixed" >&2; exit 1; }; \
    done

# gosu from the stage above, in place of the base image's, at the same path
# and mode the entrypoint (`exec gosu postgres …`) uses. Its licence travels
# with it (Apache-2.0 section 4), and so do the licences of what the static
# binary links: the Go standard library and golang.org/x/sys (BSD-3-Clause)
# and github.com/moby/sys/user (Apache-2.0).
COPY --from=gosu /out/gosu /usr/local/bin/gosu
COPY --from=gosu /out/doc/ /usr/share/doc/islestone-postgres/gosu/
RUN set -eu; \
    chmod 0755 /usr/local/bin/gosu; \
    gosu --version; \
    gosu nobody true

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
