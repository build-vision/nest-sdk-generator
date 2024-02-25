module.exports = {
  env: {
    browser: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:typescript-sort-keys/recommended',
  ],
  parser: '@typescript-eslint/parser',
  ignorePatterns: ['build/*', 'demo/*'],
  plugins: ['import', 'sort-destructure-keys', 'eslint-comments', 'prettier'],
  rules: {
    'sort-destructure-keys/sort-destructure-keys': [
      'error',
      {
        caseSensitive: false,
      },
    ],
    '@typescript-eslint/no-explicit-any': ['warn'],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      },
    ],
    // 'sort-imports': [
    //   'error',
    //   {
    //     ignoreCase: true,
    //     ignoreDeclarationSort: true,
    //     ignoreMemberSort: false,
    //   },
    // ],
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'index', 'sibling'],
        'newlines-between': 'always',
        pathGroupsExcludedImportTypes: ['internal'],
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'prettier/prettier': ['error', { trailingComma: 'es5' }],
  },

  settings: {
    'import/resolver': {
      typescript: {
        project: './',
      },
    },
  },
}
