<script setup lang="ts">
const { t } = useI18n({ useScope: 'local' });

function returnNewKey() {
    return t('New translation key in function');
}
</script>

<template>
    <p>{{ t('Goodbye') }}</p>
    <p>{{ returnNewKey() }}</p>
</template>

<i18n lang="json">
{
    "en": {
        "Goodbye": "Goodbye",
        "New translation key in function": "New translation key in function"
    },
    "sl": {
        "Goodbye": "Goodbye in german",
        "New translation key in function": "TODO_TRANSLATION: New translation key in function"
    }
}
</i18n>
