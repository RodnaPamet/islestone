'use client';

/**
 * The board's pointer drag and drop, on Atlassian's
 * `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0, ADR 0001 and the roadmap's
 * pick): each card is `draggable` and a drop target with a closest edge
 * (top or bottom), each cell (a column in a lane) is a drop target, and one
 * monitor resolves a drop to "column, lane, index" and hands it to the same
 * `onMove` the keyboard uses. Auto-scroll follows the pointer near a
 * scrolling edge.
 *
 * Virtualised columns unmount the cards that are off screen, and an
 * unmounted card is no drop target: the CELL is the fallback target, and a
 * drop on it lands at the end of the cell (the 2.3 map's risk 17).
 *
 * Written fresh for Islestone (sub-phase 2.3). Keyboard and screen-reader
 * moves are NOT pdnd's (it provides none): see `use-board-keyboard.ts`.
 */
import { useEffect, type RefObject } from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

export const CARD_DRAG_TYPE = 'islestone-work-item-card';

export interface CardDragData {
    type: typeof CARD_DRAG_TYPE;
    itemId: string;
    column: number;
    lane: number;
    [key: string | symbol]: unknown;
}

function isCardData(data: Record<string | symbol, unknown>): data is CardDragData {
    return data.type === CARD_DRAG_TYPE && typeof data.itemId === 'string';
}

/** Make a card draggable and a drop target with a top/bottom edge. */
export function useDraggableCard(
    ref: RefObject<HTMLElement | null>,
    data: { itemId: string; column: number; lane: number },
    options: { enabled: boolean; canDropFromLane: (lane: number) => boolean; onDragging: (dragging: boolean) => void },
) {
    const { itemId, column, lane } = data;
    const { enabled, canDropFromLane, onDragging } = options;
    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled) return undefined;
        return combine(
            draggable({
                element,
                getInitialData: () => ({ type: CARD_DRAG_TYPE, itemId, column, lane }),
                onDragStart: () => onDragging(true),
                onDrop: () => onDragging(false),
            }),
            dropTargetForElements({
                element,
                canDrop: ({ source }) => isCardData(source.data) && source.data.itemId !== itemId && canDropFromLane(source.data.lane),
                getData: ({ input, element: el }) =>
                    attachClosestEdge({ kind: 'card', itemId, column, lane }, { input, element: el, allowedEdges: ['top', 'bottom'] }),
            }),
        );
    }, [ref, itemId, column, lane, enabled, canDropFromLane, onDragging]);
}

/** Make a cell (a column within a lane) a drop target: a drop there lands at its end. */
export function useDropCell(ref: RefObject<HTMLElement | null>, cell: { column: number; lane: number }, canDropFromLane: (lane: number) => boolean) {
    const { column, lane } = cell;
    useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        return dropTargetForElements({
            element,
            canDrop: ({ source }) => isCardData(source.data) && canDropFromLane(source.data.lane),
            getData: () => ({ kind: 'cell', column, lane }),
        });
    }, [ref, column, lane, canDropFromLane]);
}

export interface PointerDrop {
    itemId: string;
    column: number;
    lane: number;
    /** The card the drop landed beside, and on which edge; absent for a cell drop. */
    beside?: { itemId: string; edge: 'top' | 'bottom' };
}

/** One monitor for the board: resolve a drop to its innermost target. */
export function useBoardMonitor(scrollRef: RefObject<HTMLElement | null>, onDrop: (drop: PointerDrop) => void) {
    useEffect(() => {
        const cleanups = [
            monitorForElements({
                canMonitor: ({ source }) => isCardData(source.data),
                onDrop: ({ source, location }) => {
                    const target = location.current.dropTargets[0];
                    if (!target || !isCardData(source.data)) return;
                    const data = target.data as Record<string | symbol, unknown>;
                    const column = Number(data.column);
                    const lane = Number(data.lane);
                    if (data.kind === 'card' && typeof data.itemId === 'string') {
                        const edge = extractClosestEdge(data);
                        onDrop({
                            itemId: source.data.itemId,
                            column,
                            lane,
                            beside: { itemId: data.itemId, edge: edge === 'top' ? 'top' : 'bottom' },
                        });
                    } else {
                        onDrop({ itemId: source.data.itemId, column, lane });
                    }
                },
            }),
        ];
        const element = scrollRef.current;
        if (element) cleanups.push(autoScrollForElements({ element, canScroll: ({ source }) => isCardData(source.data) }));
        return combine(...cleanups);
    }, [scrollRef, onDrop]);
}
