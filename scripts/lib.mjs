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
export function merge(template, existing) {
    const out = {
        charset: 'utf-8',
        headers: {
            ...template.headers,
            ...pickHeaders(existing.headers),
            // Written explicitly: the template this came from may still carry the
            // unfilled CHARSET placeholder.
            'content-type': 'text/plain; charset=UTF-8',
        },
        translations: {},
    };

    let total = 0, carried = 0;
    for (const [ctx, entries] of Object.entries(template.translations)) {
        out.translations[ctx] = {};
        for (const [msgid, entry] of Object.entries(entries)) {
            if (msgid === '' && ctx === '') { out.translations[ctx][msgid] = entry; continue; }
            total++;
            const prior = existing.translations?.[ctx]?.[msgid];
            const has = prior && prior.msgstr?.some((s) => s !== '');
            if (has) carried++;
            out.translations[ctx][msgid] = {
                ...entry,
                msgstr: has ? [...prior.msgstr] : entry.msgstr.map(() => ''),
            };
        }
    }
    return { catalogue: out, total, carried };
}

function pickHeaders(h = {}) {
    const keep = {};
    for (const k of ['language', 'plural-forms', 'last-translator', 'language-team']) {
        if (h[k]) keep[k] = h[k];
    }
    return keep;
}

export async function writeCatalogue(dir, domain, catalogue) {
    await writeFile(`${dir}/${domain}.po`, gettextParser.po.compile(catalogue));
    await writeFile(`${dir}/${domain}.mo`, gettextParser.mo.compile(catalogue));
}
