import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Validate both env modules whenever Next loads this config (dev, build and
// start), so a bad environment fails at boot rather than on first use.
// `SKIP_ENV_VALIDATION=1` switches this off for CI builds and for
// `npm run typecheck`; see src/env-skip.ts and scripts/next-typegen.mjs.
import { env } from './src/env';
import './src/env-client';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    // Next 16 writes an AGENTS.md at the repository root when `next dev` runs
    // inside an AI-agent session, and its text asks to be committed. Agents
    // read CLAUDE.md here; an untracked file the dev server creates would only
    // dirty the tree.
    agentRules: false,
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders({ production: env.NODE_ENV === 'production' }) }];
    },
};

// next-intl reads its request config from src/i18n/request.ts (the plugin's default path).
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
