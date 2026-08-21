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
import { DOMAINS, readPo, merge, writeCatalogue } from './lib.mjs';

const TPL = 'src/templates';
const TRANS = 'src/translations';

const only = process.argv.slice(2);
const locales = (only.length ? only : (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name)).sort();

const templates = {};
for (const d of DOMAINS) {
    const p = `${TPL}/${d}.pot`;
    if (existsSync(p)) templates[d] = await readPo(p);
}

console.log(`templates: ${Object.keys(templates).join(', ')}`);
let width = Math.max(...locales.map((l) => l.length));

for (const locale of locales) {
    const dir = `${TRANS}/${locale}`;
    const parts = [];
    for (const d of DOMAINS) {
        if (!templates[d]) continue;
        const po = `${dir}/${d}.po`;
        const existing = existsSync(po) ? await readPo(po) : { headers: {}, translations: {} };
        const { catalogue, total, carried } = merge(templates[d], existing);
        await writeCatalogue(dir, d, catalogue);
        const pct = total ? Math.round((carried / total) * 100) : 0;
        parts.push(`${d} ${String(pct).padStart(3)}% (${carried}/${total})`);
    }
    console.log(`  ${locale.padEnd(width)}  ${parts.join('   ')}`);
}
