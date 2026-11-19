// Runs before every test file in both Jest projects.
//
// Tests never validate the real environment: the env modules are mapped to
// tests/mocks/env.ts anyway (see jest.config.mjs), and this flag keeps any
// code that reads it directly on the same footing as a CI build.
process.env.SKIP_ENV_VALIDATION = '1';

// Sub-phase 1.4: the auth layer reads these at load. Test fixtures, never a
// real value (inflect-compliance's jest.setup.js sets the same names). The
// OAuth pairs are set so src/auth.ts registers Google and Microsoft, which it
// offers only when both of a pair are configured.
process.env.AUTH_SECRET = 'supersecretstringthatis16charplus'; // test fixture, not a secret
process.env.GOOGLE_CLIENT_ID = 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'; // test fixture, not a secret
process.env.MICROSOFT_CLIENT_ID = 'test-ms-id';
process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret'; // test fixture, not a secret
