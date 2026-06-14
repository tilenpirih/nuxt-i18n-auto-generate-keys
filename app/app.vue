<script setup lang="ts">
const { t } = useI18n({
    useScope: 'local',
});
</script>

<template>
    <div>
        {{ t('Hello') }}
        <Greeting />
    </div>
</template>

<i18n lang="json">
{
  "en": {
    "Hello": "Hello"
  },
  "sl": {
    "Hello": "TODO_TRANSLATION: Hello"
  }
}
</i18n>
