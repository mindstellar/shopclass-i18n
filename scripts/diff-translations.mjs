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
 * The mail templates are compared the same way, and for the same reason. Crowdin
 * writes each entry's fk_i_page_id from the file already on its own branch and takes
 * only the length from the source, so one file out of step costs a whole template:
 * #59 and #60 both deleted email_warn_expiration from 30 locales and handed its body
 * to email_new_admin. Nothing caught either one -- the files parsed, no .po string was
 * emptied, and this script did not read mail.json at all.
 *
 * A format specifier is checked the same way. "%%" means one literal percent and takes
 * no argument; machine translation rewrote it as a single "% " in four locales, which
 * sprintf reads as a conversion and PHP 8 answers with a fatal ArgumentCountError --
 * visible only to that locale's users. Only newly broken strings count: nine were
 * already here, written by hand, before anything checked.
 *
 * Usage: node scripts/diff-translations.mjs <before ref> [after ref]   (after: working tree)
 *        --max-blanked N   how many emptied strings to tolerate (default 25)
 *        --json            machine-readable summary
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import gettextParser from 'gettext-parser';
import { DOMAINS, placeholderProblems, readPo, withUtf8Header } from './lib.mjs';

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

const report = {
    blanked: [], formsLost: [], added: 0, changed: 0, ruleChanged: new Set(),
    mailLost: [], mailStale: [], placeholders: [],
};

const mailOf = (ref, path) => {
    const raw = ref ? show(ref, path) : (existsSync(path) ? execFileSync('cat', [path]) : null);
    if (!raw) return null;
    try { return new Map(JSON.parse(raw).template.map((t) => [t.fk_i_page_id, t])); }
    catch { return null; }
};

// Which mail templates the source knows about, and so what counts as a loss: one the
// source dropped is gone, not lost, and one it still has must survive.
//
// Both sides count. A Crowdin branch never updates src/templates, so judging by its
// copy alone would read every template added since the branch opened as one the source
// had dropped -- #60 carried email_listing_unpaid_reminder and would have been accused
// of taking it back.
const mailSource = (() => {
    const path = 'src/templates/mail.json';
    const ids = new Set();
    for (const ref of [BEFORE, AFTER]) {
        for (const id of mailOf(ref, path)?.keys() || []) ids.add(id);
    }
    return ids.size ? ids : null;
})();

for (const locale of mailSource ? locales : []) {
    const path = `src/translations/${locale}/mail.json`;
    const before = mailOf(BEFORE, path);
    const after = mailOf(AFTER, path);
    if (!before || !after) continue;

    for (const [id, entry] of before) {
        if (after.has(id) || !mailSource.has(id)) continue;
        report.mailLost.push(`${locale}: template ${id} (${entry.s_internal_name})`);
    }
    // An entry the source dropped is what puts the rest out of step, so a change that
    // brings one back is named here as well: on its own it reads as harmless padding,
    // and one export later it is a deleted template.
    for (const [id, entry] of after) {
        if (mailSource.has(id) || before.has(id)) continue;
        report.mailStale.push(`${locale}: template ${id} (${entry.s_internal_name}) is back, the source dropped it`);
    }
}

// A translation that asks sprintf for more arguments than its source is a fatal
// ArgumentCountError on PHP 8, in that locale alone. npm run check blocks it, but the
// pull request guard runs on its own, so it is counted here too -- and only when the
// change introduces it, because nine such strings were already in the repo before
// anything looked. Machine translation is what made it urgent: it rewrote "%%" as a
// single "% " in four locales, which sprintf then reads as a conversion.
function checkPlaceholders(locale, domain, msgid, was, now) {
    const sources = now.msgid_plural ? [msgid, now.msgid_plural] : [msgid];
    const fails = (entry) => new Set((entry?.msgstr || []).flatMap((str) => str
        ? placeholderProblems(sources, str).filter((p) => p.severity === 'fail').map((p) => p.code)
        : []));
    const had = fails(was);
    const said = (code) => code === 'lost:%%'
        ? 'dropped a %% escape, so the bare % reads as a conversion'
        : code.startsWith('extra:') ? `gained an extra ${code.slice(6)}` : code;
    for (const code of fails(now)) {
        if (had.has(code)) continue;
        report.placeholders.push(`${locale}/${domain}: ${JSON.stringify(msgid).slice(0, 50)} ${said(code)}`);
    }
}

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
                if (!filled(was) && filled(now)) { report.added++; checkPlaceholders(locale, domain, msgid, was, now); continue; }
                if (!filled(was)) continue;
                checkPlaceholders(locale, domain, msgid, was, now);

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
        mailLost: report.mailLost.length, mailStale: report.mailStale.length,
        placeholders: report.placeholders.length,
    }));
} else {
    console.log(`added ${report.added} · changed ${report.changed} · blanked ${report.blanked.length} · plural forms lost ${report.formsLost.length} · mail templates lost ${report.mailLost.length} · placeholders broken ${report.placeholders.length}`);
    if (report.ruleChanged.size) {
        console.log(`  plural rule changed, forms not compared: ${[...report.ruleChanged].join(', ')}`);
    }
    for (const line of report.blanked.slice(0, 15)) console.log(`  blanked  ${line}`);
    if (report.blanked.length > 15) console.log(`  … and ${report.blanked.length - 15} more`);
    for (const line of report.formsLost.slice(0, 15)) console.log(`  form     ${line}`);
    if (report.formsLost.length > 15) console.log(`  … and ${report.formsLost.length - 15} more`);
    for (const line of report.mailLost.slice(0, 15)) console.log(`  mail     ${line}`);
    if (report.mailLost.length > 15) console.log(`  … and ${report.mailLost.length - 15} more`);
    for (const line of report.mailStale.slice(0, 5)) console.log(`  mail     ${line}`);
    if (report.mailStale.length > 5) console.log(`  … and ${report.mailStale.length - 5} more`);
    for (const line of report.placeholders.slice(0, 15)) console.log(`  format   ${line}`);
    if (report.placeholders.length > 15) console.log(`  … and ${report.placeholders.length - 15} more`);
}

// A translator clearing a handful of bad strings is ordinary work; a wipe is not, and a
// half-empty plural entry is never intended. Neither is losing a mail template the
// source still sends, or taking back one it dropped.
const bad = report.blanked.length > MAX_BLANKED || report.formsLost.length > 0
    || report.mailLost.length > 0 || report.mailStale.length > 0
    || report.placeholders.length > 0;
process.exit(bad ? 1 : 0);
