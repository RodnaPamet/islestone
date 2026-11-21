/**
 * The scale seed's word list (Hardening H2a, docs/performance.md): ordinary
 * project-management words in Bulgarian and English, inflected forms
 * included, so generated titles, descriptions and comments exercise both
 * halves of the `islestone_bg_en` search configuration (the Bulgarian
 * dictionary for Cyrillic words, `english_stem` for Latin ones). Written for
 * Islestone; no corpus is downloaded.
 */

/** Bulgarian words, nouns in several forms, verbs and a few adjectives. */
export const BULGARIAN_WORDS: readonly string[] = [
    'задача', 'задачата', 'задачи', 'задачите', 'проект', 'проектът', 'проекта', 'проекти', 'проектите',
    'коментар', 'коментарът', 'коментари', 'коментарите', 'потребител', 'потребителят', 'потребителите',
    'срок', 'срокът', 'сроковете', 'въпрос', 'въпросът', 'въпросите', 'отговор', 'отговорът', 'отговори',
    'книга', 'книгите', 'документ', 'документът', 'документи', 'документите', 'договор', 'договорът',
    'клиент', 'клиентът', 'клиенти', 'клиентите', 'фактура', 'фактурата', 'фактури', 'плащане', 'плащането',
    'доставка', 'доставката', 'доставки', 'склад', 'складът', 'поръчка', 'поръчката', 'поръчки', 'поръчките',
    'грешка', 'грешката', 'грешки', 'грешките', 'проблем', 'проблемът', 'проблеми', 'решение', 'решението',
    'преглед', 'прегледът', 'среща', 'срещата', 'срещи', 'отчет', 'отчетът', 'отчети', 'бюджет', 'бюджетът',
    'екип', 'екипът', 'екипа', 'служител', 'служителите', 'отдел', 'отделът', 'сървър', 'сървърът', 'база',
    'данни', 'данните', 'страница', 'страницата', 'бутон', 'бутонът', 'формуляр', 'формулярът', 'поле', 'полето',
    'държава', 'държавата', 'община', 'общината', 'град', 'градът', 'адрес', 'адресът', 'телефон', 'имейл',
    'работя', 'работихме', 'работи', 'проверя', 'проверка', 'проверката', 'обновя', 'обновяване', 'обновяването',
    'добавя', 'добавяне', 'премахна', 'премахване', 'поправя', 'поправка', 'поправката', 'тествам', 'тестване',
    'изпрати', 'изпращане', 'получи', 'получаване', 'одобри', 'подготви', 'подготовка', 'планиране', 'планът',
    'нов', 'нова', 'новия', 'стар', 'старата', 'бърз', 'бавен', 'бавната', 'важен', 'важна', 'спешна', 'основен',
    'месечен', 'месечния', 'годишен', 'годишния', 'седмичен', 'вътрешен', 'външен', 'мобилен', 'мобилното',
    'щъркелоподобни', 'приложение', 'приложението', 'версия', 'версията', 'изданието', 'миграция', 'миграцията',
];

/** English words, nouns and verbs in several forms. */
export const ENGLISH_WORDS: readonly string[] = [
    'task', 'tasks', 'project', 'projects', 'comment', 'comments', 'user', 'users', 'deadline', 'deadlines',
    'question', 'questions', 'answer', 'answers', 'book', 'books', 'document', 'documents', 'contract', 'contracts',
    'customer', 'customers', 'invoice', 'invoices', 'payment', 'payments', 'delivery', 'deliveries', 'warehouse',
    'order', 'orders', 'error', 'errors', 'problem', 'problems', 'solution', 'review', 'reviews', 'meeting',
    'meetings', 'report', 'reports', 'budget', 'budgets', 'team', 'teams', 'employee', 'employees', 'department',
    'server', 'servers', 'database', 'data', 'page', 'pages', 'button', 'buttons', 'form', 'forms', 'field', 'fields',
    'country', 'city', 'address', 'phone', 'email', 'release', 'releases', 'version', 'versions', 'migration',
    'running', 'run', 'runs', 'tests', 'test', 'testing', 'fixing', 'fix', 'fixed', 'fixes', 'update', 'updated',
    'updating', 'add', 'added', 'adding', 'remove', 'removed', 'removing', 'check', 'checked', 'checking', 'send',
    'sending', 'sent', 'receive', 'received', 'approve', 'approved', 'prepare', 'prepared', 'planning', 'plan',
    'new', 'old', 'fast', 'slow', 'important', 'urgent', 'main', 'monthly', 'yearly', 'weekly', 'internal',
    'external', 'mobile', 'application', 'dashboard', 'export', 'import', 'search', 'filter', 'login', 'settings',
    'notification', 'notifications', 'integration', 'integrations', 'performance', 'security', 'backup', 'restore',
];

/** Words that join a sentence, in each language. */
export const BULGARIAN_JOINERS: readonly string[] = ['и', 'за', 'на', 'от', 'с', 'в', 'след', 'преди', 'към', 'без'];
export const ENGLISH_JOINERS: readonly string[] = ['and', 'for', 'of', 'from', 'with', 'in', 'after', 'before', 'to', 'without'];
