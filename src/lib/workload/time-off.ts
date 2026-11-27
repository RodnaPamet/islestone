/**
 * Time off's type and limits (sub-phase 3.5a; docs/porting/maps/3.5.md,
 * "Time off (3.5a)" and "The type, held apart"; ADR 0013 §2 and §3; owner
 * decisions 286, 287 and 303).
 *
 * The type is one of three codes, VACATION, SICK or OTHER (decision 303:
 * "Holiday" stays a working calendar's word). "Sick" is health data, so the
 * stored value is ENCRYPTED and every code is padded to one width before it
 * reaches the encryption extension: AES-GCM ciphertext has its plaintext's
 * length, so an unpadded SICK could be told from VACATION by length alone.
 * VACATION is exactly the width.
 *
 * Client-safe and pure. Written fresh for Islestone.
 */

export const TIME_OFF_TYPES = ['VACATION', 'SICK', 'OTHER'] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

/** Every stored code is this many characters before encryption. */
export const TIME_OFF_TYPE_WIDTH = 8;

export function isTimeOffType(value: unknown): value is TimeOffType {
    return typeof value === 'string' && (TIME_OFF_TYPES as readonly string[]).includes(value);
}

/** The code padded with spaces to {@link TIME_OFF_TYPE_WIDTH}, as it is encrypted. */
export function padTimeOffType(type: TimeOffType): string {
    return type.padEnd(TIME_OFF_TYPE_WIDTH, ' ');
}

/**
 * The code read back from a decrypted, padded value. Anything that is not one
 * of the three codes reads as OTHER rather than leaking an unexpected string.
 */
export function unpadTimeOffType(stored: string): TimeOffType {
    const code = stored.trimEnd();
    return isTimeOffType(code) ? code : 'OTHER';
}

/** The bounds every time-off and capacity write and read is held to. */
export const WORKLOAD_LIMITS = {
    /** A week's capacity, the default's and a member's: 0 to 100 hours (CHECKed). */
    weeklyMinutesMax: 6_000,
    /** Hours off on one date short of the whole day (NULL): 1 to 1,439 minutes (CHECKed). */
    timeOffMinutesMax: 1_439,
    /** Dates one write sets or removes. */
    timeOffDaysPerWrite: 366,
    /** The longest window one time-off read covers, inclusive. */
    timeOffReadDays: 366,
    /** The most dates one time-off read returns; it reads one past and refuses above (422). */
    timeOffReadRows: 2_000,
    /** The most weeks one workload read covers. */
    weeksMax: 26,
    /** The weeks the Workload page shows by default. */
    weeksDefault: 12,
    /** The most people one workload read covers; it reads one past and refuses above (422). */
    personLimit: 500,
    /** The most counted items one workload read places (3.5b); it reads one past and refuses above (422). */
    itemLimit: 20_000,
    /** The most items one cell lists (3.5b), most minutes first. */
    cellItems: 200,
    /** The most people one `userId` filter names. */
    peopleFilterMax: 50,
} as const;
