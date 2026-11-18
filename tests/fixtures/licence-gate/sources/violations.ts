// Every import in this file breaks the third-party intake policy on purpose.
// tests/unit/licence-gate.test.ts finds each line by its specifier.

import { flags } from 'posthog-node/ee/flags';
export { audit } from '@acme/sdk/ee';
import '../vendor/ee/side-effect';
import type { Workflow } from 'n8n';
import HyperFormula from 'hyperformula/es';
export * from '@blocknote/xl-ai';
import Handsontable = require('handsontable');

const lazy = () => import('./ee/lazy-module');
const legacy = require('..\\lib\\ee');
const where = require.resolve('planby');
const live = import(`@liveblocks/server`);
const client = import(`windmill-components/${'client'}`);
const block = import(`@blocknote/xl-${'docx'}-exporter`);
const meta = import.meta.resolve('@acme/sdk/ee/meta');

export const used = [flags, HyperFormula, Handsontable, lazy, legacy, where, live, client, block, meta] as unknown as Workflow;
