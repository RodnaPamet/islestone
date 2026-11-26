/**
 * Islestone's Postgres image is the one database image everywhere (sub-phase
 * 2.7f; ADR 0008 D2; owner decisions 146 and 147).
 *
 *   - `deploy/postgres/Dockerfile` builds FROM the pgvector image by tag AND
 *     index digest, and names its own version once (the tag comment and the
 *     `org.opencontainers.image.version` label agree). Its one other stage
 *     builds `gosu` (owner decision 248) FROM a Go image, also by tag and
 *     index digest; nothing else comes from an unpinned image.
 *   - Production (`deploy/docker-compose.prod.yml`) runs
 *     `ghcr.io/rodnapamet/islestone-postgres` at exactly that version. Until
 *     the release has published the tag, the line may name the tag alone, and
 *     then the file must carry the `POSTGRES-IMAGE-DIGEST-PENDING` marker; once
 *     the digest is pinned (`<tag>@sha256:<64 hex>`), the marker must go.
 *     Bumping the Dockerfile's version without the compose file, or the
 *     reverse, fails here.
 *   - The local `docker-compose.yml` builds `deploy/postgres`.
 *   - CI's Integration and E2E jobs and the DAST workflow run no stock
 *     pgvector service: they build the image from the pull request
 *     (`scripts/ci-postgres.sh`).
 *   - The release workflow publishes it from that Dockerfile, under that
 *     version, before it moves the application images.
 *
 * A stock image anywhere would fail the configuration migration, which is the
 * point (fail closed); this guard catches it before a deploy does.
 */
import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../helpers/git-files';

const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const DOCKERFILE = read('deploy/postgres/Dockerfile');
const PROD = read('deploy/docker-compose.prod.yml');
const LOCAL = read('docker-compose.yml');
const CI = read('.github/workflows/ci.yml');
const DAST = read('.github/workflows/dast.yml');
const RELEASE = read('.github/workflows/release.yml');

const MARKER = 'POSTGRES-IMAGE-DIGEST-PENDING';

/** The version the Dockerfile names, checked to be named consistently. */
function dockerfileVersion(): string {
    const label = /org\.opencontainers\.image\.version="([^"]+)"/.exec(DOCKERFILE)?.[1];
    const comment = /^# islestone-postgres tag: (\S+)$/m.exec(DOCKERFILE)?.[1];
    expect(label).toBeDefined();
    expect(comment).toBe(label);
    return label!;
}

/** The image line of the production compose file's `postgres` service. */
function prodImage(): string {
    const service = PROD.slice(PROD.indexOf('\n  postgres:\n'));
    const image = /\n    image: (\S+)\n/.exec(service)?.[1];
    expect(image).toBeDefined();
    return image!;
}

/**
 * The production image line judged against the version: `null` when it is
 * right, otherwise why not. Pure, so it can be shown to refuse.
 */
function judgeProdImage(image: string, version: string, compose: string): string | null {
    const m = /^ghcr\.io\/rodnapamet\/islestone-postgres:([^@\s]+)(@sha256:[0-9a-f]{64})?$/.exec(image);
    if (!m) return `not Islestone's Postgres image by version (and digest): ${image}`;
    if (m[1] !== version) return `the tag ${m[1]} is not the Dockerfile's version ${version}`;
    const pinned = m[2] !== undefined;
    const marked = compose.includes(MARKER);
    if (!pinned && !marked) return `the tag is named without a digest and without the ${MARKER} marker`;
    if (pinned && marked) return `the digest is pinned; remove the ${MARKER} marker`;
    return null;
}

