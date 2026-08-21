/**
 * What makes a locale shippable.
 *
 * A pack can be missing locale.json and still look fine in a listing -- but the
 * installer reads that file to write t_locale, so without it the locale cannot be
 * installed at all. Likewise a mail template that has lost a {PLACEHOLDER} sends a
 * mail with a dead link and says nothing. Both fail silently, so they are checked.
 *
 * Usage: npm run check
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const TRANS = 'src/translations';
const REQUIRED = ['locale.json', 'mail.json', 'core.po', 'messages.po', 'theme.po'];

const srcMail = JSON.parse(await readFile('src/templates/mail.json', 'utf8'));
const wanted = new Map(srcMail.template.map((t) => [t.fk_i_page_id, t]));
const tokens = (s) => new Set((String(s).match(/{[A-Z_]+}/g) || []));

// Structural problems make a locale uninstallable, so they fail the build. A lost
// placeholder is a defect too, but it is someone's translation choice to correct --
// reported, not overridden, and never silently rewritten here.
let failures = 0, warnings = 0;
const fail = (locale, msg) => { console.log(`  FAIL ${locale}: ${msg}`); failures++; };
const warn = (locale, msg) => { console.log(`  WARN ${locale}: ${msg}`); warnings++; };

const locales = (await readdir(TRANS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();

for (const locale of locales) {
    const dir = `${TRANS}/${locale}`;

    for (const f of REQUIRED) {
        if (!existsSync(`${dir}/${f}`)) fail(locale, `missing ${f}`);
    }
    if (!existsSync(`${dir}/locale.json`)) continue;

    let meta;
    try { meta = JSON.parse(await readFile(`${dir}/locale.json`, 'utf8')); }
    catch (e) { fail(locale, `locale.json is not valid JSON`); continue; }

    if (meta.locale_code !== locale) {
        fail(locale, `locale.json says locale_code "${meta.locale_code}"`);
    }
    for (const k of ['name', 'short_name', 'direction', 'date_format', 'currency_format']) {
        if (!meta[k]) fail(locale, `locale.json missing ${k}`);
    }
    if (meta.direction && !['ltr', 'rtl'].includes(meta.direction)) {
        fail(locale, `direction "${meta.direction}" is not ltr or rtl`);
    }

    // UTF-8 read as Latin-1 leaves a recognisable trail. It is worth failing on:
    // the file still parses, still merges, and only shows up as mojibake on someone
    // else's site -- which is how "fur" reached German users as "fÃ¼r" for years.
    for (const domain of ['core', 'messages', 'theme']) {
        const po = `${dir}/${domain}.po`;
        if (!existsSync(po)) continue;
        const text = await readFile(po, 'utf8');
        const hits = text.match(/[\u00c3\u00c2][\u0080-\u00bf]/g);
        if (hits) {
            fail(locale, `${domain}.po looks mis-encoded (${hits.length} sequences, e.g. "${hits[0]}")`);
        }
    }

    if (!existsSync(`${dir}/mail.json`)) continue;
    let mail;
    try { mail = JSON.parse(await readFile(`${dir}/mail.json`, 'utf8')); }
    catch { fail(locale, 'mail.json is not valid JSON'); continue; }

    if (mail.language !== locale) fail(locale, `mail.json language is "${mail.language}"`);
    const got = new Map((mail.template || []).map((t) => [t.fk_i_page_id, t]));

    for (const [id, src] of wanted) {
        const t = got.get(id);
        if (!t) { fail(locale, `mail.json missing template ${id} (${src.s_internal_name})`); continue; }
        // A translator may reword freely but must not drop a placeholder: the mailer
        // substitutes these, and a missing one ships as literal text or a dead link.
        for (const tok of tokens(src.s_title)) {
            if (!tokens(t.s_title).has(tok)) warn(locale, `template ${id} title lost ${tok}`);
        }
        for (const tok of tokens(src.s_description)) {
            if (!tokens(t.s_description).has(tok)) warn(locale, `template ${id} body lost ${tok}`);
        }
    }
}

const summary = `${locales.length} locales checked`;
console.log(failures
    ? `\n${summary}: ${failures} blocking, ${warnings} to review`
    : `\nOK: ${summary}, ${warnings} placeholder(s) to review`);
process.exit(failures ? 1 : 0);
