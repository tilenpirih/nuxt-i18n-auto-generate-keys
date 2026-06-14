# Nuxt i18n — auto-generated keys

A small workflow on top of [`@nuxtjs/i18n`](https://i18n.nuxtjs.org/) where you
**never hand-maintain translation files**. You write `t('Sentence')` in your
code, run one command, and every locale file is created and kept in sync for
you — with untranslated strings flagged for an AI (or human) to fill in.

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

`pnpm i18n:extract` scans `app/`, finds every translator call, and writes the
keys to one of **two homes** depending on how you called it:

| You write | Where the file is | Key goes to |
| --- | --- | --- |
| `t('...')` in a **`.vue`** file | component-local | that component's own `<i18n>` block |
| `$t('...')` **anywhere** | global / shared | the public catalog `i18n/locales/<locale>.json` |
| `t('...')` in a **`.ts`** file | global / shared | the public catalog `i18n/locales/<locale>.json` |

Rule of thumb: **`$t` is always global/public.** Bare `t` is local inside a
`.vue` component (it owns an `<i18n>` block) and global inside a `.ts` file
(composable/util/store — it can't own a block, so it goes to the catalog).

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
- In `.vue` files, if you use `t(...)` without setting it up, the script
  auto-injects `const { t } = useI18n({ useScope: 'local' })` for you.

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

1. Write `t('...')` / `$t('...')` wherever you need text.
2. `pnpm i18n:extract` — keys appear in all locales, untranslated ones marked.
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
