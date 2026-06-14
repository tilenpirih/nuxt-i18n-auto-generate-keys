<script setup lang="ts">
const { t } = useI18n({ useScope: 'local' })
</script>

<template>
    <div>
        <SwitchLanguage />
        {{ t('Hello world') }}
    </div>
</template>

<i18n lang="json">
{
    "en": {
        "Hello world": "Hello world"
    },
    "sl": {
        "Hello world": "TODO_TRANSLATION: Hello world"
    }
}
</i18n>
