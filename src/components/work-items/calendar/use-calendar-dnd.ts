'use client';

/**
 * The calendar's pointer drag and drop (roadmap 3.3a, decision 241), on
 * `@atlaskit/pragmatic-drag-and-drop` as the board's: each movable chip is
 * `draggable`, each day cell a drop target, and one monitor hands a drop to
 * `onDrop(itemId, ymd)`, which opens "Change dates" (never a write of its
 * own). Keyboard moves are not pdnd's: "Move to date…" in the chip's menu.
 *
 * Written fresh for Islestone.
 */
import { useEffect, type RefObject } from 'react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

export const CALENDAR_CHIP_DRAG_TYPE = 'islestone-calendar-chip';

interface ChipDragData {
    type: typeof CALENDAR_CHIP_DRAG_TYPE;
    itemId: string;
    fromYmd: string;
    [key: string | symbol]: unknown;
}

function isChipData(data: Record<string | symbol, unknown>): data is ChipDragData {
    return data.type === CALENDAR_CHIP_DRAG_TYPE && typeof data.itemId === 'string';
}

/** Make a chip draggable (only while `enabled`: a chip the person may not move never drags). */
export function useDraggableChip(ref: RefObject<HTMLElement | null>, itemId: string, fromYmd: string, enabled: boolean) {
    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled) return undefined;
        return draggable({ element, getInitialData: () => ({ type: CALENDAR_CHIP_DRAG_TYPE, itemId, fromYmd }) });
    }, [ref, itemId, fromYmd, enabled]);
}

/** Make a day cell a drop target; `onOver` tells it whether a chip is over it. */
export function useDropDay(ref: RefObject<HTMLElement | null>, ymd: string, onOver: (over: boolean) => void) {
    useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        return dropTargetForElements({
            element,
            canDrop: ({ source }) => isChipData(source.data) && source.data.fromYmd !== ymd,
            getData: () => ({ ymd }),
            onDragEnter: () => onOver(true),
            onDragLeave: () => onOver(false),
            onDrop: () => onOver(false),
        });
    }, [ref, ymd, onOver]);
}

/** One monitor for the grid: a chip dropped on another day. */
export function useCalendarDropMonitor(onDrop: (itemId: string, ymd: string) => void) {
    useEffect(
        () =>
            monitorForElements({
                canMonitor: ({ source }) => isChipData(source.data),
                onDrop: ({ source, location }) => {
                    const target = location.current.dropTargets[0];
                    if (!target || !isChipData(source.data)) return;
                    const ymd = target.data.ymd;
                    if (typeof ymd === 'string' && ymd !== source.data.fromYmd) onDrop(source.data.itemId, ymd);
                },
            }),
        [onDrop],
    );
}
