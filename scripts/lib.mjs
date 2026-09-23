import gettextParser from 'gettext-parser';
import { readFile, writeFile } from 'node:fs/promises';

export const DOMAINS = ['core', 'messages', 'theme'];

/**
 * Read a catalogue, trusting the bytes over the header.
 *
 * Every theme.po inherited from the Osclass project declares iso-8859-1 while
 * holding UTF-8, and theme.pot still carries the unfilled "charset=CHARSET"
 * placeholder. gettext-parser believes the header, so "però" comes back as
 * "perÃ²" and is written out that way -- corruption that looks like a successful
 * merge and only shows up as mojibake on someone's site.
 */
export async function readPo(path) {
    const raw = await readFile(path);
    return gettextParser.po.parse(withUtf8Header(raw), 'utf-8');
}

/** Rewrite a catalogue's declared charset to UTF-8, which is what these files are. */
export function withUtf8Header(buf) {
    // Only the header block, so a msgstr that happens to contain the word is untouched.
    const head = buf.subarray(0, Math.min(buf.length, 2048)).toString('latin1');
    const fixed = head.replace(/charset=[A-Za-z0-9_-]+/i, 'charset=utf-8');
    if (fixed === head) {
        return buf;
    }
    return Buffer.concat([Buffer.from(fixed, 'latin1'), buf.subarray(Math.min(buf.length, 2048))]);
}

/**
 * Carry existing translations onto a new template.
 *
 * The template decides which strings exist; the old catalogue only supplies text.
 * A msgid the template no longer has is dropped rather than kept as an obsolete
 * entry -- Crowdin owns the history, so a stale msgstr here is only noise.
 */
export function merge(template, existing, { pluralForms } = {}) {
    const kept = pickHeaders(existing.headers);
    // scripts/plural-forms.json is the authority when the caller passes it; the old
    // catalogue's own header is the fallback, never the template's generic two-form one.
    if (pluralForms) kept['Plural-Forms'] = pluralForms;

    // Kept values go where the template has that header, so the order -- and with it
    // every unchanged catalogue's bytes -- stays as it was; a moved header line would
    // rewrite all 32 locales and bump their versions for nothing.
    const headers = {};
    for (const [k, v] of Object.entries(template.headers || {})) {
        const c = canonical(k);
        if (c in kept) headers[c] = kept[c];
        else headers[k] = v;
    }
    Object.assign(headers, kept, {
        // Written explicitly: the template this came from may still carry the
        // unfilled CHARSET placeholder.
        'Content-Type': 'text/plain; charset=UTF-8',
    });
    delete headers['content-type'];

    const out = { charset: 'utf-8', headers, translations: {} };
    const forms = nplurals(headers['Plural-Forms']);

    let total = 0, carried = 0;
    for (const [ctx, entries] of Object.entries(template.translations)) {
        out.translations[ctx] = {};
        for (const [msgid, entry] of Object.entries(entries)) {
            if (msgid === '' && ctx === '') { out.translations[ctx][msgid] = entry; continue; }
            total++;
            const prior = existing.translations?.[ctx]?.[msgid];
            const has = prior && prior.msgstr?.some((s) => s !== '');
            if (has) carried++;
            let msgstr = has ? [...prior.msgstr] : entry.msgstr.map(() => '');
            // A plural entry holds exactly as many forms as this locale declares. The
            // template always offers two, which is wrong for Russian (3) or Japanese (1).
            if (entry.msgid_plural) {
                msgstr = msgstr.slice(0, forms);
                while (msgstr.length < forms) msgstr.push('');
            }
            out.translations[ctx][msgid] = { ...entry, msgstr };
        }
    }
    return { catalogue: out, total, carried };
}

/** How many forms a Plural-Forms header declares; two when it declares nothing. */
export function nplurals(header) {
    return Number((/nplurals\s*=\s*(\d+)/.exec(header || '') || [])[1]) || 2;
}

// gettext-parser returns headers in the case the file wrote them ("Plural-Forms"),
// so they are matched case-insensitively. Looking them up in lower case found nothing:
// every re-merge silently replaced a locale's own Language, Last-Translator and
// Plural-Forms with the template's, which went unnoticed only while every locale
// happened to carry the template's two-form rule.
const KEEP = { 'language': 'Language', 'plural-forms': 'Plural-Forms', 'last-translator': 'Last-Translator', 'language-team': 'Language-Team' };
const canonical = (k) => KEEP[k.toLowerCase()] || k;

function pickHeaders(h = {}) {
    const keep = {};
    for (const [k, v] of Object.entries(h)) {
        if (KEEP[k.toLowerCase()] && v) keep[KEEP[k.toLowerCase()]] = v;
    }
    return keep;
}

export async function writeCatalogue(dir, domain, catalogue) {
    await writeFile(`${dir}/${domain}.po`, gettextParser.po.compile(catalogue));
    await writeFile(`${dir}/${domain}.mo`, gettextParser.mo.compile(catalogue));
}

/** Tags that carry no closing partner, so an unmatched one is not a defect. */
const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source']);
const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+))?)*)\s*(\/?)>/;

/**
 * Find the HTML in a mail body that a mail client will not render as written.
 *
 * These bodies are translated as plain text, so a tag can lose its ">" and
 * swallow the sentence after it ("</a के बारे में ... >"), or gain a space
 * ("</ p>") and never close its paragraph. Both survive a diff and a JSON parse
 * and only show up in a sent mail, which nobody reads twice.
 *
 * Only well-formedness is judged. Which tags a translator uses, and how many,
 * is their choice -- a body that is valid but shaped unlike the source is fine.
 *
 * Returns a list of { code, detail }; code is stable enough to compare two
 * bodies by, detail quotes the text so a human can find it.
 */
export function htmlProblems(html) {
    const problems = [];
    const open = [];
    const quote = (i) => JSON.stringify(String(html).slice(i, i + 28));
    const text = String(html);

    for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
        const m = TAG.exec(text.slice(i));
        if (!m) {
            problems.push({ code: 'malformed', detail: `malformed tag at ${quote(i)}` });
            continue;
        }
        const [, closing, written, , selfClosing] = m;
        const name = written.toLowerCase();
        if (selfClosing || VOID_TAGS.has(name)) continue;
        if (!closing) { open.push(name); continue; }
        if (open[open.length - 1] === name) { open.pop(); continue; }
        if (!open.includes(name)) {
            problems.push({ code: `stray:${name}`, detail: `stray </${written}> at ${quote(i)}` });
            continue;
        }
        // A closer for something further down the stack leaves everything above it open.
        while (open[open.length - 1] !== name) {
            const lost = open.pop();
            problems.push({ code: `unclosed:${lost}`, detail: `<${lost}> is never closed` });
        }
        open.pop();
    }
    for (const name of open.reverse()) {
        problems.push({ code: `unclosed:${name}`, detail: `<${name}> is never closed` });
    }
    return problems;
}