describe("Islestone's Postgres image", () => {
    it('the Dockerfile builds FROM pgvector by tag and index digest, its gosu stage FROM Go the same way', () => {
        const froms = DOCKERFILE.match(/^FROM .*$/gm) ?? [];
        expect(froms).toHaveLength(2);
        // The image itself is the last stage, on the pinned pgvector base.
        expect(froms[1]).toMatch(/^FROM pgvector\/pgvector:0\.8\.7-pg17-trixie@sha256:[0-9a-f]{64}$/);
        // The one build stage: gosu, compiled on a Go image by tag and digest.
        expect(froms[0]).toMatch(/^FROM golang:\d+\.\d+\.\d+-trixie@sha256:[0-9a-f]{64} AS gosu$/);
        expect(DOCKERFILE).toMatch(/^COPY --from=gosu \/out\/gosu \/usr\/local\/bin\/gosu$/m);
        // gosu's release is pinned by its tag and verified by its commit.
        expect(DOCKERFILE).toMatch(/^ARG GOSU_VERSION=\d+\.\d+$/m);
        expect(DOCKERFILE).toMatch(/^ARG GOSU_COMMIT=[0-9a-f]{40}$/m);
        expect(DOCKERFILE).toContain('test "$(git rev-parse HEAD)" = "$GOSU_COMMIT"');
    });

    it('production runs it at the Dockerfile\'s version, digest-pinned or marked pending', () => {
        expect(judgeProdImage(prodImage(), dockerfileVersion(), PROD)).toBeNull();
    });

    it('the local stack builds it', () => {
        const service = LOCAL.slice(LOCAL.indexOf('\n  postgres:\n'), LOCAL.indexOf('\n  pgbouncer:\n'));
        expect(service).toMatch(/\n    build: \.\/deploy\/postgres\n/);
        expect(service).not.toContain('pgvector/pgvector');
    });

    it('CI and DAST build it from the pull request and run no stock pgvector service', () => {
        for (const [name, workflow, db] of [
            ['ci.yml (Integration)', CI, 'islestone_test --pgbouncer'],
            ['ci.yml (E2E)', CI, 'islestone_e2e --pgbouncer'],
            ['dast.yml', DAST, 'islestone_dast'],
        ] as const) {
            expect({ name, stock: workflow.includes('pgvector/pgvector') }).toEqual({ name, stock: false });
            expect({ name, built: workflow.includes(`run: scripts/ci-postgres.sh ${db}\n`) }).toEqual({ name, built: true });
        }
        expect(read('scripts/ci-postgres.sh')).toMatch(/docker build --quiet -t "\$image" "\$root\/deploy\/postgres"/);
    });

    it('the release publishes it from that Dockerfile, under its version, before the application images move', () => {
        expect(RELEASE).toContain('POSTGRES_IMAGE: ghcr.io/rodnapamet/islestone-postgres');
        expect(RELEASE).toMatch(/context: deploy\/postgres\n\s+file: deploy\/postgres\/Dockerfile/);
        expect(RELEASE).toContain('org\\.opencontainers\\.image\\.version=');
        expect(RELEASE.indexOf('name: Push the Postgres image to GHCR')).toBeGreaterThan(0);
        expect(RELEASE.indexOf('name: Push the Postgres image to GHCR')).toBeLessThan(RELEASE.indexOf('name: Push the scanned images to GHCR'));
        // A published tag is never rebuilt or moved.
        expect(RELEASE).toMatch(/docker manifest inspect "\$\{POSTGRES_IMAGE\}:\$\{tag\}"/);
    });
});

describe('judgeProdImage refuses what it should', () => {
    const v = '17-0.8.7-bg4.3-r1';
    const digest = `@sha256:${'a'.repeat(64)}`;

    it('the stock image, another tag, and an unmarked tag', () => {
        expect(judgeProdImage('pgvector/pgvector:0.8.7-pg17-trixie', v, MARKER)).toMatch(/not Islestone's/);
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:17-0.8.7-bg4.3-r0${digest}`, v, '')).toMatch(/is not the Dockerfile's version/);
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:${v}`, v, '')).toMatch(/without a digest/);
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:latest`, v, MARKER)).toMatch(/is not the Dockerfile's version/);
    });

    it('a pinned digest with the marker left behind', () => {
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:${v}${digest}`, v, MARKER)).toMatch(/remove the/);
    });

    it('accepts the tag with the marker, and the tag with its digest', () => {
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:${v}`, v, MARKER)).toBeNull();
        expect(judgeProdImage(`ghcr.io/rodnapamet/islestone-postgres:${v}${digest}`, v, '')).toBeNull();
    });
});
