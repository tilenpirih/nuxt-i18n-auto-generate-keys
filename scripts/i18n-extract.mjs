#!/usr/bin/env node
// i18n-extract — translation key sync for @nuxtjs/i18n.
//
// Two homes for keys, decided by how/where you call the translator:
//
//   • bare  t('key')  in a .vue file  → that component's <i18n> block
//                                        (local scope, co-located).
//   • $t('key')       in any file     → the shared public catalog,
//   • bare  t('key')  in a .ts file   → the shared public catalog,
//                                        i18n/locales/<locale>.json
//
// Rule of thumb: `$t` is always global/public; bare `t` is local inside a
// component (it owns a block) and global inside a .ts file (it can't own one).
//
// For every locale the default-locale value is the key text itself; every
// other locale gets `TODO_TRANSLATION: <key>` until a human/AI fills it in.
// Keys no longer referenced anywhere are pruned from both blocks and catalog.
//
// Locales come from i18n.locales.json (shared with nuxt.config.ts).
//
// Limitations: keys must be string literals (no `t(variable)`); blocks and
// catalog files are managed as JSON.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_DIRS = ['app']; // where component/composable/util/store code lives
const LOCALES_DIR = join(ROOT, 'i18n', 'locales');
const TODO_PREFIX = 'TODO_TRANSLATION: ';
const INDENT = 4; // spaces, for both <i18n> blocks and catalog files
const IGNORE_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', '.data', '.cache']);

// --- locales: single source of truth, shared with nuxt.config.ts ----------
const { defaultLocale, locales } = JSON.parse(
    readFileSync(join(ROOT, 'i18n.locales.json'), 'utf8'),
);
const localeCodes = locales.map(l => l.code);

// --- patterns -------------------------------------------------------------
// The captured key is always group 2 (group 1 is the opening quote).
const BARE_T = /(?<![\w$.])t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g; // t('...')
const DOLLAR_T = /(?<![\w.])\$t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g; // $t('...')
const ANY_T = /(?<![\w.$])\$?t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g; // t() or $t()
const I18N_BLOCK = /<i18n\b[^>]*>[\s\S]*?<\/i18n>/i;
const I18N_BLOCK_TRAILING = /\n*<i18n\b[^>]*>[\s\S]*?<\/i18n>\s*/i;
// eslint-disable-next-line regexp/no-contradiction-with-assertion
const SETUP_TAG = /<script\b[^>]*\bsetup\b[^>]*>/i;

function extractKeys(source, regex) {
    const keys = new Set();
    regex.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = regex.exec(source)) !== null) keys.add(m[2]);
    return keys;
}

