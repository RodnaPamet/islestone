/**
 * The shared frame of every Islestone email: one column, the product's sign
 * off, inline styles only (mail clients drop `<style>` and web fonts). Keep it
 * cheap to render — no network fonts, no remote images — because the
 * templates render inside the request or job that enqueues the mail.
 *
 * Written for Islestone with react-email (`@react-email/components`, MIT);
 * the look follows inflect-compliance's hand-built HTML (pattern only).
 */
import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export const PRODUCT_NAME = 'Islestone';

const body = {
    backgroundColor: '#ffffff',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};
const container = { maxWidth: '640px', margin: '0 auto', padding: '24px' };
const heading = { color: '#1a1a2e', fontSize: '18px', margin: '0 0 16px' };
const signOff = { color: '#999999', fontSize: '12px', marginTop: '24px' };

export const paragraph = { color: '#444444', lineHeight: '1.5', fontSize: '14px' };
export const button = {
    display: 'inline-block',
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 500,
};

export function EmailLayout(props: { preview: string; heading: string; children: ReactNode }) {
    return (
        <Html lang="en">
            <Head />
            <Preview>{props.preview}</Preview>
            <Body style={body}>
                <Container style={container}>
                    <Heading as="h2" style={heading}>
                        {props.heading}
                    </Heading>
                    {props.children}
                    <Text style={signOff}>— {PRODUCT_NAME}</Text>
                </Container>
            </Body>
        </Html>
    );
}
