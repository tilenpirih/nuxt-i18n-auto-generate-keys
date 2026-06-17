#!/usr/bin/env node
// i18n-extract — translation key sync for @nuxtjs/i18n.
//
// You write bare `t('key')` everywhere — components, composables, utils — and
// never decide local vs global yourself. This script decides for you and keeps
// every locale file in sync.
//
//   • A key used in just one component  → that component's own <i18n> block
//                                          (local scope, co-located).
//   • A key shared across many places   → the shared public catalog,
//                                          i18n/locales/<locale>.json (global).
//
// AUTO-PROMOTION & DEMOTION — driven purely by usage count
// --------------------------------------------------------
// Every run does a full scan and counts, per key, how many components use it
// via bare `t`. The count decides where the key lives, and it works BOTH ways:
//
//   • used in >= N components (default 3) → PUBLIC: moved into the shared
//     catalog and removed from those components' <i18n> blocks.
//   • used in < N components             → LOCAL: lives in each using
//     component's own <i18n> block (and is removed from the catalog).
//
// So it's reversible: add a 3rd usage and the key goes public; comment one out
// (commented code is ignored — see stripComments) and it drops back to local.
// Translations follow the key whichever way it moves, so nothing is lost.
//
// Your source always just says `t('key')`. At runtime a component-local `t`
// transparently falls back to the public catalog for keys that aren't in its
// own block. `$t('key')` is still honoured (always global) and bare `t` in a
// .ts file is global too — but you no longer NEED `$t`; plain `t` is enough.
//
// SAME KEY, DIFFERENT MEANING is safe
// -----------------------------------
// The public value of a key is the most common *translated* value among its
// usages. A component whose block gives the key a different *translated* value
// keeps its own local copy, which overrides the public one for that component.
// e.g. `t('Close')` → "Zapri" in most components but "Blizu" in one: "Zapri"
// goes public, the odd component keeps a local "Blizu". (Untranslated TODO
// placeholders are "not yet a meaning" — they never block promotion.)
//
// Tune via the PROMOTE block below or CLI flags:
//   --threshold=5         go public only at 5+ components (default 3)
//   --no-promote          never promote; everything bare-`t` stays local
//   --require-translated  only promote a key once it's actually translated
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

// --- promotion config -----------------------------------------------------
const PROMOTE = {
    enabled: true,
    // N: a local key (with identical values) used in this many DISTINCT .vue
    // components is moved to the shared public catalog. Higher keeps more
    // strings local; 2 shares aggressively.
    threshold: 3,
    // When true, only promote keys whose every non-default locale is already
    // translated (no TODO_TRANSLATION). Safer for ambiguous words like
    // "Close": brand-new untranslated dupes look identical only because nobody
    // has translated them yet, so this waits until you've given them real
    // (possibly different) values before any merge can happen.
    requireTranslated: false,
};

// --- CLI overrides --------------------------------------------------------
for (const arg of process.argv.slice(2)) {
    if (arg === '--no-promote') {
        PROMOTE.enabled = false;
    } else if (arg === '--require-translated') {
        PROMOTE.requireTranslated = true;
    } else if (arg.startsWith('--threshold=')) {
        const n = Number.parseInt(arg.slice('--threshold='.length), 10);
        if (Number.isFinite(n) && n >= 2) PROMOTE.threshold = n;
        else console.warn(`  WARN  ignoring invalid --threshold (need integer >= 2)`);
    }
}

// --- locales: single source of truth, shared with nuxt.config.ts ----------
const { defaultLocale, locales } = JSON.parse(
    readFileSync(join(ROOT, '/i18n/i18n.locales.json'), 'utf8'),
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
// The useI18n line this script manages: `const { t } = useI18n()` or
// `const { t } = useI18n({ useScope: 'local'... })`. A user's own custom
// destructuring (e.g. `const { t, locale } = ...`) won't match, so we leave it.
const MANAGED_USEI18N = /[ \t]*const \{ t \} = useI18n\((?:\{\s*useScope: 'local'[^}]*\}\s*)?\);?\n?/;

function extractKeys(source, regex) {
    const keys = new Set();
    regex.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = regex.exec(source)) !== null) keys.add(m[2]);
    return keys;
}

function isTranslated(value) {
    return value != null && value !== '' && !String(value).startsWith(TODO_PREFIX);
}

// A whole value-set counts as translated once every non-default locale is
// filled. An untranslated set is "not yet a meaning" — it never competes for,
// nor blocks, promotion.
function isFullyTranslated(values) {
    return localeCodes.every(c => c === defaultLocale || isTranslated(values[c]));
}

