#!/usr/bin/env node
// Nothing in this file breaks the policy. Each line looks like a violation
// to a careless reader.
// import 'n8n'; require('posthog-node/ee/flags'): a comment is not an import.
/* export * from 'hyperformula';
   import('./ee/lazy'); */
import { useState } from 'react';
import fee from './fee/index'; // "fee" is not "ee"
import eel from '@acme/eel'; // nor is "eel"
import tree from './tree/ee-utils'; // "ee-utils" is not an "ee" segment
import eePackage from 'ee/sub'; // a package named "ee": no slash before it
import workflow from 'n8n-workflow'; // the deny list matches whole names
import planbyLike from '@acme/planby'; // a different scope
import data from './data.json?raw';

const from = '/ee/';
const docs = { from: 'n8n', import: 'hyperformula' };
const pattern = /['"]\/ee\/['"]/;
const ratio = 4 / 2;
const half = ratio / 2 / 1;
const message = `see ${'n8n'} and ${docs.from} for /ee/ folders`;
const notACall = docs.import;
const mock = { require: (name: string) => name };
const safe = mock.require('hyperformula');

export function Note() {
    const [count] = useState(0);
    return (
        <p title="import('hyperformula')">
            Don't import('hyperformula') here: {count} {ratio} {half}
        </p>
    );
}

export const used = [fee, eel, tree, eePackage, workflow, planbyLike, data, from, pattern, message, notACall, safe];
