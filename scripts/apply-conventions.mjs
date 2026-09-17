/**
 * Bring every locale.json in line with scripts/locale-conventions.json, and every
 * catalogue header in line with scripts/plural-forms.json.
 *
 * Only the display conventions are touched -- name, author and version are the
 * maintainer's or the translator's. Run after editing either file.
 *
 * Usage: node scripts/apply-conventions.mjs [--dry]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DOMAINS, readPo, writeCatalogue } from './lib.mjs';

const TRANS = 'src/translations';
const dry = process.argv.includes('--dry');
const conv = JSON.parse(await readFile('scripts/locale-conventions.json', 'utf8'));
const plurals = JSON.parse(await readFile('scripts/plural-forms.json', 'utf8'));

/** How many forms a header asks for. */
const npluralsOf = (header) => Number((/nplurals\s*=\s*(\d+)/.exec(header) || [])[1]) || 2;

/**
 * Put the right Plural-Forms header on a catalogue and resize its entries.
 *
 * A plural entry can only hold as many translations as the header declares, so a
 * Russian catalogue running on "nplurals=2" has nowhere to put the third form --
 * the translation is not wrong, it is unwritable. Resizing keeps whatever forms
 * exist and leaves the new slots empty for a translator to fill.
 */
async function applyPlurals(locale) {
    const want = plurals[locale];
    if (!want) return null;
    const n = npluralsOf(want);
    const notes = [];

    for (const domain of DOMAINS) {
        const po = `${TRANS}/${locale}/${domain}.po`;
        if (!existsSync(po)) continue;
        const cat = await readPo(po);
        const had = cat.headers['plural-forms'] || cat.headers['Plural-Forms'] || '(none)';
        let resized = 0;
        for (const group of Object.values(cat.translations)) {
            for (const [msgid, e] of Object.entries(group)) {
                if (!msgid || !e.msgid_plural) continue;
                if (e.msgstr.length === n) continue;
                const forms = e.msgstr.slice(0, n);
                while (forms.length < n) forms.push('');
                e.msgstr = forms;
                resized++;
            }
        }
        if (had === want && !resized) continue;
        delete cat.headers['Plural-Forms'];
        cat.headers['plural-forms'] = want;
        notes.push(`${domain}: ${had === want ? 'header ok' : `header -> ${n} forms`}${resized ? `, ${resized} entries resized` : ''}`);
        if (!dry) await writeCatalogue(`${TRANS}/${locale}`, domain, cat);
    }
    return notes.length ? notes : null;
}

const locales = (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();

let changed = 0;
for (const locale of locales) {
    let named = false;
    const name = () => { if (!named) { console.log(`  ${locale}`); named = true; changed++; } };

    const pluralNotes = await applyPlurals(locale);
    if (pluralNotes) {
        name();
        for (const n of pluralNotes) console.log(`      ${n}`);
    }

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
    name();
    for (const d of diffs) console.log(`      ${d}`);
    if (!dry) await writeFile(path, JSON.stringify(cur, null, 4) + '\n');
}
console.log(dry ? `\n${changed} locale(s) would change` : `\n${changed} locale(s) updated`);
