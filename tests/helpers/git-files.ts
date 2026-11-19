import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Absolute path of the repository these tests belong to. */
export const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Every file git considers part of the work tree at `root`, as repo-relative
 * POSIX paths, sorted: tracked files plus untracked files that `.gitignore`
 * does not exclude (`git ls-files --cached --others --exclude-standard`).
 *
 * Source-scanning tests take their population from here, never from a
 * directory walk with a hand-written skip list. A skip list is a denominator
 * nobody checks: it misses the next ignored tree (a worktree checkout, a
 * build cache) and the scan quietly reads files that are not part of the
 * repository. Git already knows the answer, including new files nobody has
 * `git add`-ed yet.
 *
 * A path still in the index but deleted from disk is dropped. If `root` is not
 * the top of a git work tree this throws: there is deliberately no fallback
 * walk.
 */
export function gitFiles(root: string): string[] {
    const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        // Only `root` itself may be the work tree: git must not climb to a
        // repository above it and list that one instead.
        env: { ...gitEnvFor(), GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(root)) },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const listed = new Set(stdout.split('\0').filter((p) => p.length > 0));
    return [...listed].filter((rel) => fs.existsSync(path.join(root, rel))).sort();
}

/**
 * The environment for a git command that must act on the repository its `cwd`
 * is in. A git hook exports GIT_DIR, GIT_INDEX_FILE and friends; inherited,
 * they would point a command run in a temp directory back at this repository.
 */
export function gitEnvFor(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return env;
}

/** `root`-relative POSIX form of an absolute path. */
export function relativeTo(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}
