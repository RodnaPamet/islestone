/**
 * Money of sub-phase 3.4d (docs/porting/maps/3.4.md, "Rates, totals and
 * export (3.4d)"; ADR 0012 §6; owner decision 273): one ISO 4217 currency
 * per workspace, every rate and amount a whole number of its minor units.
 *
 *   - A currency is three upper-case letters that `Intl.NumberFormat` knows
 *     (the database's CHECK holds the shape; this module holds the meaning).
 *   - A currency's minor-unit digits are `Intl.NumberFormat`'s (EUR 2, JPY 0,
 *     KWD 3), never a table of our own: inflect-compliance's "currency symbol"
 *     names no currency and no digits, the lesson not followed.
 *   - An amount is `round_half_up(minutes × hourly rate / 60)` in minor units,
 *     rounded per entry (`amountMinor`), so a total is the sum of its lines.
 *
 * Client-safe and pure. Written fresh for Islestone.
 */

/** The highest hourly rate, in minor units (CHECK `BillableRate_rate_range`). */
export const RATE_MINOR_MAX = 2_000_000_000;

/** Whether `code` is a currency: three upper-case letters `Intl` formats as one. */
export function isCurrencyCode(code: string): boolean {
    if (!/^[A-Z]{3}$/.test(code)) return false;
    try {
        new Intl.NumberFormat('en', { style: 'currency', currency: code });
    } catch {
        return false;
    }
    // `Intl` accepts any well-formed code; the supported list says which are real.
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return supported ? supported('currency').includes(code) : true;
}

/** The minor-unit digits of `currency` (2 for EUR, 0 for JPY, 3 for KWD). */
export function minorDigits(currency: string): number {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** `minor` minor units of `currency`, formatted (`€1,234.50`, `¥1,235`). */
export function formatMoney(minor: number, currency: string, locale = 'en'): string {
    const digits = minorDigits(currency);
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
}

/** `minor` as a plain decimal in major units, for a spreadsheet cell or an input (`1234.50`). */
export function minorToDecimal(minor: number, currency: string): string {
    const digits = minorDigits(currency);
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    if (digits === 0) return `${sign}${abs}`;
    const scale = 10 ** digits;
    return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, '0')}`;
}

/**
 * A typed amount in major units ("120", "120.5", "1,200.50") as whole minor
 * units of `currency`, or `null` when it is not a non-negative amount with at
 * most the currency's digits, or above `RATE_MINOR_MAX`.
 */
export function parseMoney(text: string, currency: string): number | null {
    const digits = minorDigits(currency);
    const clean = text.trim().replace(/[,\s]/g, '');
    const m = /^(\d+)(?:\.(\d*))?$/.exec(clean);
    if (!m) return null;
    const fraction = m[2] ?? '';
    if (fraction.length > digits) return null;
    const whole = Number(m[1]);
    const minor = whole * 10 ** digits + (fraction.length > 0 ? Number(fraction.padEnd(digits, '0')) : 0);
    if (!Number.isSafeInteger(minor) || minor > RATE_MINOR_MAX) return null;
    return minor;
}

/**
 * A billable entry's amount: `minutes × hourlyRateMinor / 60`, rounded half
 * up to a whole minor unit (decision 273: per entry, so a total is the sum of
 * its lines). Exact in a double: `minutes ≤ 1,440` and a rate ≤ 2×10⁹ keep the
 * product under 2⁵³.
 */
export function amountMinor(minutes: number, hourlyRateMinor: number): number {
    return Math.floor((minutes * hourlyRateMinor + 30) / 60);
}
