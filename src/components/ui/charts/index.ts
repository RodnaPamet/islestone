/**
 * Islestone-owned (ui-mirror.json lists it under "owned"): the chart façade
 * the mirrored files import as `@/components/ui/charts`.
 *
 * inflect-compliance's file at this path also declares chart modules that
 * Islestone does not take in sub-phase 1.2 (`chart-frame`, `line-chart`,
 * `radar-chart`, `gantt-chart`, `funnel-chart`, and two risk charts). This
 * one only re-exports the package's charts, which is everything the copied
 * files use (`TrendCard.tsx`: `Areas`, `COMPACT_CHART_MARGIN`,
 * `TimeSeriesChart`, `TimeSeriesDatum`). Add a re-export here when a later
 * sub-phase takes one of the others (docs/porting/maps/1.2.md, section 1).
 */
export * from '@inflect/ui/components/ui/charts';
