import gettextParser from 'gettext-parser';
import { readFile, writeFile } from 'node:fs/promises';

export const DOMAINS = ['core', 'messages', 'theme'];

export async function readPo(path) {
    return gettextParser.po.parse(await readFile(path));
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
        headers: { ...template.headers, ...pickHeaders(existing.headers) },
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
