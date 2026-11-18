// Runs before every test file in both Jest projects.
//
// Tests never validate the real environment: the env modules are mapped to
// tests/mocks/env.ts anyway (see jest.config.mjs), and this flag keeps any
// code that reads it directly on the same footing as a CI build.
process.env.SKIP_ENV_VALIDATION = '1';
