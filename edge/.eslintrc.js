module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    worker: true,
    node: true,
    es2024: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    ecmaVersion: 2024,
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  settings: {
    // `cloudflare:test` is a virtual module provided by the vitest pool; it is
    // not resolvable on disk, so tell the import plugin to treat it as external.
    'import/core-modules': ['cloudflare:test'],
  },
  globals: {
    // Cloudflare Workers runtime globals not covered by the `worker` env.
    Response: 'readonly',
    Request: 'readonly',
    Headers: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    fetch: 'readonly',
    crypto: 'readonly',
    HTMLRewriter: 'readonly',
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'import/prefer-default-export': 'off', // worker modules are grouped by concern, not default-exported
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
    'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'], // allow for..of
    'max-len': ['error', {
      code: 100,
      ignoreComments: true,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
    }],
  },
};
