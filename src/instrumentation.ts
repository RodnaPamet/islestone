/**
 * Next.js instrumentation hook: called once when a server process starts, on
 * each runtime.
 *
 * The startup refusals live in `src/instrumentation-node.ts` and run on the
 * Node.js runtime only. The branch reads `process.env.NEXT_RUNTIME` directly,
 * the one raw `process.env` read allowed outside the env modules (owner
 * decision, 2026-11-19; `tests/guards/no-raw-process-env.test.ts`): Next.js
 * inlines that literal per runtime, so the Edge bundle drops the import and
 * with it `process.exit` and `crypto`. Read through `@/env`, the branch
 * cannot be removed at build time and `next build` warns on both.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { registerNode } = await import('@/instrumentation-node');
        await registerNode();
    }
}
