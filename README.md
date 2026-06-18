# Nuxt i18n — auto-generated keys

A small workflow on top of [`@nuxtjs/i18n`](https://i18n.nuxtjs.org/) where you
**never hand-maintain translation files** and **never decide local vs global**.
You write `t('Sentence')` everywhere, run one command, and every locale file is
created and kept in sync for you — strings used in one place stay local to the
component, strings used across many components are promoted to a shared public
catalog automatically, and untranslated strings are flagged for an AI (or
human) to fill in.

```vue
<!-- write this -->
<p>{{ t('Goodbye') }}</p>
```

```bash
# run this
pnpm i18n:extract
```

The key is now registered in every locale, and `pnpm i18n:export --untranslated`
gives you a clean file of just the missing strings to hand to AI.

## How it works

The locale list lives in one place — [`i18n/i18n.locales.json`](i18n/i18n.locales.json) —
and is shared by both `nuxt.config.ts` and the scripts. Today that's `en`
(default) and `sl`.

**You just write `t('...')` everywhere — the script decides local vs global
for you.** `pnpm i18n:extract` scans `app/`, finds every translator call, and
routes each key to one of **two homes**:

| Situation | Key goes to |
| --- | --- |
| `t('...')` used in **one** component | that component's own `<i18n>` block (local, co-located) |
| `t('...')` shared across **N components** (default 3) | the public catalog `i18n/locales/<locale>.json` (global) — see [Auto-promotion](#auto-promotion-local--public-when-a-string-is-shared) |
| `t('...')` in a **`.ts`** file (composable/util/store) | the public catalog (a `.ts` file can't own a block) |

Rule of thumb: **a string used in one place stays local; a string used in
many places becomes public automatically.** You don't choose — and you never
have to write `$t`. (`$t('...')` still works and is always global, but plain
`t` is enough everywhere now.)

For each key, the **default locale** (`en`) gets the key text itself as its
value, and **every other locale** gets a `TODO_TRANSLATION: ` placeholder:

```json
// i18n/locales/sl.json  — produced automatically
{
    "Translation key in utils": "TODO_TRANSLATION: Translation key in utils"
}
```

That `TODO_TRANSLATION: ` prefix is the whole point: it's a machine-readable
marker for "not translated yet". You hand those entries to AI, get them back,
and the marker is gone.

`extract` is idempotent and safe to re-run:

- **Existing translations are preserved** — only missing/empty values are filled.
- **Unused keys are pruned** — remove a `t('...')` call, re-run, and the key
  disappears from every locale.
- In `.vue` files the script manages the `useI18n` setup line for you: a
  component with a local block gets `const { t } = useI18n({ useScope: 'local' })`;
  one whose keys are all public gets `const { t } = useI18n()` (global scope).
  If you already have your own `useI18n(...)` call (e.g. for locale switching),
  it's kept and the script just augments it: it adds `t` to the destructuring
  when you start using `t(...)`, and — if the component has single-use keys
  that should be local — adds `useScope: 'local'` so they can live in a
  co-located `<i18n>` block. (`locale`/`locales`/`setLocale` keep working under
  local scope; the local composer syncs its locale with the global one.)

## Auto-promotion & demotion: driven by usage count

This is the heart of "you never decide local vs global." Every run counts, per
key, **how many components use it** (via bare `t`), and that count decides
where the key lives — **in both directions, without touching your source**:

| Used in… | Lives in |
| --- | --- |
| **≥ N components** (default 3) | the public catalog (removed from local blocks) |
| **< N components** | each using component's own `<i18n>` block (removed from the catalog) |

So it's fully reversible:

- `t('Save')` in **2** components → stays **local** in both.
- Add a **3rd** → `Save` moves to `i18n/locales/*.json`, local copies removed.
- **Comment one out** (`<!-- {{ t('Save') }} -->`) → back down to 2 → `Save`
  is **demoted** back into the two components' local blocks.
- Uncomment it → public again.

Commented-out calls don't count (comments are stripped before scanning), and
**translations follow the key whichever way it moves**, so nothing is lost on a
promote → demote → promote round trip.

Your code always just says `t('Save')`. At runtime a component-local `t`
transparently falls back to the public catalog for any key not in its own
block.

**Same key, different meaning is safe — and the threshold counts only
components that AGREE.** A key's public value is the most common **translated**
value across its usages, and only the components sharing that value (plus
untranslated ones, which haven't picked a meaning yet) count toward the
threshold. A component that gives the key a *different translated* value does
**not** count.

That has two consequences:

- If enough still agree, the key stays public and the odd component keeps a
  local `<i18n>` copy that **overrides** the public value for itself. e.g.
  `t('Close')` = "Zapri" in 3 components and "Blizu" in a 4th → "Zapri" public,
  the 4th keeps local "Blizu".
- If the disagreement drops the agreeing count below the threshold, the key is
  **demoted entirely**. e.g. `Save` in 3 components, but you translate one to
  "Shrani2" → only 2 agree on "Shrani" → `Save` leaves the public catalog and
  becomes local in all three (each keeping its own value).

(Untranslated `TODO_TRANSLATION` placeholders are "not a meaning yet", so a
freshly-added duplicate never blocks promotion — and to keep a component's own
meaning, just translate its local entry differently.)

Configure it at the top of [`scripts/i18n-extract.mjs`](scripts/i18n-extract.mjs)
(`const PROMOTE = { ... }`) or per run:

```bash
pnpm i18n:extract --threshold=5        # go public only at 5+ components (default 3)
pnpm i18n:extract --no-promote         # never promote; bare-t keys stay local
pnpm i18n:extract --require-translated # only promote once a key is translated
```

`--require-translated` is the cautious setting: a freshly-written `t('Close')`
looks identical across components *because nobody has translated it yet*. With
this flag, such keys only promote once every locale has a real value — giving
you the chance to assign different meanings first.

> **Heads-up on dev warnings.** When a component's local `t` falls back to the
> public catalog, vue-i18n would normally log a "fall back to root" warning. The
> script silences these on exactly the components that need it by injecting
> `useI18n({ useScope: 'local', fallbackWarn: false, missingWarn: false })`.
> (These warnings are dev-only and stripped from production builds regardless.)

> **Keys must be string literals.** `t('Sentence')` works; `t(someVariable)`
> can't be statically extracted.

## Usage examples

**In a component** (`.vue`) — local block, co-located with the component:

```vue
<script setup lang="ts">
const { t } = useI18n({ useScope: 'local' });
</script>

<template>
    <p>{{ t('Goodbye') }}</p>
</template>

<!-- ↓ auto-generated / kept in sync by `pnpm i18n:extract` -->
<i18n lang="json">
{
    "en": { "Goodbye": "Goodbye" },
    "sl": { "Goodbye": "TODO_TRANSLATION: Goodbye" }
}
</i18n>
```

**In a composable / util** (`.ts`) — uses the global `$t` helper (auto-imported
from [`app/utils/i18n.ts`](app/utils/i18n.ts)), key lands in the shared catalog:

```ts
export function translationKeyInComposable() {
    return $t('Translation key in composable');
}
```

## The translation round-trip

After `extract`, keys are spread across many component blocks and the catalog.
For bulk translating (e.g. handing everything to AI at once), two helper scripts
flatten them into one editable file and route the edits back home.

```bash
# 1. collect everything that still needs translating into one flat file per locale
pnpm i18n:export --untranslated      # → exported_keys/sl.json (and others)

# 2. edit the VALUES in exported_keys/*.json (translate, or feed to AI).
#    Never edit the keys — they encode where each string goes.

# 3. write the finished translations back to their real homes
pnpm i18n:import
```

`import` only writes values that are actually translated (no longer empty or
`TODO_TRANSLATION:`), so you can translate in batches and import as you go.

Handy flags:

- `pnpm i18n:export sl` — only the `sl` locale.
- `pnpm i18n:export` — every key, not just untranslated ones.
- `pnpm i18n:import --dry-run` — show what would change, write nothing.
- `pnpm i18n:import --all` — apply every value, including TODO/empty.

## Typical day-to-day

1. Write `t('...')` wherever you need text — no need to decide local vs global.
2. `pnpm i18n:extract` — keys appear in all locales (local or auto-promoted to
   public when shared), untranslated ones marked.
3. `pnpm i18n:export --untranslated` → translate (AI or human) → `pnpm i18n:import`.

That's it — locale files are never edited by hand.

---

## Project setup

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build
pnpm preview    # preview the production build
```

See the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction)
for everything else.
