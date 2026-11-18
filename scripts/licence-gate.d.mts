// Types for scripts/licence-gate.mjs, so TypeScript tests can import it
// (tsconfig has allowJs off). This file declares the module's exports and
// nothing else; the behaviour lives in the .mjs and its tests.

export declare const ALLOWED_LICENCES: readonly string[];
export declare const NOTICE_LICENCES: Readonly<Record<string, string>>;
export declare const ALLOWED_EXCEPTIONS: readonly string[];
export declare const DENIED_PACKAGES: readonly string[];
export declare const SOURCE_EXTENSIONS: readonly string[];
export declare const STYLE_EXTENSIONS: readonly string[];
export declare const MDX_EXTENSIONS: readonly string[];
export declare const EXCLUDED_SOURCE_PREFIXES: readonly string[];
export declare const DEV_ONLY_PATHS: readonly { readonly path: string; readonly reason: string }[];
export declare const BUNDLER_PROVIDED_MODULES: readonly string[];
export declare const DEFAULT_EXEMPTIONS_FILE: string;
export declare const LOCKFILE_NAMES: readonly string[];
export declare const DEFAULT_ROOT: string;

export declare class GateError extends Error {}

export type SpdxNode =
    | { type: 'licence'; id: string; ref: boolean; orLater: boolean }
    | { type: 'with'; licence: SpdxNode; exception: string }
    | { type: 'and' | 'or'; items: SpdxNode[] };

export type ParseResult = { ok: true; ast: SpdxNode } | { ok: false; error: string };

export declare function parseSpdxExpression(text: unknown): ParseResult;
export declare function formatExpression(ast: SpdxNode): string;
export declare function expressionKey(ast: SpdxNode): string;

export interface Evaluation {
    allowed: boolean;
    relied: string[];
    problems: string[];
    unknownException: boolean;
}
export declare function evaluateExpression(ast: SpdxNode): Evaluation;

export type Legacy = null | 'license-object' | 'license-array' | 'licenses-array';
export type Declaration =
    | { kind: 'spdx'; ast: SpdxNode; expression: string; key: string; raw: unknown; legacy: Legacy }
    | { kind: 'see-licence-in'; file: string; raw: unknown; legacy: Legacy }
    | { kind: 'unlicensed'; raw: unknown; legacy: Legacy }
    | { kind: 'missing'; raw: unknown; legacy: Legacy }
    | { kind: 'invalid'; error: string; raw: unknown; legacy: Legacy };

export declare function normaliseDeclaration(manifest: unknown): Declaration;
export declare function declarationKey(declaration: Declaration): string;

export interface Exemption {
    name: string;
    licence: string;
    licenceKey: string;
    reason: string;
    adr: string;
    version: string | null;
}
export declare function validateExemptions(
    raw: unknown,
    root: string,
): { entries: Map<string, Exemption>; errors: { name: string | null; problem: string }[] };

export declare function isDeniedPackage(name: string): boolean;

export interface PackageToJudge {
    name: string;
    version: string | null;
    location: string;
    declaration: Declaration;
}
export interface Judgement {
    verdict: 'pass' | 'exempt' | 'fail';
    code?: string;
    reason?: string;
    relied: string[];
    notices: { code: string; message: string }[];
    exemption: Exemption | null;
    exemptionProblem: string | null;
}
export declare function judgePackage(pkg: PackageToJudge, exemptions?: Map<string, Exemption>): Judgement;

export interface Notice {
    code: string;
    message: string;
}
export interface ProductionPackage extends PackageToJudge {
    licenceSource: 'lockfile' | 'installed' | 'workspace' | 'none';
    chain: string[] | null;
    mismatch: string | null;
    workspace: boolean;
}
export interface TreeOptions {
    readInstalled?: (location: string) => unknown;
    readManifest?: ((location: string) => unknown) | null;
    diskWorkspaces?: string[] | null;
    extraRoots?: { location: string; from: string }[];
}
export declare function workspaceMatcher(manifest: unknown): (location: string) => boolean;
export declare function resolveFrom(packages: Record<string, unknown>, from: string, name: string): string | null;
export declare function listProductionPackages(
    lock: unknown,
    options?: TreeOptions,
): {
    lockfileVersion: number;
    packages: ProductionPackage[];
    skipped: { name: string; location: string; why: string }[];
    notices: Notice[];
    problems: { code: string; location: string; reason: string }[];
};

