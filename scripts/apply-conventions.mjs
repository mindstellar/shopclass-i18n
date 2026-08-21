/**
 * Bring every locale.json in line with scripts/locale-conventions.json.
 *
 * Only the display conventions are touched -- name, author and version are the
 * maintainer's or the translator's. Run after editing the conventions file.
 *
 * Usage: node scripts/apply-conventions.mjs [--dry]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';

const TRANS = 'src/translations';
const dry = process.argv.includes('--dry');
const conv = JSON.parse(await readFile('scripts/locale-conventions.json', 'utf8'));

const locales = (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();

let changed = 0;
for (const locale of locales) {
    const want = conv[locale];
    if (!want) { console.log(`  ${locale}: no conventions recorded, left alone`); continue; }

    const path = `${TRANS}/${locale}/locale.json`;
    const cur = JSON.parse(await readFile(path, 'utf8'));
    const diffs = [];
    for (const key of ['short_name', 'direction', 'date_format', 'currency_format']) {
        if (cur[key] !== want[key]) {
            diffs.push(`${key}: ${JSON.stringify(cur[key])} -> ${JSON.stringify(want[key])}`);
            cur[key] = want[key];
        }
    }
    if (!diffs.length) continue;
    changed++;
    console.log(`  ${locale}`);
    for (const d of diffs) console.log(`      ${d}`);
    if (!dry) await writeFile(path, JSON.stringify(cur, null, 4) + '\n');
}
console.log(dry ? `\n${changed} locale(s) would change` : `\n${changed} locale(s) updated`);
