module.exports = {
  extends: ['expo', 'prettier'],
  plugins: ['prettier', 'local-rules'],
  rules: {
    'prettier/prettier': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // Custom rules — warn pentru migrare progresivă (cleanup în P3.1)
    'local-rules/no-hardcoded-hex-colors': 'warn',
    'local-rules/no-direct-doc-type-iteration': 'warn',
  },
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'build/',
    '.worktrees/',
    'eslint-local-rules/',
  ],
};