export interface PackageRecord {
    name: string | null;
    version: string | null;
    location: string;
    declared: string | null;
    licenceSource?: string;
    chain: string[] | null;
    verdict?: 'pass' | 'exempt' | 'fail';
    code: string | null;
    reason: string | null;
    relied?: string[];
}
export interface DependencyReport {
    lockfileVersion: number;
    checked: number;
    packages: PackageRecord[];
    skipped: { name: string; location: string; why: string }[];
    failures: PackageRecord[];
    exempted: (PackageRecord & { licence: string; adr: string; exemptionReason: string })[];
    notices: Notice[];
    exemptionProblems: { name: string | null; problem: string }[];
}
export declare function checkDependencies(
    lock: unknown,
    options?: TreeOptions & { root?: string; exemptions?: unknown },
): DependencyReport;

export interface Specifier {
    specifier: string | null;
    line: number;
    kind: string;
    computed: boolean;
    chunks: string[];
    typeOnly: boolean;
}
export interface SourceToken {
    type: 'ident' | 'punct' | 'string' | 'template' | 'regex' | 'number';
    line: number;
    value?: string;
    chunks?: string[];
    subs?: { start: number; end: number }[];
    broken?: boolean;
}
export interface LexProblem {
    line: number;
    message: string;
}
export declare function decodeEscapes(body: string): string;
export declare function tokenizeSource(text: string, options?: { jsx?: boolean }): { tokens: SourceToken[]; problems: LexProblem[] };
export declare function extractSpecifiers(text: string, options?: { jsx?: boolean }): { specifiers: Specifier[]; problems: LexProblem[] };
export declare function extractStyleSpecifiers(text: string): { specifiers: Specifier[]; problems: LexProblem[] };
export declare function extractMdxSpecifiers(text: string): { specifiers: Specifier[]; problems: LexProblem[] };
export declare function specifiersOf(text: string, file: string): { specifiers: Specifier[]; problems: LexProblem[] };
export declare function packageNameOf(specifier: string): string | null;
export declare function hasEePath(text: string): boolean;
export declare function classifySpecifier(entry: Specifier): { findings: { code: string; reason: string }[]; unchecked: boolean };

export interface SourceFailure {
    line: number;
    specifier: string | null;
    kind: string;
    code: string;
    reason: string;
}
export declare function scanSourceText(
    text: string,
    file?: string,
): {
    failures: SourceFailure[];
    notices: { line: number; code: string; message: string }[];
    specifiers: Specifier[];
};
export declare function isScannedSourcePath(relative: string): boolean;
export declare function devOnlyEntry(relative: string): { readonly path: string; readonly reason: string } | null;
export declare function listRepositoryFiles(root: string): string[];
export declare function listSourceFiles(root: string): string[];
export declare function parseJsonc(text: string): unknown;

export type AliasTarget = { path: string; bare?: undefined } | { bare: string; path?: undefined };
export interface AliasResolver {
    resolve(specifier: string, fromFile: string): AliasTarget[] | null;
}
export declare function buildAliasResolver(root: string, repositoryFiles: string[]): AliasResolver;

export interface PackageImport {
    file: string;
    line: number;
    specifier: string;
    name: string;
    shipped: boolean;
    style: boolean;
}
export interface SourceScan {
    scanned: number;
    files: string[];
    failures: (SourceFailure & { file: string })[];
    notices: { file: string; line: number; code: string; message: string }[];
    packageImports: PackageImport[];
}
export declare function scanSources(root: string, files: string[], options?: { resolver?: AliasResolver }): SourceScan;
export declare function resolveImportedPackages(
    lock: unknown,
    packageImports: PackageImport[],
): { roots: { location: string; from: string }[]; failures: (SourceFailure & { file: string })[] };

export interface GateReport {
    ok: boolean;
    problemCount: number;
    root: string;
    lockfile: string;
    exemptionsFile: string;
    dependencies: DependencyReport;
    sources: {
        scanned: number;
        files: string[];
        shippedFiles: number;
        failures: (SourceFailure & { file: string })[];
        notices: { file: string; line: number; code: string; message: string }[];
        importedPackages: string[];
    };
}
export declare function runGate(options?: { root?: string; exemptionsFile?: string | null }): GateReport;
export declare function formatReport(report: GateReport): string;
export declare function main(
    argv?: string[],
    io?: { stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } },
): number;
