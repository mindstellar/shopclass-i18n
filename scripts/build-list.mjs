/**
 * locale_list.json is what core fetches to offer a language at install time and in
 * Settings -> Languages, so it has to describe every locale actually present here.
 *
 * Usage: node scripts/build-list.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
const TRANS = 'src/translations';
const dirs = (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
// An array of locale objects, the shape core has always parsed: it reads each
// entry's locale_code rather than the key it is filed under.
const out = [];
for (const d of dirs) {
    out.push(JSON.parse(await readFile(`${TRANS}/${d}/locale.json`, 'utf8')));
}
await writeFile('locale_list.json', JSON.stringify(out, null, 4) + '\n');
console.log(`  locale_list.json: ${dirs.length} locales`);
