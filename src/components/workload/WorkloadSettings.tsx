'use client';

/**
 * Settings → Workload (sub-phase 3.5a; docs/porting/maps/3.5.md, "The page";
 * owner decisions 284, 285, 288 and 298): the workspace's default weekly hours;
 * a members table (name, capacity in force, its calendar, the next change)
 * with "Change capacity" (from a Monday, hours, calendar) and removing a
 * future change through the undo toast; and any member's time off as the same
 * month of dates, with its types. Every write follows `workloadAffordances`,
 * asked on the server; nothing here asks a role or a key.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { formatDay } from '@/components/time/time-format';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ApiClientError } from '@/lib/data/api-client';
import { isoWeekday, weekStartOf, addDays } from '@/lib/time/week';
import { formatDuration, parseDuration } from '@/lib/work-items/estimate';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { WorkloadAffordances, WorkloadMemberRow, WorkloadMembersData } from '@/lib/workload/types';

import { TimeOffCalendar } from './TimeOffCalendar';
import { useWorkloadMembers, useWorkloadSettings, useWorkloadWrites } from './data/use-workload';
import { hoursText } from './workload-model';

const WORKSPACE = '__workspace__';

function weeklyOf(text: string): number | null {
    const m = parseDuration(text);
    return m === null || m < 0 || m > WORKLOAD_LIMITS.weeklyMinutesMax ? null : m;
}

function DefaultCapacity({ canManage }: { canManage: boolean }) {
    const tDefault = useTranslations('settings.workload.default');
    const { data } = useWorkloadSettings();
    const writes = useWorkloadWrites();
    const [text, setText] = useState<string | null>(null);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    if (!data) return null;
    const value = text ?? formatDuration(data.defaultWeeklyMinutes);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const minutes = weeklyOf(value);
        if (minutes === null) return setMessage({ ok: false, text: tDefault('invalid') });
        const out = await writes.setDefault(minutes, data.version);
        if (out instanceof ApiClientError) return setMessage({ ok: false, text: out.reason ?? tDefault('failed') });
        setText(null);
        setMessage({ ok: true, text: tDefault('saved') });
    };

    return (
        <Card as="section" aria-labelledby="workload-default-heading" className="space-y-default">
            <Heading level={2} id="workload-default-heading">
                {tDefault('heading')}
            </Heading>
            <p className="text-sm text-content-muted">{tDefault('body')}</p>
            {canManage ? (
                <form onSubmit={submit} className="flex flex-wrap items-end gap-default">
                    <FormField label={tDefault('label')} hint={tDefault('hint')}>
                        <Input id="workload-default-hours" value={value} onChange={(e) => setText(e.target.value)} autoComplete="off" />
                    </FormField>
                    <Button id="workload-default-save" type="submit" variant="primary" text={tDefault('save')} />
                </form>
            ) : (
                <p className="text-sm" data-testid="workload-default-value">
                    {tDefault('value', { hours: hoursText(data.defaultWeeklyMinutes) })}
                </p>
            )}
            {message && (
                <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-content-muted' : 'text-sm text-content-error'}>
                    {message.text}
                </p>
            )}
        </Card>
    );
}

function CapacityDialog({ member, data, onClose }: { member: WorkloadMemberRow; data: WorkloadMembersData; onClose: () => void }) {
    const tCap = useTranslations('settings.workload.capacity');
    const writes = useWorkloadWrites();
    const nextMonday = addDays(weekStartOf(data.currentWeek), 7);
    const [from, setFrom] = useState(nextMonday);
    const [hours, setHours] = useState(formatDuration(member.inForce?.weeklyMinutes ?? data.defaultWeeklyMinutes));
    const [team, setTeam] = useState<string>(member.inForce?.calendarTeamId ?? WORKSPACE);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const options: ComboboxOption[] = [{ value: WORKSPACE, label: tCap('workspaceCalendar') }, ...data.teams.map((t) => ({ value: t.id, label: t.name }))];
    const title = tCap('title', { name: member.name ?? tCap('unnamed') });

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!from || isoWeekday(from) !== 1) return setError(tCap('notMonday'));
        const minutes = weeklyOf(hours);
        if (minutes === null) return setError(tCap('invalid'));
        const sameMonday = [member.inForce, member.next].find((r) => r?.effectiveFrom === from);
        setSaving(true);
        const out = await writes.setCapacity(member.userId, { effectiveFrom: from, weeklyMinutes: minutes, calendarTeamId: team === WORKSPACE ? null : team }, sameMonday?.version);
        setSaving(false);
        if (out instanceof ApiClientError) return setError(out.reason ?? tCap('failed'));
        onClose();
    };

    return (
        <Modal showModal setShowModal={(v) => { if (!(typeof v === 'function' ? v(true) : v)) onClose(); }} title={title} onClose={onClose}>
            <Modal.Header title={title} description={tCap('description')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        <FormField label={tCap('from')} hint={tCap('fromHint')}>
                            <DatePicker id="capacity-from" value={parseYMD(from)} onChange={(d) => setFrom(toYMD(d) ?? '')} />
                        </FormField>
                        <FormField label={tCap('hours')} hint={tCap('hoursHint')}>
                            <Input id="capacity-hours" value={hours} onChange={(e) => setHours(e.target.value)} autoComplete="off" />
                        </FormField>
                        <FormField label={tCap('calendar')} hint={tCap('calendarHint')}>
                            <Combobox id="capacity-calendar" selected={options.find((o) => o.value === team) ?? null} setSelected={(o) => o && setTeam(o.value)} options={options} caret />
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tCap('cancel')} onClick={onClose} />
                        <Button id="capacity-save" type="submit" variant="primary" text={tCap('save')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

function MembersCapacity({ data }: { data: WorkloadMembersData }) {
    const tMembers = useTranslations('settings.workload.members');
    const writes = useWorkloadWrites();
    const [changing, setChanging] = useState<WorkloadMemberRow | null>(null);
    const teamName = (id: string | null) => (id ? (data.teams.find((t) => t.id === id)?.name ?? tMembers('teamGone')) : tMembers('workspaceCalendar'));

    return (
        <Card as="section" aria-labelledby="workload-members-heading" className="space-y-default">
            <Heading level={2} id="workload-members-heading">
                {tMembers('heading')}
            </Heading>
            <p className="text-sm text-content-muted">{tMembers('body')}</p>
            <div className="overflow-x-auto">
                <table className="data-table w-full text-sm" aria-labelledby="workload-members-heading" data-testid="workload-members">
                    <thead>
                        <tr>
                            <th scope="col" className="text-left">{tMembers('name')}</th>
                            <th scope="col" className="text-left">{tMembers('capacity')}</th>
                            <th scope="col" className="text-left">{tMembers('calendar')}</th>
                            <th scope="col" className="text-left">{tMembers('next')}</th>
                            <th scope="col" className="text-right">{tMembers('actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.members.map((m) => {
                            const name = m.name ?? tMembers('unnamed');
                            return (
                                <tr key={m.userId} data-testid={`workload-member-${m.userId}`}>
                                    <th scope="row" className="text-left font-normal">{name}</th>
                                    <td>{m.inForce ? hoursText(m.inForce.weeklyMinutes) : tMembers('usesDefault', { hours: hoursText(data.defaultWeeklyMinutes) })}</td>
                                    <td>{teamName(m.inForce?.calendarTeamId ?? null)}</td>
                                    <td>
                                        {m.next ? (
                                            <span className="flex flex-wrap items-center gap-tight">
                                                {tMembers('nextValue', { hours: hoursText(m.next.weeklyMinutes), date: formatDay(m.next.effectiveFrom, 'dateYear') })}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    text={tMembers('removeNext')}
                                                    aria-label={tMembers('removeNextNamed', { name })}
                                                    onClick={() => writes.removeCapacity(m.next!)}
                                                />
                                            </span>
                                        ) : (
                                            <span className="text-content-muted">{tMembers('none')}</span>
                                        )}
                                    </td>
                                    <td className="text-right">
                                        <Button variant="secondary" size="sm" text={tMembers('change')} aria-label={tMembers('changeNamed', { name })} onClick={() => setChanging(m)} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {changing && <CapacityDialog member={changing} data={data} onClose={() => setChanging(null)} />}
        </Card>
    );
}

function MembersTimeOff({ data, today }: { data: WorkloadMembersData; today: string }) {
    const tOff = useTranslations('settings.workload.timeOff');
    const [userId, setUserId] = useState<string | null>(data.members[0]?.userId ?? null);
    const options: ComboboxOption[] = data.members.map((m) => ({ value: m.userId, label: m.name ?? tOff('unnamed') }));
    return (
        <Card as="section" aria-labelledby="workload-time-off-heading" className="space-y-default">
            <Heading level={2} id="workload-time-off-heading">
                {tOff('heading')}
            </Heading>
            <p className="text-sm text-content-muted">{tOff('body')}</p>
            <FormField label={tOff('member')}>
                <Combobox id="workload-time-off-member" selected={options.find((o) => o.value === userId) ?? null} setSelected={(o) => o && setUserId(o.value)} options={options} caret />
            </FormField>
            {userId && <TimeOffCalendar key={userId} userId={userId} personId={userId} today={today} canWrite idPrefix="member-time-off" />}
        </Card>
    );
}

export function WorkloadSettings({ title, affordances, today }: { title: string; affordances: WorkloadAffordances; today: string }) {
    const t = useTranslations('settings.workload');
    const members = useWorkloadMembers(affordances.manage);
    return (
        <DashboardLayout header={{ title, description: t('description'), back: { smart: true } }} data-testid="workload-settings">
            <div className="space-y-section">
                <DefaultCapacity canManage={affordances.manage} />
                {!affordances.manage && <p className="text-sm text-content-muted">{t('readOnly')}</p>}
                {members.data && <MembersCapacity data={members.data} />}
                {members.data && <MembersTimeOff data={members.data} today={today} />}
            </div>
        </DashboardLayout>
    );
}
