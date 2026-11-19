import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { skipEnvValidation } from './env-skip';

/**
 * CLIENT environment: the only env module a browser-reachable file may import.
 *
 * Every key is prefixed `NEXT_PUBLIC_`; Next.js inlines those values into the
 * client bundle at build time, so nothing secret belongs here. Server-only
 * variables live in `@/env`, which `tests/guards/client-env-boundary.test.ts`
 * keeps out of the client import graph.
 */
export const env = createEnv({
    client: {
        /** Public origin of the app, used to build absolute links. */
        NEXT_PUBLIC_APP_URL: z.url({ protocol: /^https?$/ }),
        /**
         * "1" in the Playwright build: client telemetry skips its retry
         * beacon (src/lib/observability/client-telemetry.ts).
         */
        NEXT_PUBLIC_TEST_MODE: z.enum(['0', '1']).optional(),
    },

    // Next.js only inlines `process.env.NEXT_PUBLIC_*` reads it can see
    // statically, so each one is spelled out.
    runtimeEnv: {
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_TEST_MODE: process.env.NEXT_PUBLIC_TEST_MODE,
    },

    skipValidation: skipEnvValidation(),
    emptyStringAsUndefined: true,
});
