<script setup lang="ts">
const { locales, locale, setLocale } = useI18n()

const currentLocale = computed(() =>
  locales.value.find(l => l.code === locale.value),
)
</script>

<template>
  <div>
    <select
      :value="locale"
      @change="setLocale(($event.target as HTMLSelectElement).value as typeof locale)"
    >
      <option
        v-for="l in locales"
        :key="l.code"
        :value="l.code"
      >
        {{ l.name }}
      </option>
    </select>
    <span v-if="currentLocale"> {{ currentLocale.name }}</span>
  </div>
</template>
