'use client';

/**
 * The board layout (sub-phase 2.3): columns by workflow state (grouped by
 * category) for a project, or by category across teams; swimlanes by
 * assignee, priority, type, label or project; columns virtualised when they
 * are long; cards moved by pointer (pragmatic-drag-and-drop) or by keyboard,
 * with every keyboard move announced through a live region; and a per-card
 * "Move to…" menu, the non-drag path.
 *
 * Each column reads the shared list query with its own filter
 * (`useWorkItemList`, one SWR query per column over the
 * `[tenantId, projectId, stateId, sortKey]` index), so a move made here is in
 * the list and the detail at once, and theirs are here. A drop calls the
 * move API with the neighbour it landed beside; the client's fractional key
 * shows the card in place until the server's answer replaces it, and a
 * refused move (an archived state, another team's state, a stale version
 * that changed) rolls back with the server's reason.
 *
 * Written fresh for Islestone: inflect-compliance has no board.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { Combobox } from '@/components/ui/combobox';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { VirtualizedList } from '@/components/ui/virtualized-list';
import { useToast } from '@/components/ui/hooks';
import { PRIORITY_ORDER } from '@/lib/work-items/presentation';
import type { WorkItemRow } from '@/lib/work-items/types';

import { PriorityBadge } from '../badges';
import type { WorkItemListFilters } from '../data/list-filters';
import { memberLabel, useMembers, useWorkConfig } from '../data/use-work-config';
import { useWorkItemList, type WorkItemListResult } from '../data/use-work-item-list';
import { useWorkItemMutations } from '../data/use-work-item-mutations';
import {
    laneMovableInScope,
    isMovableFieldLane,
    laneFieldId,
    type BuiltInLaneBy,
    laneKeyOf,
    lanesOf,
    nextTarget,
    placementFor,
    targetStateId,
    withPreview,
    type BoardColumnDef,
    type GrabDirection,
    type GrabTarget,
    type LaneBy,
} from './board-model';
import { useBoardMonitor, useDraggableCard, useDropCell, type PointerDrop } from './use-board-dnd';

/** Past this many cards a column (with no lanes) renders through `VirtualizedList`. */
export const VIRTUALIZE_COLUMN_AT = 40;
const CARD_HEIGHT = 96;

type ColumnState = Pick<WorkItemListResult, 'items' | 'hasMore' | 'isLoading' | 'error'>;

/** One column's query; it renders nothing and reports its rows to the board. */
function ColumnQuery({
    column,
    scope,
    onData,
    registerLoader,
}: {
    column: BoardColumnDef;
    scope: WorkItemListFilters;
    onData: (id: string, state: ColumnState) => void;
    registerLoader: (id: string, loadMore: () => void) => void;
}) {
    const filters = useMemo(() => ({ ...scope, ...column.filter, order: 'manual' as const }), [scope, column.filter]);
    const result = useWorkItemList(filters, { limit: 50 });
    useEffect(() => {
        registerLoader(column.id, result.loadMore);
    });
    const { items, hasMore, isLoading, error } = result;
    useEffect(() => {
        onData(column.id, { items, hasMore, isLoading, error });
    }, [column.id, items, hasMore, isLoading, error, onData]);
    return null;
}

interface CardProps {
    row: WorkItemRow;
    column: number;
    lane: number;
    grabbed: boolean;
    dndEnabled: boolean;
    canDropFromLane: (lane: number) => boolean;
    columnNames: string[];
    canMove: boolean;
    register: (id: string, el: HTMLElement | null) => void;
    onOpen: (row: WorkItemRow) => void;
    onKey: (e: KeyboardEvent<HTMLElement>, row: WorkItemRow, column: number, lane: number) => void;
    onMoveTo: (row: WorkItemRow, column: number) => void;
    assigneeName: string | null;
}

