/**
 * Scaffold a locale directory that is complete on the first commit.
 *
 * Copying an existing locale is how packs end up with someone else's author
 * name and version, or missing locale.json entirely -- which makes them
 * uninstallable rather than merely untranslated.
 *
 * Usage: npm run new-locale -- fr_CA --name "French (Canada)" [--direction rtl]
 *                              [--short French] [--date-format d/m/Y] [--author "Name"]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { DOMAINS, readPo, merge, writeCatalogue } from './lib.mjs';

const argv = process.argv.slice(2);
const locale = argv[0];
if (!locale || !/^[a-z]{2,3}_[A-Za-z]{2,4}$/.test(locale)) {
    console.error('Usage: npm run new-locale -- <locale>  e.g. fr_CA');
    process.exit(1);
}
const flag = (n, d = '') => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };

const dir = `src/translations/${locale}`;
try { await access(dir); console.error(`${locale} already exists`); process.exit(1); } catch {}
await mkdir(dir, { recursive: true });

const meta = JSON.parse(await readFile('src/templates/locale.json', 'utf8'));
const name = flag('name', locale);
await writeFile(`${dir}/locale.json`, JSON.stringify({
    ...meta,
    locale_code: locale,
    name,
    short_name: flag('short', name.split(' ')[0]),
    description: `${name} translation`,
    direction: flag('direction', 'ltr'),
    version: '1.0.0',
    author_name: flag('author', 'Shopclass community'),
    author_url: 'https://github.com/mindstellar/shopclass-i18n',
    date_format: flag('date-format', 'd/m/Y'),
}, null, 4) + '\n');

// Email templates start as the English set so the locale is installable at once;
// translators overwrite the strings, never the {PLACEHOLDER} tokens.
await writeFile(`${dir}/mail.json`, (await readFile('src/templates/mail.json', 'utf8'))
    .replace(/"language"\s*:\s*"[^"]+"/, `"language": "${locale}"`));

for (const d of DOMAINS) {
    const tpl = await readPo(`src/templates/${d}.pot`);
    const { catalogue } = merge(tpl, { headers: { language: locale }, translations: {} });
    catalogue.headers.language = locale;
    await writeCatalogue(dir, d, catalogue);
}

console.log(`  created ${dir}`);
console.log('  next: check locale.json (direction, date_format, currency_format), then npm run check');