function valueFor(code, key, prevVal) {
    if (prevVal != null && prevVal !== '') return prevVal; // keep existing translation
    return code === defaultLocale ? key : TODO_PREFIX + key;
}

function sigOf(values) {
    return JSON.stringify(localeCodes.map(c => values[c]));
}

// Strip comments before scanning for `t(` calls, so a commented-out usage
// (e.g. `<!-- {{ t('Save') }} -->`) no longer counts toward a key's usage.
// Only the *scan copy* is stripped; files are never written from this.
function stripComments(source) {
    return source
        .replace(/<!--[\s\S]*?-->/g, '') // <!-- HTML / template comments -->
        .replace(/\/\*[\s\S]*?\*\//g, '') // /* block comments */
        .replace(/\/\/[^\n]*/g, ''); // // line comments
}

// Pick the best value for one locale: a real translation beats a TODO/empty
// placeholder, and `primary` (the key's own home) beats `secondary` (a value
// carried over when a key moves between local and public). Keeps translations
// intact across promote/demote.
function chooseValue(code, key, primary, secondary) {
    if (code === defaultLocale) return key;
    if (isTranslated(primary)) return primary;
    if (isTranslated(secondary)) return secondary;
    return valueFor(code, key, primary || secondary);
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

// Does this component's existing block define `key`, and if so with what
// per-locale values? Used to detect a deliberate local override.
function blockOverride(existing, key) {
    if (!existing[defaultLocale] || !(key in existing[defaultLocale])) return null;
    const values = {};
    for (const code of localeCodes) values[code] = valueFor(code, key, existing[code]?.[key]);
    return values;
}

// `seed` carries values for keys being demoted out of the public catalog back
// into this block, so their translation survives the move.
function buildBlock(keys, existing, seed) {
    const sortedKeys = [...keys].sort();
    const messages = {};
    for (const code of localeCodes) {
        const dict = {};
        for (const key of sortedKeys)
            dict[key] = chooseValue(code, key, existing[code]?.[key], seed?.[code]?.[key]);
        messages[code] = dict;
    }
    return `<i18n lang="json">\n${JSON.stringify(messages, null, INDENT)}\n</i18n>\n`;
}

// Insert/replace/remove the managed useI18n line so `t` is always defined with
// the right scope. `mode`:
//   'local'    component owns an <i18n> block (with `fallback` true if some of
//              its `t` calls resolve against the public catalog instead)
//   'global'   component uses `t` but every key is public → global scope, no
//              fallback, no warnings
//   'none'     component doesn't use bare `t` → drop any managed line
function manageScope(content, mode, fallback) {
    const desired = mode === 'local'
        ? (fallback
            ? 'const { t } = useI18n({ useScope: \'local\', fallbackWarn: false, missingWarn: false })'
            : 'const { t } = useI18n({ useScope: \'local\' })')
        : mode === 'global'
            ? 'const { t } = useI18n()'
            : null;

    const hasManaged = MANAGED_USEI18N.test(content);

    if (mode === 'none')
        return hasManaged ? content.replace(MANAGED_USEI18N, '') : content;

    if (hasManaged) {
        // Preserve the existing line's trailing semicolon (don't impose a style).
        const semi = /\);/.test(content.match(MANAGED_USEI18N)[0]) ? ';' : '';
        return content.replace(MANAGED_USEI18N, `${desired}${semi}\n`);
    }
    if (/useI18n\s*\(/.test(content)) return content; // user has their own setup

    const setup = content.match(SETUP_TAG);
    if (setup) {
        const at = setup.index + setup[0].length;
        return `${content.slice(0, at)}\n${desired}${content.slice(at)}`;
    }
    return `<script setup lang="ts">\n${desired}\n</script>\n\n${content}`;
}

// --- pass 1: read every .vue file, no writes -------------------------------
function readVueFile(file) {
    const original = readFileSync(file, 'utf8');
    // Strip the block (so translation *values* containing `t(` aren't mistaken
    // for usages) and comments (so commented-out calls don't count).
    const scan = stripComments(original.replace(new RegExp(I18N_BLOCK, 'gi'), ''));
    return {
        file,
        original,
        bareKeys: extractKeys(scan, BARE_T), // candidates: local or auto-promoted
        dollarKeys: extractKeys(scan, DOLLAR_T), // $t → always global
        existing: parseExistingBlock(original),
    };
}

// --- decide which keys live in the public catalog --------------------------
// `forcedGlobal` are keys that are global no matter what (used via `$t`, or in
// a .ts file). On top of those, a bare-`t` key goes public when >= threshold
// components AGREE on its value. A component that gives the key a different
// *translated* value doesn't count toward that tally (it's a different
// meaning) — so it can pull the key below the threshold and demote it back to
// local. Removing a usage (e.g. commenting it out) does the same. Returns the
// global key set plus the agreed public value for each.
function decideGlobal(vueFiles, forcedGlobal, catalogDisk) {
    const globalKeys = new Set(forcedGlobal);
    const globalValues = {}; // key -> { code: value }

    const defaultValues = key => Object.fromEntries(localeCodes.map(c => [c, valueFor(c, key, undefined)]));
    const catalogValues = key => (key in (catalogDisk[defaultLocale] || {})
        ? Object.fromEntries(localeCodes.map(c => [c, valueFor(c, key, catalogDisk[c]?.[key])]))
        : null);

    // Effective value of a key in one component: its own block override, else
    // the public catalog value (if already global), else the fresh default.
    const effective = (vf, key) => blockOverride(vf.existing, key) || catalogValues(key) || defaultValues(key);

    // One entry per component that uses the key via bare `t`.
    const usage = new Map(); // key -> [{ file, values }]
    for (const vf of vueFiles) {
        for (const key of vf.bareKeys) {
            if (!usage.has(key)) usage.set(key, []);
            usage.get(key).push({ file: vf.file, values: effective(vf, key) });
        }
    }

    // Analyse a key's usages. The public value is the most common *fully
    // translated* value; `agree` is how many components back it — the ones
    // sharing it, plus untranslated (TODO) usages, which haven't committed to a
    // meaning yet so they go along with the majority. Components with a
    // *different translated* value are NOT counted (they're a separate meaning).
    const analyse = (key, usages) => {
        const bySig = new Map(); // sig -> { values, count }
        let untranslated = 0;
        for (const u of usages) {
            if (!isFullyTranslated(u.values)) {
                untranslated++;
                continue;
            }
            const sig = sigOf(u.values);
            const e = bySig.get(sig) || { values: u.values, count: 0 };
            e.count++;
            bySig.set(sig, e);
        }
        let best = null;
        for (const e of bySig.values()) {
            if (!best || e.count > best.count) best = e;
        }
        const conflicting = !!best && [...bySig.values()].some(e => e !== best && e.count === best.count);
        return {
            values: best ? best.values : defaultValues(key),
            agree: (best ? best.count : 0) + untranslated,
            conflicting,
        };
    };

    // forced-global keys: keep the catalog value if present, else fall back to
    // whatever the usages agree on (or default).
    for (const key of forcedGlobal)
        globalValues[key] = catalogValues(key) || analyse(key, usage.get(key) || []).values;

    if (PROMOTE.enabled) {
        for (const [key, usages] of usage) {
            if (globalKeys.has(key)) continue; // already global
            const { values, agree, conflicting } = analyse(key, usages);
            if (agree < PROMOTE.threshold) continue; // need enough components to AGREE
            if (PROMOTE.requireTranslated && !isFullyTranslated(values)) continue;
            if (conflicting) {
                console.warn(`  WARN  "${key}" has conflicting translations across components — `
                  + `promoting the most common; components with a different (translated) value stay local.`);
            }
            globalKeys.add(key);
            globalValues[key] = values;
        }
    }

    return { globalKeys, globalValues };
}

// --- pass 2: write each .vue file ------------------------------------------
function writeVueFile(vf, globalKeys, globalValues, catalogDisk) {
    const { file, original, existing, bareKeys } = vf;

    // Split this file's bare-`t` keys into what stays local vs resolves global.
    const localKeys = new Set();
    let usesGlobalFallback = false;
    for (const key of bareKeys) {
        if (!globalKeys.has(key)) {
            localKeys.add(key); // one-off (or demoted) → local block
            continue;
        }
        // Global key. Keep a local copy only if this component deliberately
        // gives it a *translated* value that differs from the public one. An
        // untranslated override is just a not-yet-filled gap → resolve global.
        const override = blockOverride(existing, key);
        if (override && isFullyTranslated(override) && sigOf(override) !== sigOf(globalValues[key]))
            localKeys.add(key);
        else usesGlobalFallback = true;
    }

    // For keys being demoted (now local, but still sitting in the catalog on
    // disk), seed their block value from the catalog so the translation moves
    // with them.
    const seed = Object.fromEntries(localeCodes.map(c => [c, {}]));
    for (const key of localKeys) {
        if (globalKeys.has(key) || !(key in (catalogDisk[defaultLocale] || {}))) continue;
        for (const code of localeCodes) seed[code][key] = catalogDisk[code]?.[key];
    }

    // Rebuild the body without the old block, then re-attach a fresh one.
    let body = original.replace(I18N_BLOCK_TRAILING, '\n').replace(/\s+$/, '\n');

    const promoted = bareKeys.size - localKeys.size;
    let content;
    if (localKeys.size > 0) {
        body = manageScope(body, 'local', usesGlobalFallback);
        content = `${body.replace(/\s*$/, '\n')}\n${buildBlock(localKeys, existing, seed)}`;
    } else {
        // No local block. `t` still needs defining if the file uses it.
        body = manageScope(body, bareKeys.size > 0 ? 'global' : 'none');
        content = body.replace(/\s+$/, '\n');
    }

    const changed = content !== original;
    if (changed) writeFileSync(file, content);
    return { localKeys: localKeys.size, changed, removed: changed && localKeys.size === 0, promoted };
}

// --- shared public catalog (i18n/locales/*.json) --------------------------
// Rebuilt from scratch each run to hold EXACTLY the currently-global keys, so a
// key that drops below the threshold is dropped here (and demoted to local).
function syncCatalog(globalKeys, globalValues, catalogDisk) {
    mkdirSync(LOCALES_DIR, { recursive: true });
    const sortedKeys = [...globalKeys].sort();
    const results = [];
    for (const code of localeCodes) {
        const file = join(LOCALES_DIR, `${code}.json`);
        const prev = catalogDisk[code] || {};
        const dict = {};
        for (const key of sortedKeys) dict[key] = chooseValue(code, key, prev[key], globalValues[key]?.[code]);
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

// Pass 1: read components and .ts files; read the catalog as it stands.
const vueFiles = found.vue.map(readVueFile);
const catalogDisk = Object.fromEntries(localeCodes.map(code => [code, readJson(join(LOCALES_DIR, `${code}.json`))]));

// Keys that are global regardless of count: `$t` anywhere, or bare `t` in a
// .ts file (a .ts file can't own an <i18n> block). NOTE: being in the catalog
// on disk does NOT pin a key global — that's what lets keys demote back to
// local when their usage drops below the threshold.
const forcedGlobal = new Set();
for (const vf of vueFiles) vf.dollarKeys.forEach(k => forcedGlobal.add(k));
const tsScans = found.ts.map(file => ({ file, keys: extractKeys(stripComments(readFileSync(file, 'utf8')), ANY_T) }));
for (const { keys } of tsScans) keys.forEach(k => forcedGlobal.add(k));

// Decide the public catalog, then write everything.
const { globalKeys, globalValues } = decideGlobal(vueFiles, forcedGlobal, catalogDisk);

let changedFiles = 0;
let promotedTotal = 0;
const promotedFromLocal = [...globalKeys].filter(k => !forcedGlobal.has(k)).sort();
// Keys that were public on disk but are no longer global → demoted to local.
const demoted = Object.keys(catalogDisk[defaultLocale] || {}).filter(k => !globalKeys.has(k)).sort();

for (const vf of vueFiles) {
    const res = writeVueFile(vf, globalKeys, globalValues, catalogDisk);
    promotedTotal += res.promoted;
    const rel = relative(ROOT, vf.file);
    const tag = res.promoted ? ` (→public: ${res.promoted})` : '';
    if (res.changed) {
        changedFiles++;
        console.log(`  ${(res.removed ? 'cleared' : 'updated').padEnd(8)} ${rel}  (block: ${res.localKeys})${tag}`);
    } else {
        console.log(`  ok       ${rel}  (block: ${res.localKeys})${tag}`);
    }
}

for (const { file, keys } of tsScans)
    console.log(`  scanned  ${relative(ROOT, file)}  (global: ${keys.size})`);

for (const res of syncCatalog(globalKeys, globalValues, catalogDisk)) {
    const rel = relative(ROOT, res.file);
    if (res.changed) changedFiles++;
    console.log(`  ${(res.changed ? 'updated' : 'ok').padEnd(8)} ${rel}  (${res.count} key${res.count === 1 ? '' : 's'})`);
}

if (promotedFromLocal.length) {
    console.log(`\nPublic now (threshold ${PROMOTE.threshold}, ${promotedTotal} call site(s) resolve to the catalog): ${
        promotedFromLocal.join(', ')}`);
}
if (demoted.length) {
    console.log(`\nDemoted to local (now used in < ${PROMOTE.threshold} components): ${demoted.join(', ')}`);
}

console.log(
    `\nDone — ${changedFiles} file(s) changed. `
    + `Catalog: ${globalKeys.size} public key(s) across ${localeCodes.join(', ')} (default: ${defaultLocale}).`,
);
