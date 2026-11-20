/**
 * Inbound email's pure pieces (sub-phase 2.6c; owner decisions 122 and 123):
 * the Svix signature, the address tokens, RFC 2047, the MIME walk, HTML to
 * text, quoted-history stripping, auto-reply detection, the sender check
 * from `Authentication-Results`, the download host pin and the production
 * startup check. Fixtures are recorded shapes from the common clients; none
 * reaches the network.
 */
import { addressesIn, ADDRESS_TOKEN_LENGTH, mailboxOf, mintAddressToken, mintReplyToken, parseIntakeAddress, replyAddress, TOKEN_ALPHABET } from '@/lib/intake/email/address';
import { senderCheckFrom } from '@/lib/intake/email/auth-results';
import { contentFromFields, contentFromRaw, MAX_BODY, NO_SUBJECT } from '@/lib/intake/email/content';
import { displayHeader, parseEmail } from '@/lib/intake/email/mime';
import { downloadUrlAllowed } from '@/lib/intake/email/resend-download';
import { decodeEncodedWords } from '@/lib/intake/email/rfc2047';
import { svixSignature, verifySvixSignature } from '@/lib/intake/email/svix';
import { htmlToText, isAutomatedMessage, stripQuotedHistory } from '@/lib/intake/email/text';
import { checkProductionIntakeEmail } from '@/lib/security/startup-intake-email-check';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // pragma: allowlist secret — Svix's published test vector

