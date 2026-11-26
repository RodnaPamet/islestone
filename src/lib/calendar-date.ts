/**
 * A strict `YYYY-MM-DD` calendar date: four-digit year, a month 01 to 12 and
 * a day that exists in that month (`2026-02-30` is refused). Pure and
 * dependency-free, so `src/env.ts` can validate `E2E_TODAY` with it
 * (Hardening H2g) without importing the clock seam that reads the value.
 */
export function isCalendarDate(value: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const at = new Date(Date.UTC(y, mo - 1, d));
    return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}
