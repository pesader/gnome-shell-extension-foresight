// Ensure Prettier formatting follows the project's linting rules

/** @type {import("prettier").Config} */
export default {
    overrides: [
        {
            files: ['*.ts', '*.js', '*.mjs', '*.cjs'],
            options: {
                printWidth: 100,
                tabWidth: 4,
                useTabs: false,
                semi: true,
                singleQuote: true,
                bracketSpacing: false,
                arrowParens: 'avoid',
                trailingComma: 'es5',
            },
        },
    ],
};
