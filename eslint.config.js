import antfu from '@antfu/eslint-config';

const config = await antfu(
    {
        formatters: true,
        vue: true,
    },
    {
        ignores: ['**/*.md'],
    },
    {
        files: ['**/*.vue'],
        rules: {
            'vue/operator-linebreak': ['error', 'before'],
            'vue/component-name-in-template-casing': ['error', 'PascalCase', {
                registeredComponentsOnly: false,
                ignores: [],
            }],
            'vue/html-closing-bracket-newline': [
                'error',
                {
                    singleline: 'never',
                    multiline: 'never',
                    selfClosingTag: {
                        singleline: 'never',
                        multiline: 'never',
                    },
                },
            ],
            'vue/no-unused-vars': 'warn',
        },
    },
    {
        rules: {
            'style/semi': ['error', 'always'],
            'no-console': 'warn',
            'arrow-parens': ['error', 'as-needed'],
            'ts/ban-ts-comment': 'off',
            'style/eol-last': 'off',
            'style/arrow-parens': 'off',
            'unused-imports/no-unused-vars': 'warn',
            'node/prefer-global/process': 'off',
            'regexp/no-unused-capturing-group': ['error', { fixable: true }],
            'style/indent': ['warn', 4],
            'vue/html-indent': ['warn', 4],
            'style/member-delimiter-style': [
                'error',
                {
                    multiline: {
                        delimiter: 'semi',
                        requireLast: true,
                    },
                    singleline: {
                        delimiter: 'semi',
                        requireLast: false,
                    },
                    multilineDetection: 'brackets',
                },
            ],
            'style/brace-style': ['warn', '1tbs'],
            'antfu/if-newline': 'off',
            'style/space-unary-ops': ['error', { words: true, nonwords: false }],
        },
    },
    {
        files: ['**/*.json', '**/*.json5', '**/*.jsonc'],
        rules: {
            'jsonc/indent': ['warn', 4],
        },
    },
);

export default config;
