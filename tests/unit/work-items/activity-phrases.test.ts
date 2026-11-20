/**
 * Every `WORK_ITEM_` action the app layer writes has an Activity phrase, or
 * is named as one that never reaches an item's history, and every phrase key
 * resolves in the catalogue (the 2.3 map's risk 21: an unmapped action would
 * otherwise fall back to the generic sentence silently). The population is
 * the app layer's tracked files (`gitFiles`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ACTIVITY_PHRASE, NOT_ITEM_ACTIVITY, activityPhraseKey } from '@/components/work-items/detail/activity-phrases';

import en from '../../../messages/en.json';
import { gitFiles, REPO_ROOT } from '../../helpers/git-files';

function writtenActions(): Set<string> {
    const found = new Set<string>();
    for (const rel of gitFiles(REPO_ROOT)) {
        if (!rel.startsWith('src/app-layer/') || !rel.endsWith('.ts')) continue;
        const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const m of text.matchAll(/'(WORK_ITEM_[A-Z_]+)'/g)) found.add(m[1]!);
    }
    return found;
}

function resolves(dotted: string): boolean {
    let node: unknown = en;
    for (const part of dotted.split('.')) {
        if (!node || typeof node !== 'object' || !(part in node)) return false;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
}

describe('Activity phrases', () => {
    const actions = writtenActions();

    it('reads a real population', () => {
        expect(actions.size).toBeGreaterThan(10);
        expect(actions.has('WORK_ITEM_STATE_CHANGED')).toBe(true);
    });

    it('every WORK_ITEM_ action has a phrase or is named as not item activity', () => {
        const unmapped = [...actions].filter((a) => !(a in ACTIVITY_PHRASE) && !NOT_ITEM_ACTIVITY.has(a));
        expect(unmapped).toEqual([]);
    });

    it('every phrase key resolves in workItems.*', () => {
        const missing = [...Object.values(ACTIVITY_PHRASE), activityPhraseKey(undefined), 'activity.commented', 'activity.stateChangedFromTo'].filter(
            (k) => !resolves(`workItems.${k}`),
        );
        expect(missing).toEqual([]);
    });
});
