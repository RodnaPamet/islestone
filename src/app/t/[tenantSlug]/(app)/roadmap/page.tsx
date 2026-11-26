import { RoadmapPageView } from '@/components/goals/RoadmapPageView';
import { roadmapPageContext } from '@/lib/server/goal-pages.server';

/**
 * The Roadmap page (sub-phase 3.2c; decisions 216, 217 and 222): initiatives
 * and their projects on the timeline widget, read-only, each bar opening the
 * item timeline. The Roadmap entry's landing page. A viewer without
 * `goals.view` or `projects.view` gets a 404.
 */
export default async function RoadmapPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { options } = await roadmapPageContext(tenantSlug);
    return <RoadmapPageView options={options} />;
}
