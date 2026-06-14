// Runtime helper that makes `$t` usable in plain .ts files (composables,
// utils, stores). It resolves against the shared public catalog in
// i18n/locales/*.json.
//
// In .vue files, prefer the per-component <i18n> block (local `t` from
// useI18n()); reach for `$t` only for shared/global keys.
//
// Constraint: must run inside a Nuxt context — component setup/render, or a
// composable/util called from one — same rule as any use* helper. For
// interpolation later, widen the signature to forward the extra args.
export function $t(key: string): string {
    return useNuxtApp().$i18n.t(key);
}
