/**
 * Reading Docker Compose files in tests (sub-phase 1.8).
 *
 * `loadCompose` parses a compose file with js-yaml and resolves YAML merge
 * keys (`<<: *anchor`), which Compose applies and js-yaml 5 leaves as a
 * literal `<<` key. `inlineSecrets` is the "no secret is written into a
 * compose file" rule shared by the production compose test and the guard over
 * every production compose file.
 */
import * as fs from 'node:fs';

import * as yaml from 'js-yaml';

export interface ComposeService {
    image?: string;
    container_name?: string;
    command?: string | string[];
    environment?: Record<string, string | number | boolean | null> | string[];
    env_file?: string | string[];
    labels?: Record<string, string> | string[];
    networks?: string[] | Record<string, unknown>;
    ports?: unknown[];
    volumes?: string[];
    depends_on?: Record<string, { condition?: string }> | string[];
    healthcheck?: { test?: string[] | string; disable?: boolean; start_period?: string };
    mem_limit?: string;
    cpus?: number | string;
    restart?: string;
    user?: string;
    init?: boolean;
    cap_drop?: string[];
    security_opt?: string[];
}

export interface ComposeFile {
    name?: string;
    services: Record<string, ComposeService>;
    networks?: Record<string, { external?: boolean; name?: string; internal?: boolean } | null>;
    volumes?: Record<string, unknown>;
}

/** Apply `<<` merge keys the way Compose does: the mapping's own keys win. */
function resolveMerges(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(resolveMerges);
    if (node === null || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const merge = record['<<'];
    const sources = merge === undefined ? [] : Array.isArray(merge) ? merge : [merge];
    for (const source of sources) Object.assign(out, resolveMerges(source) as Record<string, unknown>);
    for (const [key, value] of Object.entries(record)) {
        if (key !== '<<') out[key] = resolveMerges(value);
    }
    return out;
}

export function parseCompose(text: string): ComposeFile {
    return resolveMerges(yaml.load(text)) as ComposeFile;
}

export function loadCompose(file: string): ComposeFile {
    return parseCompose(fs.readFileSync(file, 'utf8'));
}

/** A service's environment as a map, whichever of the two forms it uses. */
export function environmentOf(service: ComposeService): Record<string, string> {
    const env = service.environment;
    if (!env) return {};
    if (Array.isArray(env)) {
        return Object.fromEntries(
            env.map((entry) => {
                const at = entry.indexOf('=');
                return at === -1 ? [entry, ''] : [entry.slice(0, at), entry.slice(at + 1)];
            }),
        );
    }
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === null ? '' : String(v)]));
}

export function networksOf(service: ComposeService): string[] {
    const nets = service.networks;
    if (!nets) return [];
    return Array.isArray(nets) ? nets : Object.keys(nets);
}

export function labelsOf(service: ComposeService): Record<string, string> {
    const labels = service.labels;
    if (!labels) return {};
    if (Array.isArray(labels)) {
        return Object.fromEntries(labels.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    }
    return labels;
}

/** Names whose value is a credential. */
const SECRET_NAME = /(PASSWORD|PASS|SECRET|TOKEN|DSN|AUTH|(^|_)KEY)$/;

/**
 * A reference that carries no literal: a required value (`${X:?message}`), or
 * an optional one with an EMPTY default (`${X:-}`, `${X}`). A non-empty default
 * (`${X:-hunter2}`) is a literal secret with extra steps.
 */
const BARE_REFERENCE = /^\$\{[A-Z][A-Z0-9_]*(?::\?[^}]*|:-)?\}$/;

/** The credential part of a URL value: `scheme://user:<this>@host`. */
const URL_CREDENTIAL = /^[a-z][a-z0-9+.-]*:\/\/[^:@/]*:([^@]*)@/i;

export interface InlineSecret {
    readonly service: string;
    readonly name: string;
}

/**
 * Every environment entry, and every `--requirepass` on a command line, that
 * writes a credential into the file instead of referencing one. Reports the
 * service and the variable name only.
 */
export function inlineSecrets(compose: ComposeFile): InlineSecret[] {
    const found: InlineSecret[] = [];
    for (const [service, def] of Object.entries(compose.services ?? {})) {
        for (const [name, value] of Object.entries(environmentOf(def))) {
            const credential = URL_CREDENTIAL.exec(value)?.[1];
            if (credential !== undefined) {
                if (!BARE_REFERENCE.test(credential)) found.push({ service, name });
                continue;
            }
            if (SECRET_NAME.test(name) && value !== '' && !BARE_REFERENCE.test(value)) found.push({ service, name });
        }
        const command = Array.isArray(def.command) ? def.command.join(' ') : (def.command ?? '');
        const pass = /--requirepass\s+("?)([^\s"]+)\1/.exec(command)?.[2];
        if (pass !== undefined && !/^\$\$?\{?[A-Z_]+/.test(pass)) found.push({ service, name: '--requirepass' });
    }
    return found;
}

/** Every `${NAME…}` the file interpolates, with whether it is required. */
export function interpolatedVariables(text: string): Map<string, { required: boolean }> {
    const vars = new Map<string, { required: boolean }>();
    // Comment lines describe the syntax; only YAML content interpolates.
    const content = text
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    // `$${…}` is a literal dollar for the container's shell, not interpolation.
    for (const match of content.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)(:\?|:-|\?|-)?/g)) {
        const name = match[1] as string;
        const required = match[2] === ':?' || match[2] === '?';
        const prior = vars.get(name);
        vars.set(name, { required: required || (prior?.required ?? false) });
    }
    return vars;
}
