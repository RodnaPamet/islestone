'use client';

/**
 * Settings → Working calendars (roadmap 3.1a; ADR 0010 §5; owner decisions
 * 189 to 193): the workspace's working calendar (time zone, working weekdays,
 * holidays) and, on a team's page, the team's own calendar, which replaces
 * the workspace's for the team's items.
 *
 * A workspace that never saved one shows the default (Monday to Friday, no
 * holidays, the deployment's zone) as editable; the first change saves it.
 * Holidays are entered by hand, with "Copy last year's" and, for a team,
 * "Copy the workspace's holidays" (decision 190): the browser computes the
 * dates (`copyHolidaysToYear`) and posts them to the add route, which skips
 * a date already there. Removing a holiday, and a team going back to the
 * workspace's calendar, go through the undo toast (`use-undo-delete.ts`).
 *
 * Every write is offered only with `manageWorkConfig`, the predicate the
 * usecases assert (asked on the server); refusals are shown as the server
 * words them. Changing a calendar changes no stored date: review steps keep
 * their due days (ADR 0009 §13).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { copyHolidaysToYear } from '@/app-layer/domain/schedule/calendar';
import {
    WEEKDAY_ORDER,
    WORKING_CALENDAR_LIMITS,
    type HolidaysAdded,
    type IsoWeekday,
    type TeamWorkingCalendarData,
    type WorkingCalendarData,
    type WorkingCalendarsOverview,
} from '@/lib/scheduling/working-calendar';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, useSettingsApi, useTeamWorkingCalendar, useWorkingCalendars } from './settings-data';
import { useUndoDelete } from './use-undo-delete';

/** The IANA zones the browser knows, with the calendar's own first if the list lacks it. */
function timeZoneOptions(current: string): ComboboxOption[] {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
    const all = [...new Set([current, 'UTC', ...zones])].filter(Boolean);
    return all.map((z) => ({ value: z, label: z }));
}

/** The calendar's time zone, weekdays and name: one form, saved with one PUT. */
function CalendarForm({ calendar, idPrefix, canManage, onSave }: {
    calendar: Pick<WorkingCalendarData, 'name' | 'timeZone' | 'workingWeekdays'>;
    idPrefix: string;
    canManage: boolean;
    onSave: (input: { name: string; timeZone: string; workingWeekdays: IsoWeekday[] }) => Promise<string | null>;
}) {
    const tForm = useTranslations('settings.workingCalendars');
    const [name, setName] = useState(calendar.name);
    const [timeZone, setTimeZone] = useState(calendar.timeZone);
    const [weekdays, setWeekdays] = useState<IsoWeekday[]>(calendar.workingWeekdays);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const zones = useMemo(() => timeZoneOptions(calendar.timeZone), [calendar.timeZone]);

    // A new calendar from the server (another tab, a first save) resets the form.
    const [seen, setSeen] = useState(calendar);
    if (seen !== calendar) {
        setSeen(calendar);
        setName(calendar.name);
        setTimeZone(calendar.timeZone);
        setWeekdays(calendar.workingWeekdays);
    }

    const submit = async () => {
        if (!name.trim()) return setError(tForm('nameRequired'));
        if (weekdays.length === 0) return setError(tForm('weekdaysRequired'));
        setBusy(true);
        const failure = await onSave({ name: name.trim(), timeZone, workingWeekdays: [...weekdays].sort((a, b) => a - b) });
        setBusy(false);
        setError(failure);
    };

    return (
        <form
            className="space-y-default"
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            <FormField label={tForm('name')}>
                <Input id={`${idPrefix}-name`} value={name} maxLength={WORKING_CALENDAR_LIMITS.nameMax} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label={tForm('timeZone')} hint={tForm('timeZoneHint')}>
                <Combobox
                    id={`${idPrefix}-time-zone`}
                    selected={zones.find((z) => z.value === timeZone) ?? null}
                    setSelected={(o) => o && setTimeZone(o.value)}
                    options={zones}
                    caret
                    buttonProps={{ disabled: !canManage }}
                />
            </FormField>
            <fieldset className="space-y-tight">
                <legend className="text-sm font-medium">{tForm('workingWeekdays')}</legend>
                <div className="flex flex-wrap gap-default">
                    {WEEKDAY_ORDER.map((d) => (
                        <label key={d} className="flex items-center gap-tight text-sm">
                            <Checkbox
                                id={`${idPrefix}-weekday-${d}`}
                                checked={weekdays.includes(d)}
                                disabled={!canManage}
                                onCheckedChange={(c) => setWeekdays((w) => (c === true ? [...new Set([...w, d])] : w.filter((x) => x !== d)))}
                            />
                            {tForm(`weekday.${d}`)}
                        </label>
                    ))}
                </div>
            </fieldset>
            {error && (
                <p role="alert" className="text-sm text-content-error">
                    {error}
                </p>
            )}
            {canManage && <Button id={`${idPrefix}-save`} type="submit" variant="primary" text={tForm('save')} loading={busy} />}
        </form>
    );
}