function BoardCard(props: CardProps) {
    const { row, column, lane, grabbed, dndEnabled, canDropFromLane, columnNames, canMove, register, onOpen, onKey, onMoveTo, assigneeName } = props;
    const tCard = useTranslations('workItems');
    const ref = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    useDraggableCard(ref, { itemId: row.id, column, lane }, { enabled: dndEnabled, canDropFromLane, onDragging: setDragging });
    const moveOptions = columnNames.map((name, i) => ({ value: String(i), label: name })).filter((o) => o.value !== String(column));
    return (
        <div
            ref={ref}
            className={`rounded-md border bg-bg-default p-2 shadow-sm ${grabbed ? 'border-border-emphasis ring-2 ring-[var(--ring)]' : 'border-border-subtle'} ${dragging ? 'opacity-40' : ''}`}
            data-work-item-card={row.id}
        >
            <div className="flex items-start gap-2">
                <div
                    ref={(el) => register(row.id, el)}
                    role="button"
                    tabIndex={0}
                    aria-describedby="work-item-board-instructions"
                    aria-pressed={grabbed}
                    aria-label={tCard('board.cardLabel', { key: row.key, title: row.title })}
                    className="min-w-0 flex-1 cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onClick={() => onOpen(row)}
                    onKeyDown={(e) => onKey(e, row, column, lane)}
                >
                    <p className="font-mono text-xs text-content-muted">{row.key}</p>
                    <p className="line-clamp-2 text-sm text-content-emphasis">{row.title}</p>
                </div>
                {canMove && moveOptions.length > 0 && (
                    <Combobox
                        selected={null}
                        setSelected={(o) => o && onMoveTo(row, Number(o.value))}
                        options={moveOptions}
                        hideSearch
                        trigger={
                            <button
                                type="button"
                                aria-label={tCard('board.moveTo', { key: row.key })}
                                className="rounded-sm px-1 text-content-muted hover:text-content-emphasis focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                            >
                                ⋯
                            </button>
                        }
                    />
                )}
            </div>
            <div className="mt-1 flex items-center gap-2">
                <PriorityBadge priority={row.priority} />
                {row.dueDate && <span className="text-xs text-content-muted">{tCard('board.due', { date: row.dueDate })}</span>}
                {assigneeName && (
                    <span className="ml-auto" title={assigneeName}>
                        <InitialsAvatar value={assigneeName} size="sm" />
                    </span>
                )}
            </div>
        </div>
    );
}