describe('the Svix signature (decision 122)', () => {
    const base = { secret: SECRET, id: 'msg_p5jXN8AQM9LWM0D4loKWxJek', timestamp: '1614265330', rawBody: '{"test": 2432232314}', nowSeconds: 1614265330 };

    it("matches Svix's published test vector", () => {
        expect(svixSignature(SECRET, base.id, base.timestamp, base.rawBody)).toBe('g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
        expect(verifySvixSignature({ ...base, signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' })).toEqual({ ok: true });
    });

    it('accepts any one matching entry of a space-separated list (a secret rotating)', () => {
        expect(verifySvixSignature({ ...base, signature: 'v1,AAAA v2,zzz v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' })).toEqual({ ok: true });
    });

    it('refuses a changed body, a wrong version tag, a missing header and a bad secret', () => {
        const sig = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
        expect(verifySvixSignature({ ...base, signature: sig, rawBody: '{"test": 2432232315}' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        expect(verifySvixSignature({ ...base, signature: 'v2,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        expect(verifySvixSignature({ ...base, signature: null })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
        expect(verifySvixSignature({ ...base, id: null, signature: sig })).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
        expect(verifySvixSignature({ ...base, secret: undefined, signature: sig })).toEqual({ ok: false, reason: 'BAD_SECRET' });
        expect(verifySvixSignature({ ...base, secret: 'not-a-whsec-secret', signature: sig })).toEqual({ ok: false, reason: 'BAD_SECRET' }); // pragma: allowlist secret — a malformed test secret
    });

    it('refuses a timestamp more than five minutes either side of now', () => {
        const sig = (ts: string) => `v1,${svixSignature(SECRET, base.id, ts, base.rawBody)}`;
        const now = 1_800_000_000;
        expect(verifySvixSignature({ ...base, nowSeconds: now, timestamp: String(now - 300), signature: sig(String(now - 300)) })).toEqual({ ok: true });
        expect(verifySvixSignature({ ...base, nowSeconds: now, timestamp: String(now - 301), signature: sig(String(now - 301)) })).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
        expect(verifySvixSignature({ ...base, nowSeconds: now, timestamp: String(now + 301), signature: sig(String(now + 301)) })).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
        expect(verifySvixSignature({ ...base, nowSeconds: now, timestamp: 'soon', signature: sig('soon') })).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
    });
});

describe('intake addresses', () => {
    it('mints tokens from the unambiguous alphabet, at their lengths', () => {
        for (let i = 0; i < 50; i++) {
            const t = mintAddressToken();
            expect(t).toHaveLength(ADDRESS_TOKEN_LENGTH);
            expect([...t].every((c) => TOKEN_ALPHABET.includes(c))).toBe(true);
        }
        expect(mintReplyToken()).toHaveLength(16);
        expect(TOKEN_ALPHABET).not.toMatch(/[01ilo]/);
    });

    it('parses an address and a reply address on the configured domain only, case-insensitively', () => {
        const token = 'abcdefghjkmn';
        const reply = 'pqrstuvwxyz23456';
        expect(parseIntakeAddress(`${token}@in.islestone.cloud`, 'in.islestone.cloud')).toEqual({ token, replyToken: null });
        expect(parseIntakeAddress(replyAddress(token, reply, 'in.islestone.cloud').toUpperCase(), 'in.islestone.cloud')).toEqual({ token, replyToken: reply });
        expect(parseIntakeAddress(`${token}@elsewhere.example`, 'in.islestone.cloud')).toBeNull();
        expect(parseIntakeAddress(`${token}x@in.islestone.cloud`, 'in.islestone.cloud')).toBeNull();
        expect(parseIntakeAddress(`${token}+rshort@in.islestone.cloud`, 'in.islestone.cloud')).toBeNull();
        expect(parseIntakeAddress('abcdefghjkm0@in.islestone.cloud', 'in.islestone.cloud')).toBeNull();
    });

    it('reads every address of a header list, quoted commas and comments included', () => {
        expect(addressesIn('"Lovelace, Ada" <Ada@Example.com>, bob@example.com (Bob, the builder)')).toEqual(['ada@example.com', 'bob@example.com']);
        expect(mailboxOf('"Ada \\"Countess\\" Lovelace" <ada@example.com>')).toEqual({ name: 'Ada "Countess" Lovelace', address: 'ada@example.com' });
        expect(mailboxOf('ada@example.com')).toEqual({ name: null, address: 'ada@example.com' });
    });
});

describe('RFC 2047 and headers', () => {
    it('decodes B and Q words, joins adjacent words and strips controls', () => {
        expect(decodeEncodedWords('=?utf-8?B?UHLDvGZ1bmc=?= =?ISO-8859-1?Q?_f=FCr_Ada?=')).toBe('Prüfung für Ada');
        expect(decodeEncodedWords('plain =?utf-8?q?caf=C3=A9?= text')).toBe('plain café text');
        expect(displayHeader('Printer\r\n on =?utf-8?B?ZmlyZQ==?=\u0007')).toBe('Printer on fire');
        // An unknown charset decodes as UTF-8 rather than failing the message.
        expect(decodeEncodedWords('=?x-unknown?B?b2s=?=')).toBe('ok');
    });
});

const CRLF = (lines: string[]) => lines.join('\r\n');

describe('the MIME walk', () => {
    it('prefers text/plain, decodes base64 and quoted-printable, and counts attachments', () => {
        const raw = CRLF([
            'From: Ada <ada@example.com>',
            'Subject: =?utf-8?B?UHJpbnRlciBvbiBmaXJl?=',
            'Message-ID: <m1@example.com>',
            'Content-Type: multipart/mixed; boundary="outer"',
            '',
            '--outer',
            'Content-Type: multipart/alternative; boundary=inner',
            '',
            '--inner',
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            'It smokes =E2=80=94 a lot.=',
            ' Really.',
            '--inner',
            'Content-Type: text/html; charset=utf-8',
            'Content-Transfer-Encoding: base64',
            '',
            Buffer.from('<p>It smokes</p>').toString('base64'),
            '--inner--',
            '--outer',
            'Content-Type: image/png; name="smoke.png"',
            'Content-Disposition: attachment; filename="smoke.png"',
            'Content-Transfer-Encoding: base64',
            '',
            'iVBORw0KGgo=',
            '--outer--',
        ]);
        const parsed = parseEmail(raw);
        expect(parsed.text).toBe('It smokes — a lot. Really.');
        expect(parsed.html).toBe('<p>It smokes</p>');
        expect(parsed.attachments).toBe(1);
        expect(parsed.contentType).toBe('multipart/mixed');
        const content = contentFromRaw(new TextEncoder().encode(raw), { emailId: 'e1' });
        expect(content).toMatchObject({ title: 'Printer on fire', body: 'It smokes — a lot. Really.', fromAddress: 'ada@example.com', fromName: 'Ada', attachmentsDropped: 1, automated: false, senderCheck: 'NONE' });
        // One request per message: the Message-ID's hash, the same for the same message.
        expect(content.dedupeHash).toBe(contentFromRaw(new TextEncoder().encode(raw), { emailId: 'other' }).dedupeHash);
    });

    it('falls back to the HTML part, and to "No subject"; caps the body', () => {
        const raw = CRLF(['From: bob@example.com', 'Content-Type: text/html', '', `<div>${'a'.repeat(MAX_BODY + 50)}</div>`]);
        const c = contentFromRaw(new TextEncoder().encode(raw), { emailId: 'e2' });
        expect(c.title).toBe(NO_SUBJECT);
        expect(c.body).toHaveLength(MAX_BODY);
    });

    it('builds content from the API fields alone, never authenticated', () => {
        const c = contentFromFields({ emailId: 'e3', subject: 'Hi', from: 'Ada <ada@example.com>', text: null, html: '<p>Hello</p>', messageId: null, attachments: 2 });
        expect(c).toMatchObject({ title: 'Hi', body: 'Hello', fromAddress: 'ada@example.com', attachmentsDropped: 2, automated: false, senderCheck: 'NONE' });
    });
});

describe('HTML to text and quoted history', () => {
    it('turns blocks into lines, drops scripts and quoted blockquotes, and decodes entities', () => {
        expect(htmlToText('<style>p{}</style><p>One&nbsp;&amp;&#32;two</p><ul><li>a</li><li>b</li></ul><script>x()</script><blockquote>old</blockquote><br>end')).toBe(
            'One & two\n\n- a\n- b\n\nend',
        );
    });

    it('leaves no markup when a tag re-forms from what one pass removed', () => {
        for (const html of [
            '<scr<script>x</script>ipt>alert(1)</script>ok',
            '<!<!-- a -->-- b -->ok',
            'ok<scr<b>i</b>pt',
            'ok <img src=x onerror=alert(1)',
        ]) {
            const text = htmlToText(html);
            expect(text).not.toMatch(/<[a-z!/]/i);
            expect(text).toContain('ok');
        }
    });

    it('cuts Gmail, Outlook, Apple Mail and signature history, and drops > lines', () => {
        expect(stripQuotedHistory('New text\n\nOn Mon, 3 Feb 2026 at 10:00, Ada <ada@example.com> wrote:\n> old')).toBe('New text');
        expect(stripQuotedHistory('New text\nOn Mon, 3 Feb 2026 at 10:00, Ada Lovelace <ada@example.com>\nwrote:\n> old')).toBe('New text');
        expect(stripQuotedHistory('New text\n\nFrom: Ada Lovelace\nSent: Monday\nTo: x\nSubject: y\n\nold')).toBe('New text');
        expect(stripQuotedHistory('New text\n-----Original Message-----\nold')).toBe('New text');
        expect(stripQuotedHistory('New text\n-- \nAda, Countess')).toBe('New text');
        expect(stripQuotedHistory('keep\n> quoted\nkeep too')).toBe('keep\nkeep too');
        expect(stripQuotedHistory('Le lun. 3 févr. 2026, Ada a écrit :\nancien')).toBe('');
    });
});

describe('auto-replies and bounces are dropped (never answered)', () => {
    const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
    it.each([
        [{ 'auto-submitted': 'auto-replied' }, 'text/plain', 'ada@example.com'],
        [{ precedence: 'bulk' }, 'text/plain', 'ada@example.com'],
        [{ precedence: 'auto_reply' }, 'text/plain', 'ada@example.com'],
        [{ 'x-autoreply': 'yes' }, 'text/plain', 'ada@example.com'],
        [{ 'return-path': '< >' }, 'text/plain', 'ada@example.com'],
        [{}, 'multipart/report', 'ada@example.com'],
        [{}, 'text/plain', 'MAILER-DAEMON@example.com'],
    ])('%j %s %s is automated', (h, ct, from) => {
        expect(isAutomatedMessage(headers(h), ct, from)).toBe(true);
    });
    it('an ordinary message, and Auto-Submitted: no, are not', () => {
        expect(isAutomatedMessage(headers({}), 'text/plain', 'ada@example.com')).toBe(false);
        expect(isAutomatedMessage(headers({ 'auto-submitted': 'no' }), 'text/plain', 'ada@example.com')).toBe(false);
    });
});

describe('the sender check (decision 123)', () => {
    const TRUSTED = 'mx.resend.example';
    it('is VERIFIED only on a DMARC pass, or an aligned DKIM pass, in the trusted header', () => {
        expect(senderCheckFrom([`${TRUSTED}; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com`], TRUSTED, 'example.com')).toBe('VERIFIED');
        expect(senderCheckFrom([`${TRUSTED}; dkim=pass header.d=example.com`], TRUSTED, 'mail.example.com')).toBe('VERIFIED');
        expect(senderCheckFrom([`${TRUSTED}; dkim=pass header.d=other.example`], TRUSTED, 'example.com')).toBe('NONE');
        expect(senderCheckFrom([`${TRUSTED}; dmarc=fail header.from=example.com`], TRUSTED, 'example.com')).toBe('FAILED');
        expect(senderCheckFrom([`${TRUSTED}; dmarc=none header.from=example.com; spf=pass`], TRUSTED, 'example.com')).toBe('NONE');
        // SPF alone vouches for the envelope, not the From the requester sees.
        expect(senderCheckFrom([`${TRUSTED}; spf=pass smtp.mailfrom=example.com`], TRUSTED, 'example.com')).toBe('NONE');
    });

    it('ignores a header from any other server (a sender can write one), and is NONE with no trusted id', () => {
        const forged = 'attacker.example; dmarc=pass header.from=example.com';
        expect(senderCheckFrom([forged], TRUSTED, 'example.com')).toBe('NONE');
        expect(senderCheckFrom([`${TRUSTED}; dmarc=pass header.from=example.com`], undefined, 'example.com')).toBe('NONE');
        expect(senderCheckFrom([`${TRUSTED}; dmarc=pass header.from=example.com`], TRUSTED, null)).toBe('NONE');
        expect(senderCheckFrom([], TRUSTED, 'example.com')).toBe('NONE');
    });

    it('reads it from a raw message', () => {
        const raw = CRLF([`Authentication-Results: ${TRUSTED}; dmarc=pass (p=reject) header.from=example.com`, 'From: Ada <ada@example.com>', 'Subject: x', '', 'body']);
        expect(contentFromRaw(new TextEncoder().encode(raw), { emailId: 'e', authservId: TRUSTED }).senderCheck).toBe('VERIFIED');
        expect(contentFromRaw(new TextEncoder().encode(raw), { emailId: 'e' }).senderCheck).toBe('NONE');
    });
});

describe('the download host pin', () => {
    it.each([
        ['https://inbound.resend.com/raw/abc?sig=1', true],
        ['https://resend-inbound.s3.eu-west-1.amazonaws.com/abc?X-Amz-Signature=1', true],
        ['https://files.resend.app/abc', true],
        ['http://inbound.resend.com/raw/abc', false],
        ['https://user:pw@inbound.resend.com/raw/abc', false],
        ['https://inbound.resend.com:8443/raw/abc', false],
        ['https://resend.com.attacker.example/raw', false],
        ['https://evilresend.com/raw', false],
        ['https://169.254.169.254/latest/meta-data', false],
        ['not a url', false],
    ])('%s → %s', (url, ok) => {
        expect(downloadUrlAllowed(url)).toBe(ok);
    });
});

describe('the production startup check', () => {
    const prod = { NODE_ENV: 'production' };
    it('refuses INTAKE_EMAIL=1 without the key and the whsec_ secret', () => {
        expect(checkProductionIntakeEmail({ ...prod, INTAKE_EMAIL: '1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/RESEND_API_KEY and RESEND_WEBHOOK_SECRET/) });
        expect(checkProductionIntakeEmail({ ...prod, INTAKE_EMAIL: '1', RESEND_API_KEY: 're_x' })).toMatchObject({ ok: false, reason: expect.stringMatching(/RESEND_WEBHOOK_SECRET is not set/) });
        expect(checkProductionIntakeEmail({ ...prod, INTAKE_EMAIL: '1', RESEND_API_KEY: 're_x', RESEND_WEBHOOK_SECRET: 'plain' })).toMatchObject({ ok: false });
        expect(checkProductionIntakeEmail({ ...prod, INTAKE_EMAIL: '1', RESEND_API_KEY: 're_x', RESEND_WEBHOOK_SECRET: 'whsec_abc' })).toEqual({ ok: true });
    });
    it('passes when inbound email is closed, and outside production', () => {
        expect(checkProductionIntakeEmail(prod)).toEqual({ ok: true });
        expect(checkProductionIntakeEmail({ NODE_ENV: 'development', INTAKE_EMAIL: '1' })).toEqual({ ok: true });
    });
});
