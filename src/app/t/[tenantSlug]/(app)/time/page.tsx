import { MyTimeView } from '@/components/time/MyTimeView';
import { myTimePageContext } from '@/lib/server/time-pages.server';

/**
 * My time (sub-phase 3.4b; docs/porting/maps/3.4.md, "The pages (3.4b)"):
 * the person's Monday-to-Sunday week as a grid of items and days, the timer
 * and "Add time". What it offers is `timeAffordances`, asked on the server;
 * a viewer who neither records time nor approves weeks gets a 404.
 */
export default async function MyTimePage({ params, searchParams }: { params: Promise<{ tenantSlug: string }>; searchParams: Promise<{ week?: string }> }) {
    const { tenantSlug } = await params;
    const { week } = await searchParams;
    const { affordances, today, weekStart } = await myTimePageContext(tenantSlug, week);
    return <MyTimeView affordances={affordances} today={today} weekStart={weekStart} />;
}
