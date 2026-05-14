/* eslint-env node */
/**
 * Tests for custom ESLint rules. Run via `node eslint-local-rules/rules.test.js`
 * (NOT via jest — jest-expo preset overrides structuredClone which breaks ESLint internals).
 */
'use strict';

const { test } = require('node:test');
const { RuleTester } = require('eslint');
const hexRule = require('./no-hardcoded-hex-colors');
const docTypeRule = require('./no-direct-doc-type-iteration');

const tester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

// Pass synthetic filename so the rule treats us as a real component file (not theme/scripts/tests)
const FILE = 'components/Foo.tsx';

test('no-hardcoded-hex-colors', () => {
  tester.run('no-hardcoded-hex-colors', hexRule, {
    valid: [
      { code: "const c = 'transparent';", filename: FILE },
      { code: 'const c = statusColors.ok;', filename: FILE },
      { code: 'const c = palette.text;', filename: FILE },
      { code: "const c = 'normal text';", filename: FILE },
      // permis în sursa paletei
      { code: "const c = '#9EB567';", filename: 'theme/colors.ts' },
      // permis în scripts
      { code: "const c = '#FF9800';", filename: 'scripts/update-site.js' },
      // permis în __tests__
      { code: "const c = '#FFF';", filename: '__tests__/smoke/X.test.tsx' },
    ],
    invalid: [
      {
        code: "const c = '#FFF';",
        filename: FILE,
        errors: [{ messageId: 'hex' }],
      },
      {
        code: "const c = '#FF9800';",
        filename: FILE,
        errors: [{ messageId: 'hex' }],
      },
      {
        code: "const c = 'rgba(232,165,58,0.18)';",
        filename: FILE,
        errors: [{ messageId: 'hex' }],
      },
      {
        code: "const c = '#BF360C';",
        filename: FILE,
        errors: [{ messageId: 'hex' }],
      },
    ],
  });
});

test('no-direct-doc-type-iteration', () => {
  tester.run('no-direct-doc-type-iteration', docTypeRule, {
    valid: [
      // Lookup direct OK
      { code: 'const label = DOCUMENT_TYPE_LABELS[doc.type];', filename: FILE },
      // Folosire prin hook
      {
        code: 'const { docTypeOptions } = useFilteredDocTypes();',
        filename: FILE,
      },
      // Permis în sursa
      {
        code: 'Object.entries(DOCUMENT_TYPE_LABELS).forEach(x => x);',
        filename: 'types/index.ts',
      },
      // Permis în hook
      {
        code: 'STANDARD_DOC_TYPES.map(t => t);',
        filename: 'hooks/useFilteredDocTypes.ts',
      },
      // Permis în services
      {
        code: 'STANDARD_DOC_TYPES.map(t => t);',
        filename: 'services/chatbot.ts',
      },
      // Permis în __tests__
      {
        code: 'STANDARD_DOC_TYPES.forEach(t => t);',
        filename: '__tests__/unit/foo.test.ts',
      },
    ],
    invalid: [
      {
        code: 'Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => k);',
        filename: FILE,
        errors: [{ messageId: 'iter' }],
      },
      {
        code: 'Object.keys(DOCUMENT_TYPE_LABELS).forEach(t => t);',
        filename: FILE,
        errors: [{ messageId: 'iter' }],
      },
      {
        code: 'Object.values(DOCUMENT_TYPE_LABELS).forEach(t => t);',
        filename: FILE,
        errors: [{ messageId: 'iter' }],
      },
      {
        code: 'STANDARD_DOC_TYPES.map(t => t);',
        filename: FILE,
        errors: [{ messageId: 'iter' }],
      },
      {
        code: 'STANDARD_DOC_TYPES.filter(t => t === "altul");',
        filename: FILE,
        errors: [{ messageId: 'iter' }],
      },
    ],
  });
});