function valueFor(code, key, prevVal) {
    if (prevVal != null && prevVal !== '') return prevVal; // keep existing translation
    return code === defaultLocale ? key : TODO_PREFIX + key;
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

// --- per-component <i18n> blocks (.vue) -----------------------------------
function parseExistingBlock(content) {
    const block = content.match(I18N_BLOCK);
    if (!block) return {};
    const inner = block[0].replace(/^<i18n\b[^>]*>/i, '').replace(/<\/i18n>$/i, '');
    try {
        return JSON.parse(inner);
    } catch {
        return {};
    }
}

function buildBlock(keys, existing) {
    const sortedKeys = [...keys].sort();
    const messages = {};
    for (const code of localeCodes) {
        const prev = existing[code] || {};
        const dict = {};
        for (const key of sortedKeys) dict[key] = valueFor(code, key, prev[key]);
        messages[code] = dict;
    }
    return `<i18n lang="json">\n${JSON.stringify(messages, null, INDENT)}\n</i18n>\n`;
}

function ensureLocalScope(content) {
    if (/useI18n\s*\(/.test(content)) return content; // already set up
    const line = 'const { t } = useI18n({ useScope: \'local\' })';
    const setup = content.match(SETUP_TAG);
    if (setup) {
        const at = setup.index + setup[0].length;
        return `${content.slice(0, at)}\n${line}${content.slice(at)}`;
    }
    return `<script setup lang="ts">\n${line}\n</script>\n\n${content}`;
}

function processVueFile(file) {
    const original = readFileSync(file, 'utf8');
    // Strip the block first so translation *values* containing `t(` aren't
    // mistaken for key usages.
    const scan = original.replace(new RegExp(I18N_BLOCK, 'gi'), '');
    const blockKeys = extractKeys(scan, BARE_T); // local → this file's block
    const globalKeys = extractKeys(scan, DOLLAR_T); // $t → shared catalog
    const existing = parseExistingBlock(original);

    // Drop any existing block + trailing whitespace, then re-append fresh.
    let body = original.replace(I18N_BLOCK_TRAILING, '\n').replace(/\s+$/, '\n');

    let changed;
    if (blockKeys.size === 0) {
        changed = body !== original;
        if (changed) writeFileSync(file, body);
        return { blockKeys: 0, changed, removed: changed, globalKeys };
    }

    body = ensureLocalScope(body);
    const content = `${body.replace(/\s*$/, '\n')}\n${buildBlock(blockKeys, existing)}`;
    changed = content !== original;
    if (changed) writeFileSync(file, content);
    return { blockKeys: blockKeys.size, changed, removed: false, globalKeys };
}

// --- shared public catalog (i18n/locales/*.json) --------------------------
function syncCatalog(globalKeys) {
    mkdirSync(LOCALES_DIR, { recursive: true });
    const sortedKeys = [...globalKeys].sort();
    const results = [];
    for (const code of localeCodes) {
        const file = join(LOCALES_DIR, `${code}.json`);
        const prev = readJson(file);
        const dict = {};
        for (const key of sortedKeys) dict[key] = valueFor(code, key, prev[key]);
        const content = `${JSON.stringify(dict, null, INDENT)}\n`;
        const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
        const changed = before !== content;
        if (changed) writeFileSync(file, content);
        results.push({ file, count: sortedKeys.length, changed });
    }
    return results;
}

// --- file discovery -------------------------------------------------------
function walk(dir, acc) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.'))
                walk(join(dir, entry.name), acc);
        } else {
            const ext = extname(entry.name);
            if (ext === '.vue') acc.vue.push(join(dir, entry.name));
            else if (ext === '.ts') acc.ts.push(join(dir, entry.name));
        }
    }
    return acc;
}

// --- run ------------------------------------------------------------------
const found = { vue: [], ts: [] };
for (const dir of SRC_DIRS) {
    const abs = join(ROOT, dir);
    if (existsSync(abs)) walk(abs, found);
}
found.vue.sort();
found.ts.sort();

const globalKeys = new Set();
let changedFiles = 0;

for (const file of found.vue) {
    const res = processVueFile(file);
    res.globalKeys.forEach(k => globalKeys.add(k));
    const rel = relative(ROOT, file);
    if (res.changed) {
        changedFiles++;
        console.log(`  ${(res.removed ? 'cleared' : 'updated').padEnd(8)} ${rel}  (block: ${res.blockKeys})`);
    } else {
        console.log(`  ok       ${rel}  (block: ${res.blockKeys})`);
    }
}

for (const file of found.ts) {
    const keys = extractKeys(readFileSync(file, 'utf8'), ANY_T);
    keys.forEach(k => globalKeys.add(k));
    console.log(`  scanned  ${relative(ROOT, file)}  (global: ${keys.size})`);
}

for (const res of syncCatalog(globalKeys)) {
    const rel = relative(ROOT, res.file);
    if (res.changed) changedFiles++;
    console.log(`  ${(res.changed ? 'updated' : 'ok').padEnd(8)} ${rel}  (${res.count} key${res.count === 1 ? '' : 's'})`);
}

console.log(
    `\nDone — ${changedFiles} file(s) changed. `
    + `Catalog: ${globalKeys.size} public key(s) across ${localeCodes.join(', ')} (default: ${defaultLocale}).`,
);
