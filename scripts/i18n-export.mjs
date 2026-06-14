#!/usr/bin/env node
// i18n-export — flatten every translation key into exported_keys/<locale>.json
// for editing/translation, then `i18n-import` writes the edits back.
//
// Keys are namespaced by where they live, so import knows the way home:
//   "app.components.Greeting-Goodbye"        ← a component <i18n> block
//   "i18n.locales-Translation key in utils"  ← the shared public catalog
//
// Usage:
//   node scripts/i18n-export.mjs                  all keys, all locales
//   node scripts/i18n-export.mjs --untranslated   only keys still needing work
//   node scripts/i18n-export.mjs sl               only the sl.json file
//   node scripts/i18n-export.mjs --untranslated sl   combine both
//
// --untranslated keeps only keys that are missing/empty/TODO in at least one
// non-default locale, and emits them for every locale — so the default-locale
// file gives the translator the source text to work from. Edit the VALUES
// only (never the keys), then run `i18n-import`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collect, defaultLocale, EXPORT_DIR, INDENT, isTranslated, localeCodes, ROOT } from './i18n-keys.mjs';

const args = process.argv.slice(2);
const untranslatedOnly = args.includes('--untranslated') || args.includes('--todo');
const wanted = args.filter(a => !a.startsWith('--'));
const codes = wanted.length ? localeCodes.filter(c => wanted.includes(c)) : localeCodes;

if (wanted.length && codes.length === 0) {
    console.error(`No known locale in [${wanted.join(', ')}]. Known: ${localeCodes.join(', ')}`);
    process.exit(1);
}

const { values } = collect();

// Which flat keys to emit. In --untranslated mode, a key qualifies if any
// non-default locale still needs work; the whole row is then exported so the
// source text travels alongside the gaps.
const allKeys = Object.keys(values[defaultLocale] ?? {});
const keys = (untranslatedOnly
    ? allKeys.filter(k => localeCodes.some(c => c !== defaultLocale && !isTranslated(values[c][k])))
    : allKeys
).sort();

mkdirSync(EXPORT_DIR, { recursive: true });

for (const code of codes) {
    const dict = {};
    for (const k of keys) dict[k] = values[code][k] ?? '';
    const file = join(EXPORT_DIR, `${code}.json`);
    writeFileSync(file, `${JSON.stringify(dict, null, INDENT)}\n`);
    console.log(`  wrote   ${relative(ROOT, file)}  (${keys.length} key${keys.length === 1 ? '' : 's'})`);
}

console.log(
    `\nDone — ${codes.length} file(s), ${keys.length} key(s) each`
    + `${untranslatedOnly ? ' (untranslated only)' : ''}. `
    + `Edit values in exported_keys/, then run \`node scripts/i18n-import.mjs\`.`,
);
