// i18n-keys — shared plumbing for `i18n-export` and `i18n-import`.
//
// It reads the two homes that `i18n-extract` writes to and flattens them into
// one editable namespace, then lets the importer route edited values back to
// the exact place they came from:
//
//   • per-component <i18n> blocks (.vue)  → location is the dotted file path,
//       e.g. app/components/Greeting.vue  →  "app.components.Greeting"
//   • shared public catalog (i18n/locales/*.json) → a single fixed location,
//       CATALOG_LOCATION below.
//
// A flat exported key is `<location><SEP><inner key>`, e.g.
//   "app.components.Greeting-Goodbye"      (a component block key)
//   "i18n.locales-Translation key in utils" (a shared catalog key)
//
// Export and import both build these strings the SAME way, straight from the
// live source. Import then matches by exact string equality and writes the
// value back to the recorded target — so routing never relies on guessing
// where a `-` splits. (Edit values in exported_keys/*.json, never the keys.)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

export const ROOT = process.cwd();
export const SRC_DIRS = ['app']; // where component/composable/util/store code lives
export const LOCALES_DIR = join(ROOT, 'i18n', 'locales');
export const EXPORT_DIR = join(ROOT, 'exported_keys');
export const TODO_PREFIX = 'TODO_TRANSLATION: ';
export const INDENT = 4; // spaces, matches i18n-extract output exactly
export const SEP = '-'; // between location and inner key in a flat exported key
export const CATALOG_LOCATION = 'i18n.locales'; // home of the shared catalog keys
const IGNORE_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', '.data', '.cache']);

// Same block matcher i18n-extract uses, so we round-trip cleanly.
const I18N_BLOCK = /<i18n\b[^>]*>[\s\S]*?<\/i18n>/i;

// --- locales: single source of truth, shared with nuxt.config.ts ----------
const { defaultLocale, locales } = JSON.parse(
    readFileSync(join(ROOT, 'i18n', 'i18n.locales.json'), 'utf8'),
);
export { defaultLocale };
export const localeCodes = locales.map(l => l.code);

// A value counts as translated once a human/AI has filled it: present,
// non-empty, and no longer carrying the TODO placeholder.
export function isTranslated(value) {
    return value != null && value !== '' && !String(value).startsWith(TODO_PREFIX);
}

export function flatKey(location, innerKey) {
    return `${location}${SEP}${innerKey}`;
}

export function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

// app/components/Greeting.vue -> "app.components.Greeting"
function locationForVue(file) {
    return relative(ROOT, file).replace(/\.vue$/i, '').split(sep).join('.');
}

function parseBlock(content) {
    const block = content.match(I18N_BLOCK);
    if (!block) return null;
    const inner = block[0].replace(/^<i18n\b[^>]*>/i, '').replace(/<\/i18n>$/i, '');
    try {
        return JSON.parse(inner);
    } catch {
        return null;
    }
}

function walk(dir, acc) {
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

function vueFiles() {
    const acc = [];
    for (const dir of SRC_DIRS) {
        const abs = join(ROOT, dir);
        if (existsSync(abs)) walk(abs, acc);
    }
    return acc.sort();
}

// --- the shared read ------------------------------------------------------
// Returns everything both scripts need:
//   blocks  : [{ file, location, messages }]   messages = { [code]: { innerKey: value } }
//   catalog : { [code]: { innerKey: value } }
//   targets : Map<flatKey, { kind:'block'|'catalog', file?, location, innerKey }>
//   values  : { [code]: { flatKey: value } }    the flattened, exportable view
export function collect() {
    const blocks = [];
    const targets = new Map();
    const values = Object.fromEntries(localeCodes.map(code => [code, {}]));

    const record = (location, innerKey, target, perLocale) => {
        const fk = flatKey(location, innerKey);
        const existing = targets.get(fk);
        if (existing && (existing.file !== target.file || existing.innerKey !== target.innerKey)) {
            console.warn(`  WARN  flat key collision on "${fk}" — only one source will round-trip`);
        }
        targets.set(fk, target);
        for (const code of localeCodes) values[code][fk] = perLocale(code) ?? '';
    };

    // component <i18n> blocks
    for (const file of vueFiles()) {
        const messages = parseBlock(readFileSync(file, 'utf8'));
        if (!messages) continue;
        const location = locationForVue(file);
        blocks.push({ file, location, messages });
        const innerKeys = new Set();
        for (const code of localeCodes) {
            for (const k of Object.keys(messages[code] || {})) innerKeys.add(k);
        }
        for (const innerKey of innerKeys) {
            record(location, innerKey, { kind: 'block', file, location, innerKey }, code => messages[code]?.[innerKey]);
        }
    }

    // shared public catalog
    const catalog = {};
    const catalogKeys = new Set();
    for (const code of localeCodes) {
        catalog[code] = readJson(join(LOCALES_DIR, `${code}.json`));
        for (const k of Object.keys(catalog[code])) catalogKeys.add(k);
    }
    for (const innerKey of catalogKeys) {
        record(CATALOG_LOCATION, innerKey, { kind: 'catalog', location: CATALOG_LOCATION, innerKey }, code => catalog[code]?.[innerKey]);
    }

    return { blocks, catalog, targets, values };
}

// Serialize a component block exactly like i18n-extract does (locale order
// from localeCodes, inner keys sorted, INDENT) so a later extract sees no diff.
export function buildBlock(messages) {
    const out = {};
    for (const code of localeCodes) {
        const dict = {};
        for (const key of Object.keys(messages[code] || {}).sort()) dict[key] = messages[code][key];
        out[code] = dict;
    }
    return `<i18n lang="json">\n${JSON.stringify(out, null, INDENT)}\n</i18n>\n`;
}

export function replaceBlock(content, messages) {
    return content.replace(I18N_BLOCK, buildBlock(messages).trimEnd());
}

// Serialize a catalog locale dict exactly like i18n-extract's syncCatalog.
export function serializeCatalog(dict) {
    const sorted = {};
    for (const key of Object.keys(dict).sort()) sorted[key] = dict[key];
    return `${JSON.stringify(sorted, null, INDENT)}\n`;
}
