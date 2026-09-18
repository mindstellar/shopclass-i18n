/**
 * What a change does to the translations already here.
 *
 * A pull request that empties translations looks like an ordinary catalogue update:
 * the files parse, `npm run check` passes, and the strings simply fall back to English
 * on every site. Crowdin's first pull request here emptied 1,746 of them -- every one a
 * translation that happened to match the English source, which Crowdin had never stored
 * because the upload did not pass --import-eq-suggestions.
 *
 * Only strings the change keeps are compared: a msgid the templates dropped is not a
 * loss, it is gone. Likewise a locale that is added or removed whole.
 *
 * Usage: node scripts/diff-translations.mjs <before ref> [after ref]   (after: working tree)
 *        --max-blanked N   how many emptied strings to tolerate (default 25)
 *        --json            machine-readable summary
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import gettextParser from 'gettext-parser';
import { DOMAINS, readPo, withUtf8Header } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
const MAX_BLANKED = Number(flag('--max-blanked', '25'));
const asJson = argv.includes('--json');
const refs = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--max-blanked');
const BEFORE = refs[0];
const AFTER = refs[1] || null;
if (!BEFORE) { console.error('usage: node scripts/diff-translations.mjs <before ref> [after ref]'); process.exit(2); }

const show = (ref, path) => {
    try { return execFileSync('git', ['show', `${ref}:${path}`], { maxBuffer: 256 << 20 }); }
    catch { return null; }
};

async function load(ref, path) {
    if (!ref) return existsSync(path) ? readPo(path) : null;
    const raw = show(ref, path);
    return raw ? gettextParser.po.parse(withUtf8Header(raw), 'utf-8') : null;
}

const filled = (e) => (e?.msgstr || []).some((s) => s !== '');

const locales = readdirSync("src/translations")
    .filter((l) => !l.startsWith('en_'));

const report = { blanked: [], formsLost: [], added: 0, changed: 0, ruleChanged: new Set() };

for (const locale of locales) {
    for (const domain of DOMAINS) {
        const path = `src/translations/${locale}/${domain}.po`;
        const before = await load(BEFORE, path);
        const after = await load(AFTER, path);
        // A locale or domain that only one side has is not a loss of translation.
        if (!before || !after) continue;

        // When the plural rule itself changes, the slots stop meaning what they meant:
        // Russian went from two forms to four, so form 1 moved. Comparing them by
        // position would read every rewritten entry as a loss.
        const rule = (c) => Object.entries(c.headers || {})
            .find(([k]) => k.toLowerCase() === 'plural-forms')?.[1] || '';
        const sameRule = rule(before) === rule(after);
        if (!sameRule) report.ruleChanged.add(locale);

        for (const [ctx, group] of Object.entries(after.translations)) {
            for (const [msgid, now] of Object.entries(group)) {
                if (!msgid) continue;
                const was = before.translations?.[ctx]?.[msgid];
                if (!was) { if (filled(now)) report.added++; continue; }

                if (filled(was) && !filled(now)) {
                    report.blanked.push(`${locale}/${domain}: ${JSON.stringify(msgid).slice(0, 60)}`);
                    continue;
                }
                if (!filled(was) && filled(now)) { report.added++; continue; }
                if (!filled(was)) continue;

                // A plural entry that keeps some forms and loses others renders an empty
                // string for the counts that hit the lost form -- not even English.
                const lost = (was.msgstr || []).filter((s, i) => s !== '' && !(now.msgstr || [])[i]);
                // Same rule, same number of slots, and a slot that had text now empty:
                // that is a loss. A resized entry is the rule moving, not a loss.
                const resized = (was.msgstr || []).length !== (now.msgstr || []).length;
                if (now.msgid_plural && lost.length && sameRule && !resized) {
                    report.formsLost.push(`${locale}/${domain}: ${JSON.stringify(msgid).slice(0, 50)} lost ${lost.length} form(s)`);
                } else if ((was.msgstr || []).join('') !== (now.msgstr || []).join('')) {
                    report.changed++;
                }
            }
        }
    }
}

if (asJson) {
    console.log(JSON.stringify({
        blanked: report.blanked.length, formsLost: report.formsLost.length,
        added: report.added, changed: report.changed,
        ruleChanged: [...report.ruleChanged],
    }));
} else {
    console.log(`added ${report.added} · changed ${report.changed} · blanked ${report.blanked.length} · plural forms lost ${report.formsLost.length}`);
    if (report.ruleChanged.size) {
        console.log(`  plural rule changed, forms not compared: ${[...report.ruleChanged].join(', ')}`);
    }
    for (const line of report.blanked.slice(0, 15)) console.log(`  blanked  ${line}`);
    if (report.blanked.length > 15) console.log(`  … and ${report.blanked.length - 15} more`);
    for (const line of report.formsLost.slice(0, 15)) console.log(`  form     ${line}`);
    if (report.formsLost.length > 15) console.log(`  … and ${report.formsLost.length - 15} more`);
}

// A translator clearing a handful of bad strings is ordinary work; a wipe is not, and a
// half-empty plural entry is never intended.
const bad = report.blanked.length > MAX_BLANKED || report.formsLost.length > 0;
process.exit(bad ? 1 : 0);
