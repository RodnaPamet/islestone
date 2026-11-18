import type { NextConfig } from 'next';

// Validate both env modules whenever Next loads this config (dev, build and
// start), so a bad environment fails at boot rather than on first use.
// `SKIP_ENV_VALIDATION=1` switches this off for CI builds; see src/env-skip.ts.
import './src/env';
import './src/env-client';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
};

export default nextConfig;