function BoardCell({
    column,
    lane,
    rows,
    virtualize,
    canDropFromLane,
    label,
    children,
}: {
    column: number;
    lane: number;
    rows: WorkItemRow[];
    virtualize: boolean;
    canDropFromLane: (lane: number) => boolean;
    label: string;
    children: (row: WorkItemRow, index: number) => React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    useDropCell(ref, { column, lane }, canDropFromLane);
    if (virtualize) {
        return (
            <div ref={ref} className="min-h-0 flex-1" data-board-cell={`${column}:${lane}`}>
                <VirtualizedList
                    aria-label={label}
                    itemCount={rows.length}
                    itemSize={CARD_HEIGHT}
                    itemKey={(i) => rows[i]?.id ?? i}
                    renderItem={({ index, style }) => (
                        <div style={style} className="pb-2" role="listitem">
                            {rows[index] ? children(rows[index], index) : null}
                        </div>
                    )}
                />
            </div>
        );
    }
    return (
        <div ref={ref} className="min-h-12 flex-1 overflow-y-auto" data-board-cell={`${column}:${lane}`}>
            <ul className="space-y-2" aria-label={label}>
                {rows.map((row, i) => (
                    <li key={row.id}>{children(row, i)}</li>
                ))}
            </ul>
        </div>
    );
}

export interface WorkItemBoardProps {
    /** The view's filters (project, assignee, …), without state. */
    scope: WorkItemListFilters;
    columns: BoardColumnDef[];
    laneBy: LaneBy;
    onOpen: (row: WorkItemRow) => void;
    /** A column's "+": `stateId` is the column's state for a project board. */
    onCreate?: (stateId: string | undefined) => void;
    canEdit: boolean;
    canAssign: boolean;
}

export function WorkItemBoard({ scope, columns, laneBy, onOpen, onCreate, canEdit, canAssign }: WorkItemBoardProps) {
    const tBoard = useTranslations('workItems');
    const config = useWorkConfig();
    const { members, byId: memberById } = useMembers();
    const mutations = useWorkItemMutations();
    const toast = useToast();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const loaders = useRef<Record<string, () => void>>({});
    const cardEls = useRef(new Map<string, HTMLElement>());
    const [columnData, setColumnData] = useState<Record<string, ColumnState>>({});
    const [grab, setGrab] = useState<{ itemId: string; target: GrabTarget } | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const [focusId, setFocusId] = useState<string | null>(null);

    const registerLoader = useCallback((id: string, loadMore: () => void) => {
        loaders.current[id] = loadMore;
    }, []);
    const onData = useCallback((id: string, state: ColumnState) => {
        setColumnData((prev) => (prev[id] === state ? prev : { ...prev, [id]: state }));
    }, []);

    const columnName = useCallback((c: BoardColumnDef) => c.name ?? tBoard(`category.${c.category}`), [tBoard]);
    const columnNames = useMemo(() => columns.map(columnName), [columns, columnName]);

    const laneField = useMemo(() => {
        const id = laneFieldId(laneBy);
        return id ? (config.customFields ?? []).find((f) => f.id === id) ?? null : null;
    }, [laneBy, config]);
    const laneCtx = useMemo(
        () => ({ labelOrder: config.labels.map((l) => l.id), fields: new Map((config.customFields ?? []).map((f) => [f.id, f])) }),
        [config],
    );
    const allRows = useMemo(() => columns.flatMap((c) => columnData[c.id]?.items ?? []), [columns, columnData]);
    const laneOrder = useMemo(() => {
        if (laneField) {
            if (laneField.type === 'PERSON') return members.map((m) => m.id);
            if (laneField.type === 'CHECKBOX') return ['checked'];
            return laneField.options.map((o) => o.id);
        }
        switch (laneBy) {
            case 'assignee':
            case 'waitingOn':
                return members.map((m) => m.id);
            case 'priority':
                return [...PRIORITY_ORDER];
            case 'type':
                return config.types.map((x) => x.id);
            case 'label':
                return config.labels.map((x) => x.id);
            case 'project':
                return config.projects.map((x) => x.id);
            case 'cycle':
                // Oldest first, as a team plans them (the config lists newest first).
                return [...(config.cycles ?? [])].reverse().map((x) => x.id);
            case 'milestone':
                // Each project's order (the config lists them so).
                return (config.milestones ?? []).map((x) => x.id);
            default:
                return [];
        }
    }, [laneBy, members, config, laneField]);
    const lanes = useMemo(() => lanesOf(allRows, laneBy, laneCtx, laneOrder), [allRows, laneBy, laneCtx, laneOrder]);
    // One project on the board (a project's page, or a filter naming one): milestone lanes take drops.
    const singleProjectId = scope.projectId && !scope.projectId.includes(',') ? scope.projectId : undefined;
    const lanesMovable = laneField ? isMovableFieldLane(laneField.type) && canEdit : laneMovableInScope(laneBy, singleProjectId) && (laneBy !== 'assignee' || canAssign);

    const laneLabel = (key: string): string => {
        if (laneField) {
            if (!key) return tBoard('customFields.noValue');
            if (laneField.type === 'PERSON') return memberLabel(memberById.get(key)) ?? tBoard('detail.formerMember');
            if (laneField.type === 'CHECKBOX') return tBoard('customFields.checked');
            return laneField.options.find((o) => o.id === key)?.name ?? tBoard('board.noValue');
        }
        switch (laneBy as BuiltInLaneBy) {
            case 'none':
                return '';
            case 'assignee':
                return key ? memberLabel(memberById.get(key)) ?? tBoard('detail.formerMember') : tBoard('board.noAssignee');
            case 'waitingOn':
                return key ? memberLabel(memberById.get(key)) ?? tBoard('detail.formerMember') : tBoard('board.noWaitingOn');
            case 'priority':
                return tBoard(`priority.${key}`);
            case 'type':
                return config.typeById.get(key)?.name ?? tBoard('board.noValue');
            case 'label':
                return key ? config.labelById.get(key)?.name ?? tBoard('board.noValue') : tBoard('board.noLabel');
            case 'project':
                return config.projectById.get(key)?.name ?? tBoard('board.noValue');
            case 'cycle': {
                const cycle = (config.cycles ?? []).find((c) => c.id === key);
                if (!key) return tBoard('board.noCycle');
                return cycle ? cycle.name?.trim() || tBoard('cycle.numbered', { number: cycle.number }) : tBoard('board.noValue');
            }
            case 'milestone': {
                if (!key) return tBoard('board.noMilestone');
                const milestone = config.milestoneById.get(key);
                if (!milestone) return tBoard('board.noValue');
                // On a board of several projects a lane names its project too.
                return singleProjectId ? milestone.name : `${milestone.name} · ${config.projectById.get(milestone.projectId)?.keyPrefix ?? ''}`;
            }
        }
    };

    /** The rows of a cell as the server ordered them (the grabbed card excluded when asked). */
    const cellRows = useCallback(
        (column: number, lane: number, excludeId?: string) => {
            const col = columns[column];
            if (!col) return [];
            const laneKey = lanes[lane] ?? '';
            return (columnData[col.id]?.items ?? []).filter((r) => r.id !== excludeId && laneKeyOf(r, laneBy, laneCtx) === laneKey);
        },
        [columns, columnData, lanes, laneBy, laneCtx],
    );

    const rowById = useMemo(() => new Map(allRows.map((r) => [r.id, r])), [allRows]);

    const describe = (column: number, lane: number, index: number, size: number) => {
        const where = tBoard('board.position', { column: columnNames[column] ?? '', position: index + 1, total: size + 1 });
        return laneBy === 'none' ? where : `${where} ${tBoard('board.inLane', { lane: laneLabel(lanes[lane] ?? '') })}`;
    };

    const commitMove = (row: WorkItemRow, column: number, lane: number, index: number) => {
        const col = columns[column];
        if (!col) return;
        const stateId = targetStateId(col, row, config.defaultStateOf);
        if (!stateId) {
            toast.error(tBoard('board.noStateInTeam', { column: columnName(col) }));
            return;
        }
        const cell = cellRows(column, lane, row.id);
        const currentLane = lanes.indexOf(laneKeyOf(row, laneBy, laneCtx));
        const currentColumn = columns.findIndex((c) => (c.kind === 'state' ? c.id === row.stateId : c.category === row.stateCategory));
        const currentIndex = cellRows(currentColumn, currentLane).findIndex((r) => r.id === row.id);
        if (column === currentColumn && lane === currentLane && index === currentIndex) return;
        const placement = placementFor(cell, index, row);
        void mutations.moveOnBoard(row, { stateId, ...placement });
        const laneKey = lanes[lane] ?? '';
        if (lane !== currentLane && lanesMovable) {
            const moved = { ...row, stateId, ...(placement.sortKey ? { sortKey: placement.sortKey } : {}) };
            if (laneField) void mutations.setCustomField(moved, laneField.id, laneField.type === 'CHECKBOX' ? laneKey === 'checked' : laneKey || null);
            else if (laneBy === 'assignee') void mutations.assign(moved, laneKey || null);
            else if (laneBy === 'priority') void mutations.updateFields(moved, { priority: laneKey as WorkItemRow['priority'] });
            else if (laneBy === 'type' && laneKey) void mutations.updateFields(moved, { typeId: laneKey });
            else if (laneBy === 'cycle') void mutations.setCycle(moved, laneKey || null);
            else if (laneBy === 'milestone') void mutations.setMilestone(moved, laneKey || null);
            else if (laneBy === 'waitingOn') {
                // A closed column waits on nobody (2.4b): the move clears it, so no lane is set.
                const category = config.stateById.get(stateId)?.category;
                if (category !== 'DONE' && category !== 'CANCELLED') void mutations.setWaitingOn(moved, laneKey || null);
            }
        }
    };

    const onPointerDrop = useCallback(
        (drop: PointerDrop) => {
            const row = rowById.get(drop.itemId);
            if (!row) return;
            const cell = cellRows(drop.column, drop.lane, row.id);
            let index = cell.length;
            if (drop.beside) {
                const i = cell.findIndex((r) => r.id === drop.beside!.itemId);
                if (i !== -1) index = drop.beside.edge === 'top' ? i : i + 1;
            }
            commitMove(row, drop.column, drop.lane, index);
            setFocusId(row.id);
        },
        // commitMove reads the same state the deps name.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rowById, cellRows, columns, lanes, laneBy],
    );
    useBoardMonitor(scrollRef, onPointerDrop);

    // Keep keyboard focus on the moved card: it re-mounts in its new cell.
    useEffect(() => {
        const id = grab?.itemId ?? focusId;
        if (!id) return;
        const el = cardEls.current.get(id);
        if (el && document.activeElement !== el) el.focus();
    });

    const register = useCallback((id: string, el: HTMLElement | null) => {
        if (el) cardEls.current.set(id, el);
        else cardEls.current.delete(id);
    }, []);

    const onKey = (e: KeyboardEvent<HTMLElement>, row: WorkItemRow, column: number, lane: number) => {
        const isGrabbed = grab?.itemId === row.id;
        if (!isGrabbed) {
            if (e.key === ' ') {
                e.preventDefault();
                if (!canEdit) {
                    setAnnouncement(tBoard('board.cannotMove'));
                    return;
                }
                const index = cellRows(column, lane).findIndex((r) => r.id === row.id);
                setGrab({ itemId: row.id, target: { column, lane, index: Math.max(0, index) } });
                setAnnouncement(`${tBoard('board.pickedUp', { key: row.key })} ${describe(column, lane, Math.max(0, index), cellRows(column, lane, row.id).length)}`);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                onOpen(row);
            }
            return;
        }
        const directions: Record<string, GrabDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
        const direction = directions[e.key];
        if (direction) {
            e.preventDefault();
            const next = nextTarget(grab.target, direction, { columns: columns.length, lanes: lanes.length, lanesMovable }, (c, l) => cellRows(c, l, row.id).length);
            setGrab({ itemId: row.id, target: next });
            setAnnouncement(describe(next.column, next.lane, next.index, cellRows(next.column, next.lane, row.id).length));
            return;
        }
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            const { column: c, lane: l, index } = grab.target;
            setGrab(null);
            setFocusId(row.id);
            commitMove(row, c, l, index);
            setAnnouncement(tBoard('board.dropped', { key: row.key, column: columnNames[c] ?? '', position: index + 1 }));
            return;
        }
        if (e.key === 'Escape' || e.key === 'Tab') {
            if (e.key === 'Escape') e.preventDefault();
            setGrab(null);
            setFocusId(row.id);
            setAnnouncement(tBoard('board.cancelled', { key: row.key }));
        }
    };

    const onMoveTo = (row: WorkItemRow, column: number) => {
        const lane = Math.max(0, lanes.indexOf(laneKeyOf(row, laneBy, laneCtx)));
        commitMove(row, column, lane, cellRows(column, lane, row.id).length);
        setAnnouncement(tBoard('board.dropped', { key: row.key, column: columnNames[column] ?? '', position: cellRows(column, lane, row.id).length + 1 }));
    };

    // A card may cross lanes only where the lane's field is one a drop may
    // change (assignee, priority, type); one rule per lane, memoised so the
    // drop targets are not re-registered on every render.
    const laneDropRules = useMemo(() => lanes.map((_, lane) => (fromLane: number) => lanesMovable || fromLane === lane), [lanes, lanesMovable]);

    const grabbedRow = grab ? rowById.get(grab.itemId) : undefined;
    const rowsFor = (column: number, lane: number) => {
        const base = cellRows(column, lane, grabbedRow?.id);
        if (grab && grabbedRow && grab.target.column === column && grab.target.lane === lane) return withPreview(base, grabbedRow, grab.target.index);
        if (grab) return base;
        return cellRows(column, lane);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="work-item-board">
            {columns.map((c) => (
                <ColumnQuery key={c.id} column={c} scope={scope} onData={onData} registerLoader={registerLoader} />
            ))}
            <p id="work-item-board-instructions" className="sr-only">
                {canEdit ? tBoard('board.instructions') : tBoard('board.instructionsReadOnly')}
            </p>
            <div role="status" aria-live="polite" aria-label={tBoard('board.announcements')} className="sr-only">
                {announcement}
            </div>
            <div
                ref={scrollRef}
                // Inline, so the auto-scroller sees a scroll container even
                // where no stylesheet is loaded (it checks computed style).
                style={{ overflowX: 'auto', overflowY: 'auto' }}
                className="min-h-0 flex-1"
                role="region"
                aria-label={tBoard('board.label')}
            >
                {lanes.map((laneKey, lane) => (
                    <div key={laneKey || 'none'} className="mb-section">
                        {laneBy !== 'none' && <h2 className="mb-2 text-sm font-semibold text-content-emphasis">{laneLabel(laneKey)}</h2>}
                        <div className="flex gap-default">
                            {columns.map((col, column) => {
                                const state = columnData[col.id];
                                const rows = rowsFor(column, lane);
                                const name = columnName(col);
                                const firstOfCategory = column === 0 || columns[column - 1]?.category !== col.category;
                                return (
                                    <section
                                        key={col.id}
                                        aria-label={name}
                                        className="flex h-[min(70vh,48rem)] w-72 shrink-0 flex-col rounded-lg bg-bg-subtle p-2"
                                        data-board-column={col.id}
                                    >
                                        {lane === 0 && (
                                            <header className="mb-2">
                                                {col.kind === 'state' && firstOfCategory && (
                                                    <p className="text-[10px] uppercase tracking-wide text-content-muted">{tBoard(`category.${col.category}`)}</p>
                                                )}
                                                <div className="flex items-center justify-between gap-2">
                                                    <h2 className="text-sm font-semibold text-content-emphasis">
                                                        {name}{' '}
                                                        <span className="font-normal text-content-muted">
                                                            {state?.hasMore ? tBoard('board.countMore', { count: state.items.length }) : (state?.items.length ?? 0)}
                                                        </span>
                                                    </h2>
                                                    {onCreate && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            icon={<Plus />}
                                                            aria-label={tBoard('board.addIn', { column: name })}
                                                            onClick={() => onCreate(col.kind === 'state' ? col.id : undefined)}
                                                        />
                                                    )}
                                                </div>
                                            </header>
                                        )}
                                        {state?.error && <p role="alert">{tBoard('list.loadFailed')}</p>}
                                        <BoardCell
                                            column={column}
                                            lane={lane}
                                            rows={rows}
                                            label={laneBy === 'none' ? name : `${name}, ${laneLabel(laneKey)}`}
                                            virtualize={laneBy === 'none' && rows.length > VIRTUALIZE_COLUMN_AT && !grab}
                                            canDropFromLane={laneDropRules[lane]!}
                                        >
                                            {(row) => (
                                                <BoardCard
                                                    row={row}
                                                    column={column}
                                                    lane={lane}
                                                    grabbed={grab?.itemId === row.id}
                                                    dndEnabled={canEdit}
                                                    canDropFromLane={laneDropRules[lane]!}
                                                    columnNames={columnNames}
                                                    canMove={canEdit}
                                                    register={register}
                                                    onOpen={onOpen}
                                                    onKey={onKey}
                                                    onMoveTo={onMoveTo}
                                                    assigneeName={row.assigneeId ? memberLabel(memberById.get(row.assigneeId)) : null}
                                                />
                                            )}
                                        </BoardCell>
                                        {lane === lanes.length - 1 && state?.hasMore && (
                                            <Button variant="ghost" size="sm" text={tBoard('list.loadMore')} onClick={() => loaders.current[col.id]?.()} />
                                        )}
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
