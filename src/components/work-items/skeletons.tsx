/**
 * The work-item routes' loading states (`loading.tsx`), from the shared
 * skeletons. Copied in shape from inflect-compliance's
 * `tasks/loading.tsx` and `tasks/[taskId]/loading.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (six columns; five tabs).
 */
import { SkeletonDataTable, SkeletonDetailPage, SkeletonFilterToolbar, SkeletonPageHeader } from '@inflect/ui/components/ui/skeleton';

export function ListPageSkeleton() {
    return (
        <div className="space-y-section" aria-busy="true">
            <SkeletonPageHeader />
            <SkeletonFilterToolbar />
            <SkeletonDataTable rows={8} cols={6} />
        </div>
    );
}

export function DetailPageSkeleton() {
    return (
        <div aria-busy="true">
            <SkeletonDetailPage />
        </div>
    );
}
