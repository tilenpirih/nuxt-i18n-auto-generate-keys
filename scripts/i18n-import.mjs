#!/usr/bin/env node
// i18n-import — apply the values edited in exported_keys/<locale>.json back to
// their real homes: per-component <i18n> blocks and the shared public catalog.
//
// It rebuilds each flat key from the live source the exact same way
// `i18n-export` did and matches by equality, so every value lands exactly where
// it came from — no guessing how a `-` splits.
//
// By default only TRANSLATED values are applied: anything still empty or
// carrying the TODO_TRANSLATION placeholder is skipped, so you can export the
// untranslated set, fill in only what you finished, and import just those.
//
// Usage:
//   node scripts/i18n-import.mjs           apply translated values, all locales
//   node scripts/i18n-import.mjs sl        only sl.json
//   node scripts/i18n-import.mjs --all     apply every value, incl. TODO/empty
//   node scripts/i18n-import.mjs --dry-run show what would change, write nothing
//
// Keys present in exported_keys/ but unknown to the source are reported and
// skipped (delete a key only by removing its usage + re-running i18n-extract).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collect, EXPORT_DIR, isTranslated, localeCodes, LOCALES_DIR, readJson, replaceBlock, ROOT, serializeCatalog } from './i18n-keys.mjs';

const args = process.argv.slice(2);
const applyAll = args.includes('--all') || args.includes('--force');
const dryRun = args.includes('--dry-run') || args.includes('--dry');
const wanted = args.filter(a => !a.startsWith('--'));
const codes = wanted.length ? localeCodes.filter(c => wanted.includes(c)) : localeCodes;

if (wanted.length && codes.length === 0) {
    console.error(`No known locale in [${wanted.join(', ')}]. Known: ${localeCodes.join(', ')}`);
    process.exit(1);
}

const { blocks, catalog, targets } = collect();
const blockByFile = new Map(blocks.map(b => [b.file, b]));

let applied = 0;
let skippedTodo = 0;
let unknown = 0;
const touchedBlocks = new Set();
const touchedCatalog = new Set();

for (const code of codes) {
    const file = join(EXPORT_DIR, `${code}.json`);
    if (!existsSync(file)) {
        console.log(`  skip    exported_keys/${code}.json  (not found — export it first)`);
        continue;
    }
    const edited = readJson(file);
    for (const [fk, value] of Object.entries(edited)) {
        const target = targets.get(fk);
        if (!target) {
            console.warn(`  WARN    unknown key "${fk}" in ${code}.json — skipped`);
            unknown++;
            continue;
        }
        if (!applyAll && !isTranslated(value)) {
            skippedTodo++;
            continue;
        }
        if (target.kind === 'block') {
            const block = blockByFile.get(target.file);
            (block.messages[code] ??= {})[target.innerKey] = value;
            touchedBlocks.add(target.file);
        } else {
            (catalog[code] ??= {})[target.innerKey] = value;
            touchedCatalog.add(code);
        }
        applied++;
    }
}

// --- write back -----------------------------------------------------------
let changedFiles = 0;

for (const file of touchedBlocks) {
    const block = blockByFile.get(file);
    const original = readFileSync(file, 'utf8');
    const next = replaceBlock(original, block.messages);
    const rel = relative(ROOT, file);
    if (next === original) {
        console.log(`  ok      ${rel}`);
        continue;
    }
    if (!dryRun) writeFileSync(file, next);
    changedFiles++;
    console.log(`  ${(dryRun ? 'would' : 'updated').padEnd(7)} ${rel}`);
}

for (const code of touchedCatalog) {
    const file = join(LOCALES_DIR, `${code}.json`);
    const original = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const next = serializeCatalog(catalog[code]);
    const rel = relative(ROOT, file);
    if (next === original) {
        console.log(`  ok      ${rel}`);
        continue;
    }
    if (!dryRun) writeFileSync(file, next);
    changedFiles++;
    console.log(`  ${(dryRun ? 'would' : 'updated').padEnd(7)} ${rel}`);
}

console.log(
    `\n${dryRun ? 'Dry run' : 'Done'} — applied ${applied} value(s), `
    + `${changedFiles} file(s) ${dryRun ? 'would change' : 'changed'}`
    + `${skippedTodo ? `, skipped ${skippedTodo} untranslated` : ''}`
    + `${unknown ? `, ${unknown} unknown` : ''}`
    + `${applyAll ? '' : ' (use --all to apply untranslated values too)'}.`,
);