/** A calendar's holidays: the list, removal through the undo toast, and the add form. */
function HolidaysPanel({ calendar, idPrefix, cachePath, basePath, canManage, extraCopy }: {
    calendar: WorkingCalendarData;
    idPrefix: string;
    /** The cache entry the calendar is shown in. */
    cachePath: string;
    /** The calendar's route (`/working-calendar` or a team's). */
    basePath: string;
    canManage: boolean;
    /** "Copy the workspace's holidays" on a team's calendar. */
    extraCopy?: { label: string; holidays: ReadonlyArray<{ day: string; name: string }> };
}) {
    const tHolidays = useTranslations('settings.workingCalendars');
    const toast = useToast();
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const [day, setDay] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const years = [...new Set(calendar.holidays.map((h) => Number(h.day.slice(0, 4))))].sort((a, b) => a - b);
    const lastYear = years[years.length - 1];

    const add = async (holidays: Array<{ day: string; name: string }>, okMessage?: (r: HolidaysAdded) => string) => {
        setBusy(true);
        try {
            const result = await send<HolidaysAdded>('POST', `${basePath}/holidays`, { holidays });
            await revalidate(cachePath, SETTINGS_PATHS.workingCalendars);
            if (okMessage) toast.success(okMessage(result));
            setError(null);
            return true;
        } catch (err) {
            setError(refusalText(err, tHolidays('failed')));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const copy = (source: ReadonlyArray<{ day: string; name: string }>, fromYear: number, toYear: number) => {
        const have = new Set(calendar.holidays.map((h) => h.day));
        const next = copyHolidaysToYear(source, fromYear, toYear, have).slice(0, WORKING_CALENDAR_LIMITS.holidaysPerRequest);
        if (next.length === 0) {
            toast.info(tHolidays('nothingToCopy'));
            return;
        }
        void add(next, (r) => tHolidays('copied', { count: r.added.length }));
    };

    return (
        <div className="space-y-default">
            {calendar.holidays.length === 0 ? (
                <p className="text-sm text-content-muted">{tHolidays('noHolidays')}</p>
            ) : (
                <table className="w-full text-sm" aria-label={tHolidays('holidaysTable')}>
                    <thead>
                        <tr className="text-left text-content-muted">
                            <th scope="col" className="py-tight font-medium">
                                {tHolidays('holidayDay')}
                            </th>
                            <th scope="col" className="py-tight font-medium">
                                {tHolidays('holidayName')}
                            </th>
                            {canManage && (
                                <th scope="col" className="py-tight font-medium">
                                    <span className="sr-only">{tHolidays('actions')}</span>
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {calendar.holidays.map((h) => (
                            <tr key={h.id} className="border-t border-border-subtle">
                                <td className="py-tight tabular-nums">{h.day}</td>
                                <td className="py-tight">{h.name}</td>
                                {canManage && (
                                    <td className="py-tight text-right">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            text={tHolidays('removeHoliday')}
                                            aria-label={tHolidays('removeHolidayNamed', { name: h.name, day: h.day })}
                                            onClick={() =>
                                                undoDelete<WorkingCalendarData | WorkingCalendarsOverview | TeamWorkingCalendarData>({
                                                    path: cachePath,
                                                    without: (current) => withoutHoliday(current, h.id),
                                                    deletePath: `${basePath}/holidays/${encodeURIComponent(h.id)}`,
                                                    message: tHolidays('holidayRemoved', { name: h.name, day: h.day }),
                                                })
                                            }
                                        />
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {canManage && (
                <>
                    <form
                        className="flex flex-wrap items-end gap-default"
                        aria-label={tHolidays('addHoliday')}
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!day) return setError(tHolidays('dayRequired'));
                            if (!name.trim()) return setError(tHolidays('holidayNameRequired'));
                            void add([{ day, name: name.trim() }]).then((ok) => {
                                if (ok) {
                                    setDay(null);
                                    setName('');
                                }
                            });
                        }}
                    >
                        <FormField label={tHolidays('holidayDay')}>
                            <DatePicker id={`${idPrefix}-holiday-day`} value={parseYMD(day)} onChange={(d) => setDay(toYMD(d))} clearable />
                        </FormField>
                        <FormField label={tHolidays('holidayName')}>
                            <Input id={`${idPrefix}-holiday-name`} value={name} maxLength={WORKING_CALENDAR_LIMITS.holidayNameMax} onChange={(e) => setName(e.target.value)} />
                        </FormField>
                        <Button id={`${idPrefix}-holiday-add`} type="submit" variant="secondary" text={tHolidays('addHoliday')} loading={busy} />
                    </form>
                    <div className="flex flex-wrap gap-tight">
                        {lastYear !== undefined && (
                            <Button
                                id={`${idPrefix}-copy-year`}
                                variant="secondary"
                                size="sm"
                                text={tHolidays('copyYear', { from: lastYear, to: lastYear + 1 })}
                                disabled={busy}
                                onClick={() => copy(calendar.holidays, lastYear, lastYear + 1)}
                            />
                        )}
                        {extraCopy && extraCopy.holidays.length > 0 && (
                            <Button
                                id={`${idPrefix}-copy-workspace`}
                                variant="secondary"
                                size="sm"
                                text={extraCopy.label}
                                disabled={busy}
                                onClick={() => {
                                    const have = new Set(calendar.holidays.map((h) => h.day));
                                    const next = extraCopy.holidays
                                        .filter((h) => !have.has(h.day))
                                        .slice(0, WORKING_CALENDAR_LIMITS.holidaysPerRequest)
                                        .map((h) => ({ day: h.day, name: h.name }));
                                    if (next.length === 0) toast.info(tHolidays('nothingToCopy'));
                                    else void add(next, (r) => tHolidays('copied', { count: r.added.length }));
                                }}
                            />
                        )}
                    </div>
                    {error && (
                        <p role="alert" className="text-sm text-content-error">
                            {error}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** A cache entry without one holiday: a calendar, the overview, or a team's view. */
function withoutHoliday<T extends WorkingCalendarData | WorkingCalendarsOverview | TeamWorkingCalendarData>(current: T | undefined, id: string): T | undefined {
    if (!current) return current;
    const strip = (c: WorkingCalendarData): WorkingCalendarData => ({ ...c, holidays: c.holidays.filter((h) => h.id !== id) });
    if ('workspace' in current) return { ...current, workspace: strip(current.workspace) };
    if ('teamName' in current) return { ...current, calendar: current.calendar ? strip(current.calendar) : null };
    return strip(current as WorkingCalendarData) as T;
}

/** Settings → Working calendars: the workspace's calendar and the teams. */
export function WorkingCalendarsSettings({ affordances }: { affordances: WorkConfigAffordances }) {
    const tPage = useTranslations('settings.workingCalendars');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const { data, error } = useWorkingCalendars();
    const { send, revalidate } = useSettingsApi();
    const canManage = affordances.manageWorkConfig;

    const save = async (input: { name: string; timeZone: string; workingWeekdays: IsoWeekday[] }) => {
        try {
            await send('PUT', SETTINGS_PATHS.workingCalendars, input);
            await revalidate(SETTINGS_PATHS.workingCalendars);
            toast.success(tPage('saved'));
            return null;
        } catch (err) {
            return refusalText(err, tPage('failed'));
        }
    };

    return (
        <DashboardLayout header={{ title: tPage('title'), description: tPage('description'), back: { smart: true } }} data-testid="working-calendars-page">
            {!canManage && <p className="text-sm text-content-muted">{tPage('readOnly')}</p>}
            {error && <p role="alert">{refusalText(error, tPage('loadFailed'))}</p>}
            {data && (
                <>
                    <Card as="section" aria-labelledby="working-calendar-workspace" className="space-y-default">
                        <Heading level={2} id="working-calendar-workspace">
                            {tPage('workspaceHeading')}
                        </Heading>
                        {data.workspace.isDefault && <p className="text-sm text-content-muted">{tPage('defaultNote', { timeZone: data.workspace.timeZone })}</p>}
                        <CalendarForm calendar={data.workspace} idPrefix="workspace-calendar" canManage={canManage} onSave={save} />
                    </Card>
                    <Card as="section" aria-labelledby="working-calendar-holidays" className="space-y-default">
                        <Heading level={2} id="working-calendar-holidays">
                            {tPage('holidaysHeading')}
                        </Heading>
                        <HolidaysPanel
                            calendar={data.workspace}
                            idPrefix="workspace-calendar"
                            cachePath={SETTINGS_PATHS.workingCalendars}
                            basePath={SETTINGS_PATHS.workingCalendars}
                            canManage={canManage}
                        />
                    </Card>
                    <Card as="section" aria-labelledby="working-calendar-teams" className="space-y-default">
                        <Heading level={2} id="working-calendar-teams">
                            {tPage('teamsHeading')}
                        </Heading>
                        <p className="text-sm text-content-muted">{tPage('teamsBody')}</p>
                        {data.teams.length === 0 ? (
                            <p className="text-sm text-content-muted">{tPage('noTeams')}</p>
                        ) : (
                            <ul className="space-y-tight text-sm" data-testid="working-calendar-teams">
                                {data.teams.map((team) => (
                                    <li key={team.teamId} className="flex flex-wrap items-center gap-default">
                                        <Link href={tenantHref(`/settings/working-calendars/${encodeURIComponent(team.teamId)}`)} className="text-content-emphasis underline">
                                            {team.teamName}
                                        </Link>
                                        <span className="text-content-muted">{team.calendarId ? tPage('teamOwn') : tPage('teamUsesWorkspace')}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </>
            )}
        </DashboardLayout>
    );
}

/** Settings → Working calendars → a team: its own calendar, or the workspace's. */
export function TeamWorkingCalendarSettings({ teamId, affordances }: { teamId: string; affordances: WorkConfigAffordances }) {
    const tTeam = useTranslations('settings.workingCalendars');
    const toast = useToast();
    const { data, error } = useTeamWorkingCalendar(teamId);
    const { data: overview } = useWorkingCalendars();
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const [busy, setBusy] = useState(false);
    const canManage = affordances.manageWorkConfig;
    const path = SETTINGS_PATHS.teamWorkingCalendar(teamId);
    const title = data ? tTeam('teamTitle', { team: data.teamName }) : tTeam('title');

    const save = async (input: { name: string; timeZone: string; workingWeekdays: IsoWeekday[] }) => {
        try {
            await send('PUT', path, input);
            await revalidate(path, SETTINGS_PATHS.workingCalendars);
            toast.success(tTeam('saved'));
            return null;
        } catch (err) {
            return refusalText(err, tTeam('failed'));
        }
    };

    const giveOwn = async () => {
        const ws = overview?.workspace;
        setBusy(true);
        const failure = await save({
            name: data?.teamName ?? tTeam('title'),
            timeZone: ws?.timeZone ?? 'UTC',
            workingWeekdays: ws?.workingWeekdays ?? [1, 2, 3, 4, 5],
        });
        setBusy(false);
        if (failure) toast.error(failure);
    };

    return (
        <DashboardLayout header={{ title, description: tTeam('teamDescription'), back: { smart: true } }} data-testid="team-working-calendar-page">
            {error && <p role="alert">{refusalText(error, tTeam('loadFailed'))}</p>}
            {data && !data.calendar && (
                <Card as="section" aria-labelledby="team-calendar-none" className="space-y-default">
                    <Heading level={2} id="team-calendar-none">
                        {tTeam('teamUsesWorkspaceHeading')}
                    </Heading>
                    <p className="text-sm text-content-muted">{tTeam('teamUsesWorkspaceBody')}</p>
                    {canManage && <Button id="team-calendar-give" variant="primary" text={tTeam('giveOwn')} loading={busy} onClick={() => void giveOwn()} />}
                </Card>
            )}
            {data?.calendar && (
                <>
                    <Card as="section" aria-labelledby="team-calendar-heading" className="space-y-default">
                        <Heading level={2} id="team-calendar-heading">
                            {tTeam('teamCalendarHeading')}
                        </Heading>
                        <CalendarForm calendar={data.calendar} idPrefix="team-calendar" canManage={canManage} onSave={save} />
                        {canManage && (
                            <Button
                                id="team-calendar-remove"
                                variant="secondary"
                                text={tTeam('useWorkspace')}
                                onClick={() =>
                                    undoDelete<TeamWorkingCalendarData>({
                                        path,
                                        without: (current) => (current ? { ...current, calendar: null } : current),
                                        deletePath: path,
                                        message: tTeam('teamCalendarRemoved', { team: data.teamName }),
                                        alsoRevalidate: [SETTINGS_PATHS.workingCalendars],
                                    })
                                }
                            />
                        )}
                    </Card>
                    <Card as="section" aria-labelledby="team-calendar-holidays" className="space-y-default">
                        <Heading level={2} id="team-calendar-holidays">
                            {tTeam('holidaysHeading')}
                        </Heading>
                        <HolidaysPanel
                            calendar={data.calendar}
                            idPrefix="team-calendar"
                            cachePath={path}
                            basePath={path}
                            canManage={canManage}
                            extraCopy={overview ? { label: tTeam('copyWorkspace'), holidays: overview.workspace.holidays } : undefined}
                        />
                    </Card>
                </>
            )}
        </DashboardLayout>
    );
}
