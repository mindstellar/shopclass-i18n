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

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const sinceIdx = argv.indexOf('--since');
const since = sinceIdx > -1 ? argv[sinceIdx + 1] : 'HEAD';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

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

for (const locale of [...changed].sort()) {
    const path = `src/translations/${locale}/locale.json`;
    let meta;
    try { meta = JSON.parse(await readFile(path, 'utf8')); }
    catch { console.log(`  ${locale}: no readable locale.json, skipped`); continue; }

    const parts = String(meta.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    parts[2]++;
    const next = parts.join('.');
    console.log(`  ${locale}: ${meta.version} -> ${next}`);
    meta.version = next;
    if (!dry) await writeFile(path, JSON.stringify(meta, null, 4) + '\n');
}
console.log(dry ? `\n${changed.size} locale(s) would bump` : `\n${changed.size} locale(s) bumped`);
