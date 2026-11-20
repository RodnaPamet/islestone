'use client';

/**
 * Plain text with its mentions and work-item keys (sub-phase 2.7d; owner
 * decisions 127 and 131): a comment's body, a description, a pinned answer.
 *
 * A `<@userId>` token is a chip with the person's current name ONLY when the
 * source's `Mention` rows name that person (`mentions`, from the server);
 * any other token is shown as the text it is, so a token an outsider typed,
 * a template or a repeat copied, or somebody pasted names nobody. A key
 * (`ISL-123`) whose prefix is one of the workspace's projects links to the
 * item; nothing is stored for it, and the item page reads it through the
 * authorised API (an invisible key is the page's 404).
 *
 * Everything is React text: never markdown, never `innerHTML`.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { segmentText } from '@/app-layer/domain/mention';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { workItemPath } from '@/lib/work-item-paths';

import { memberLabel, useMembers, useWorkConfig } from '../data/use-work-config';

export interface MentionTextProps {
    text: string;
    /** The people the text's source mentions (its `Mention` rows). */
    mentions?: readonly string[];
    className?: string;
}

export function MentionText({ text, mentions, className }: MentionTextProps) {
    const tMention = useTranslations('workItems.mentions');
    const { byId } = useMembers();
    const config = useWorkConfig();
    const tenantHref = useTenantHref();
    const prefixes = useMemo(() => new Set(config.projects.map((p) => p.keyPrefix)), [config.projects]);
    const segments = useMemo(() => {
        const recorded = new Set(mentions ?? []);
        return segmentText(text, { isMentioned: (id) => recorded.has(id), isKnownPrefix: (p) => prefixes.has(p) });
    }, [text, mentions, prefixes]);

    return (
        <p className={className ?? 'whitespace-pre-wrap text-sm text-content-default'}>
            {segments.map((s, i) => {
                if (s.kind === 'text') return <span key={i}>{s.text}</span>;
                if (s.kind === 'key') {
                    return (
                        <Link key={i} href={tenantHref(workItemPath(s.key))} className="font-medium text-content-info underline-offset-2 hover:underline">
                            {s.key}
                        </Link>
                    );
                }
                const name = memberLabel(byId.get(s.userId)) ?? tMention('formerMember');
                return (
                    <span key={i} data-mention={s.userId} className="rounded-md bg-bg-subtle px-1 py-0.5 font-medium text-content-emphasis">
                        @{name}
                    </span>
                );
            })}
        </p>
    );
}
