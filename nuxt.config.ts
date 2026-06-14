// https://nuxt.com/docs/api/configuration/nuxt-config
import i18nLocales from './i18n.locales.json'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    // Per-component translations only — keys live in each component's
    // <i18n> block and are generated/synced by `pnpm run i18n:extract`.
    // The locale list below is the single source of truth in
    // i18n.locales.json (shared with the extract script).
    defaultLocale: i18nLocales.defaultLocale,
    strategy: 'prefix_except_default',
    locales: i18nLocales.locales,
    experimental: {
      typedOptionsAndMessages: 'all',
    },
  },
})
