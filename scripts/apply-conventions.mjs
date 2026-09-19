/**
 * Bring every locale.json in line with scripts/locale-conventions.json, every
 * catalogue header in line with scripts/plural-forms.json, and every mail.json's
 * language field in line with the folder it sits in.
 *
 * Only the display conventions are touched -- name, author and version are the
 * maintainer's or the translator's. Run after editing either file.
 *
 * Usage: node scripts/apply-conventions.mjs [--dry]
 *        node scripts/apply-conventions.mjs --adopt <locale> ...
 *
 * --adopt goes the other way: it takes what a locale.json says now and writes that
 * into scripts/locale-conventions.json. A translator who corrects their date format
 * would otherwise see it overwritten on the next run -- the conventions file is what
 * decides, so a correction has to land there to survive. npm run check reports the
 * disagreement while it lasts.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DOMAINS, readPo, writeCatalogue } from './lib.mjs';

const TRANS = 'src/translations';
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const adoptIdx = argv.indexOf('--adopt');
const adopt = adoptIdx > -1 ? argv.slice(adoptIdx + 1).filter((a) => !a.startsWith('--')) : null;
const KEYS = ['short_name', 'direction', 'date_format', 'currency_format'];
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

/**
 * mail.json carries the locale code of the folder it is in, and Shopclass refuses a
 * pack where the two disagree. It is not prose, so it is set here rather than left to
 * a translator: in Crowdin the field is hidden, and a locale added later would
 * otherwise arrive carrying en_US.
 */
async function applyMailLanguage(locale) {
    const path = `${TRANS}/${locale}/mail.json`;
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    const mail = JSON.parse(raw);
    if (mail.language === locale) return null;
    const was = mail.language;
    mail.language = locale;
    if (!dry) await writeFile(path, JSON.stringify(mail, null, 4) + '\n');
    return `mail.json language: ${JSON.stringify(was)} -> ${JSON.stringify(locale)}`;
}

if (adopt) {
    if (!adopt.length) { console.error('usage: --adopt <locale> [locale ...]'); process.exit(2); }
    let taken = 0;
    for (const locale of adopt) {
        const path = `${TRANS}/${locale}/locale.json`;
        if (!existsSync(path)) { console.log(`  ${locale}: no locale.json`); continue; }
        const cur = JSON.parse(await readFile(path, 'utf8'));
        const want = (conv[locale] ??= {});
        const diffs = [];
        for (const key of KEYS) {
            if (cur[key] !== undefined && cur[key] !== want[key]) {
                diffs.push(`${key}: ${JSON.stringify(want[key])} -> ${JSON.stringify(cur[key])}`);
                want[key] = cur[key];
            }
        }
        if (!diffs.length) { console.log(`  ${locale}: already matches the conventions`); continue; }
        taken++;
        console.log(`  ${locale}`);
        for (const d of diffs) console.log(`      ${d}`);
    }
    if (!dry && taken) await writeFile('scripts/locale-conventions.json', JSON.stringify(conv, null, 4) + '\n');
    console.log(dry ? `\n${taken} locale(s) would be adopted` : `\n${taken} locale(s) adopted into scripts/locale-conventions.json`);
    process.exit(0);
}

let changed = 0;
for (const locale of locales) {
    let named = false;
    const name = () => { if (!named) { console.log(`  ${locale}`); named = true; changed++; } };

    const pluralNotes = await applyPlurals(locale);
    if (pluralNotes) {
        name();
        for (const n of pluralNotes) console.log(`      ${n}`);
    }

    const mailNote = await applyMailLanguage(locale);
    if (mailNote) { name(); console.log(`      ${mailNote}`); }

    const want = conv[locale];
    if (!want) { console.log(`  ${locale}: no conventions recorded, left alone`); continue; }

    const path = `${TRANS}/${locale}/locale.json`;
    const cur = JSON.parse(await readFile(path, 'utf8'));
    const diffs = [];
    for (const key of KEYS) {
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
