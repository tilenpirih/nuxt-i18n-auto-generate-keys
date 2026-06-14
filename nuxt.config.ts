// https://nuxt.com/docs/api/configuration/nuxt-config
import i18nLocales from './i18n.locales.json'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n'],
  i18n: {
    // Hybrid translations, all generated/synced by `pnpm run i18n:extract`:
    //   • .vue files keep per-component <i18n> blocks (local `t`)
    //   • .ts files (composables/utils/stores) + any `$t` use the shared
    //     public catalog in i18n/locales/*.json
    // The locale list is the single source of truth in i18n.locales.json.
    defaultLocale: i18nLocales.defaultLocale,
    strategy: 'prefix_except_default',
    locales: i18nLocales.locales,
  },
})
