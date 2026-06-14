#!/usr/bin/env node
// i18n-extract — per-component translation sync for @nuxtjs/i18n.
//
// For every .vue file in the project it:
//   1. finds every local `t('key')` call (template + script),
//   2. ensures the component has `const { t } = useI18n({ useScope: 'local' })`,
//   3. rewrites its <i18n lang="json"> block so that:
//        - the default locale value is the key text (or the existing value),
//        - every other locale gets `TODO_TRANSLATION: <key>` until translated,
//        - keys no longer used in the component are removed,
//   4. removes the <i18n> block entirely if the component uses no keys.
//
// The locale list comes from i18n.locales.json (shared with nuxt.config.ts),
// so adding/removing a locale there flows into every component on the next run.
//
// Limitations: keys must be string literals (no `t(variable)`), and <i18n>
// blocks are managed as JSON (a `lang="yaml"` block would be rewritten as json).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const TODO_PREFIX = 'TODO_TRANSLATION: ';
const IGNORE_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', '.data', '.cache']);

// --- locales: single source of truth, shared with nuxt.config.ts ----------
const { defaultLocale, locales } = JSON.parse(
    readFileSync(join(ROOT, 'i18n.locales.json'), 'utf8'),
);
const localeCodes = locales.map(l => l.code);

// --- patterns -------------------------------------------------------------
// Match a bare `t('...')` / `t("...")` / t(`...`) call, but NOT `$t(`,
// `obj.t(`, or `foot(` etc. (no word char, `$` or `.` immediately before).
const KEY_CALL = /(?<![\w$.])t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const I18N_BLOCK = /<i18n\b[^>]*>[\s\S]*?<\/i18n>/i;
const I18N_BLOCK_TRAILING = /\n*<i18n\b[^>]*>[\s\S]*?<\/i18n>\s*/i;
// eslint-disable-next-line regexp/no-contradiction-with-assertion
const SETUP_TAG = /<script\b[^>]*\bsetup\b[^>]*>/i;

function extractKeys(source) {
    const keys = new Set();
    KEY_CALL.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = KEY_CALL.exec(source)) !== null) keys.add(m[2]);
    return keys;
}

function parseExistingMessages(content) {
    const block = content.match(I18N_BLOCK);
    if (!block) return {};
    const inner = block[0].replace(/^<i18n\b[^>]*>/i, '').replace(/<\/i18n>$/i, '');
    try {
        return JSON.parse(inner);
    } catch {
        return {};
    }
}

function buildMessages(keys, existing) {
    const sortedKeys = [...keys].sort();
    const out = {};
    for (const code of localeCodes) {
        const prev = existing[code] || {};
        const dict = {};
        for (const key of sortedKeys) {
            const prevVal = prev[key];
            if (prevVal != null && prevVal !== '') {
                dict[key] = prevVal; // keep existing translation
            } else if (code === defaultLocale) {
                dict[key] = key; // default locale value = the source text
            } else {
                dict[key] = TODO_PREFIX + key; // needs translating
            }
        }
        out[code] = dict;
    }
    return out;
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

function renderBlock(messages) {
    return `<i18n lang="json">\n${JSON.stringify(messages, null, 2)}\n</i18n>\n`;
}

function processFile(file) {
    const original = readFileSync(file, 'utf8');
    // Strip the existing block before scanning so translation *values* that
    // happen to contain `t(` are never mistaken for key usages.
    const keys = extractKeys(original.replace(new RegExp(I18N_BLOCK, 'gi'), ''));
    const existing = parseExistingMessages(original);

    // Drop any existing block + trailing whitespace, then re-append a fresh
    // one. This keeps a clean blank-line separator regardless of how the file
    // looked before (avoids gluing the block onto </template>).
    let body = original.replace(I18N_BLOCK_TRAILING, '\n').replace(/\s+$/, '\n');

    if (keys.size === 0) {
        const changed = body !== original;
        if (changed) writeFileSync(file, body);
        return { keys: 0, changed, removed: changed };
    }

    body = ensureLocalScope(body);
    const block = renderBlock(buildMessages(keys, existing));
    const content = `${body.replace(/\s*$/, '\n')}\n${block}`;

    const changed = content !== original;
    if (changed) writeFileSync(file, content);
    return { keys: keys.size, changed };
}

function walk(dir, acc = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.'))
                walk(join(dir, entry.name), acc);
        } else if (extname(entry.name) === '.vue') {
            acc.push(join(dir, entry.name));
        }
    }
    return acc;
}

// --- run ------------------------------------------------------------------
const files = walk(ROOT).sort();
let updated = 0;
for (const file of files) {
    const res = processFile(file);
    const rel = relative(ROOT, file);
    if (res.changed) {
        updated++;
        const tag = res.removed ? 'cleared' : 'updated';
        console.log(`  ${tag.padEnd(7)} ${rel}  (${res.keys} key${res.keys === 1 ? '' : 's'})`);
    } else {
        console.log(`  ok      ${rel}  (${res.keys} key${res.keys === 1 ? '' : 's'})`);
    }
}
console.log(
    `\nDone — ${updated}/${files.length} file(s) changed, `
    + `locales: ${localeCodes.join(', ')} (default: ${defaultLocale})`,
);
