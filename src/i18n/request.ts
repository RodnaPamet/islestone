import { getRequestConfig } from 'next-intl/server';

import messages from '../../messages/en.json';

/**
 * next-intl's request config, without i18n routing. Islestone is English-only
 * until a second locale is decided (sub-phase 1.7), so the locale is fixed and
 * the catalogue is `messages/en.json`, which holds the keys the shared UI
 * reads (docs/porting/maps/1.2.md, section 6.6). The root layout's
 * NextIntlClientProvider hands these messages to client components.
 */
export default getRequestConfig(async () => ({ locale: 'en', messages }));
