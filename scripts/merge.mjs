/**
 * Re-merge every locale against the current templates.
 *
 * Run after templates change. Existing translations survive where the string
 * still exists; new strings arrive untranslated for Crowdin to pick up.
 *
 * Usage: npm run merge [-- locale ...]
 */
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DOMAINS, readPo, merge, mergeMail, writeCatalogue, writeMail } from './lib.mjs';

const TPL = 'src/templates';
const TRANS = 'src/translations';
// Each locale's plural rule; without it a re-merge would hand every locale the
// template's two-form rule and npm run check would refuse the result.
const plurals = JSON.parse(await readFile('scripts/plural-forms.json', 'utf8'));

const only = process.argv.slice(2);
const locales = (only.length ? only : (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name)).sort();

const templates = {};
for (const d of DOMAINS) {
    const p = `${TPL}/${d}.pot`;
    if (existsSync(p)) templates[d] = await readPo(p);
}

// The mail templates travel with the catalogues: a locale that keeps one the source
// dropped sends Crowdin a file out of step with its own, and one that never receives
// a new template fails npm run check until somebody notices.
const mailTemplate = existsSync(`${TPL}/mail.json`)
    ? JSON.parse(await readFile(`${TPL}/mail.json`, 'utf8'))
    : null;

console.log(`templates: ${[...Object.keys(templates), mailTemplate && 'mail'].filter(Boolean).join(', ')}`);
let width = Math.max(...locales.map((l) => l.length));

for (const locale of locales) {
    const dir = `${TRANS}/${locale}`;
    const parts = [];
    for (const d of DOMAINS) {
        if (!templates[d]) continue;
        const po = `${dir}/${d}.po`;
        const existing = existsSync(po) ? await readPo(po) : { headers: {}, translations: {} };
        const { catalogue, total, carried } = merge(templates[d], existing, { pluralForms: plurals[locale] });
        await writeCatalogue(dir, d, catalogue);
        const pct = total ? Math.round((carried / total) * 100) : 0;
        parts.push(`${d} ${String(pct).padStart(3)}% (${carried}/${total})`);
    }
    if (mailTemplate) {
        const p = `${dir}/mail.json`;
        const existing = existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null;
        const { mail, total, carried } = mergeMail(mailTemplate, existing, locale);
        await writeMail(dir, mail);
        const pct = total ? Math.round((carried / total) * 100) : 0;
        parts.push(`mail ${String(pct).padStart(3)}% (${carried}/${total})`);
    }
    console.log(`  ${locale.padEnd(width)}  ${parts.join('   ')}`);
}
