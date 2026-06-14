<script lang="ts" setup>
const { t } = useI18n({ useScope: 'local' })
console.log(t('test translation key in script'));
</script>

<template>
    <div>
        {{ t('test translation key') }}
    </div>
</template>

<style lang="scss" scoped>

</style>

<i18n lang="json">
{
    "en": {
        "test translation key": "test translation key",
        "test translation key in script": "test translation key in script"
    },
    "sl": {
        "test translation key": "TODO_TRANSLATION: test translation key",
        "test translation key in script": "TODO_TRANSLATION: test translation key in script"
    }
}
</i18n>
