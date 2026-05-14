/**
 * @fileoverview Forbid direct iteration over DOCUMENT_TYPE_LABELS / STANDARD_DOC_TYPES
 * in UI code. Use `useFilteredDocTypes()` so per-user visibility settings are respected.
 *
 * See .claude/rules/dynamic-types.md for the full rationale.
 */
'use strict';

const ITER_OBJECT_METHODS = new Set(['entries', 'keys', 'values']);
const ITER_ARRAY_METHODS = new Set(['map', 'forEach', 'filter', 'reduce', 'flatMap']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid direct iteration over DOCUMENT_TYPE_LABELS / STANDARD_DOC_TYPES in UI — use useFilteredDocTypes()',
    },
    schema: [],
    messages: {
      iter:
        'Direct iteration over {{name}} — use useFilteredDocTypes() instead so user visibility settings are honored. See .claude/rules/dynamic-types.md.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    // Sursa de adevăr și hook-ul însuși au voie să itereze
    if (/types\/index\./.test(filename)) return {};
    if (/hooks\/useFilteredDocTypes\./.test(filename)) return {};
    if (/services\//.test(filename)) return {}; // services pot itera (chatbot, AI, etc.)
    if (/scripts\//.test(filename)) return {};
    if (/__tests__\//.test(filename)) return {};
    if (/eslint-local-rules\//.test(filename)) return {};
    if (/node_modules\//.test(filename)) return {};

    return {
      // Object.{entries|keys|values}(DOCUMENT_TYPE_LABELS)
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Object' &&
          node.callee.property.type === 'Identifier' &&
          ITER_OBJECT_METHODS.has(node.callee.property.name) &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Identifier' &&
          node.arguments[0].name === 'DOCUMENT_TYPE_LABELS'
        ) {
          context.report({ node, messageId: 'iter', data: { name: 'DOCUMENT_TYPE_LABELS' } });
        }
      },
      // STANDARD_DOC_TYPES.{map|forEach|filter|...}
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'STANDARD_DOC_TYPES' &&
          node.property.type === 'Identifier' &&
          ITER_ARRAY_METHODS.has(node.property.name) &&
          node.parent &&
          node.parent.type === 'CallExpression' &&
          node.parent.callee === node
        ) {
          context.report({ node, messageId: 'iter', data: { name: 'STANDARD_DOC_TYPES' } });
        }
      },
    };
  },
};
