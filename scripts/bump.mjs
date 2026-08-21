/**
 * Bump the version of every locale whose content changed.
 *
 * Shopclass compares the version in locale.json against the one it installed to
 * decide whether a site is offered an update. A hand-maintained field does not
 * survive contact with a translation workflow -- every locale carried 1.0.2 for
 * years while the translations underneath them changed -- so the bump follows what
 * git says actually changed rather than anyone remembering.
 *
 * Usage: node scripts/bump.mjs [--since <ref>] [--dry]
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import gettextParser from 'gettext-parser';
import { withUtf8Header } from './lib.mjs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sinceIdx = argv.indexOf('--since');
const since = sinceIdx > -1 ? argv[sinceIdx + 1] : 'HEAD';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

/**
 * What a catalogue actually says, ignoring where the strings were found.
 *
 * A .po carries a source reference per entry, so any edit that shifts a line
 * number in Shopclass rewrites all 32 catalogues without a word of translation
 * changing. Bumping on that would tell every site an update is waiting and hand
 * them the same text back.
 */
function meaning(buf) {
    // Same reader as the merge: a header that lies about its charset must not
    // read as a change in what the file says.
    const parsed = gettextParser.po.parse(withUtf8Header(buf), 'utf-8');
    const out = [];
    for (const [ctx, entries] of Object.entries(parsed.translations || {})) {
        for (const [msgid, e] of Object.entries(entries)) {
            out.push(`${ctx}\u0004${msgid}\u0004${(e.msgstr || []).join('\u0001')}`);
        }
    }
    return out.sort().join('\n');
}

/** Whether a locale's translatable content differs from the reference. */
function contentChanged(locale, ref) {
    const files = git('ls-files', `src/translations/${locale}`).split('\n').filter(Boolean);
    for (const f of files) {
        if (f.endsWith('.mo') || f.endsWith('/locale.json')) continue;
        let before;
        try { before = execFileSync('git', ['show', `${ref}:${f}`]); }
        catch { return true; }                       // new file
        let now;
        try { now = execFileSync('cat', [f]); }
        catch { return true; }                       // removed
        if (f.endsWith('.po')) {
            if (meaning(before) !== meaning(now)) return true;
        } else if (!before.equals(now)) {
            return true;
        }
    }
    return false;
}

// Everything that differs from the reference, including files not yet staged.
const changed = new Set();
for (const line of [...git('diff', '--name-only', since).split('\n'),
                    ...git('diff', '--name-only', '--cached', since).split('\n'),
                    ...git('ls-files', '--others', '--exclude-standard').split('\n')]) {
    const m = line.match(/^src\/translations\/([^/]+)\//);
    // locale.json is what this script writes; a version bump is not itself a reason
    // to bump again on the next run.
    if (m && !line.endsWith('/locale.json')) changed.add(m[1]);
}

if (!changed.size) {
    console.log('  no locale content changed');
    process.exit(0);
}

let bumped = 0;
for (const locale of [...changed].sort()) {
    if (!contentChanged(locale, since)) {
        console.log(`  ${locale}: only source references moved, not bumped`);
        continue;
    }
    const path = `src/translations/${locale}/locale.json`;
    let meta;
    try { meta = JSON.parse(await readFile(path, 'utf8')); }
    catch { console.log(`  ${locale}: no readable locale.json, skipped`); continue; }

    // Someone may have bumped by hand in the same push. Bumping again on top would
    // move the version twice for one change, so a version that already differs from
    // the reference is taken as done.
    let priorVersion = null;
    try { priorVersion = JSON.parse(execFileSync('git', ['show', `${since}:${path}`], { encoding: 'utf8' })).version; }
    catch { /* new locale: nothing to compare against */ }
    if (priorVersion && priorVersion !== meta.version) {
        console.log(`  ${locale}: already bumped to ${meta.version} in this change`);
        continue;
    }

    const parts = String(meta.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    parts[2]++;
    const next = parts.join('.');
    console.log(`  ${locale}: ${meta.version} -> ${next}`);
    bumped++;
    meta.version = next;
    if (!dry) await writeFile(path, JSON.stringify(meta, null, 4) + '\n');
}
console.log(dry
    ? `\n${bumped} of ${changed.size} changed locale(s) would bump`
    : `\n${bumped} of ${changed.size} changed locale(s) bumped`);
