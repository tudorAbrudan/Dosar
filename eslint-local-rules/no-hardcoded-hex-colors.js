/**
 * @fileoverview Disallow hardcoded hex/rgba color literals in components.
 * Components must read colors from the palette (useColorScheme + @/theme/colors).
 *
 * Allowed (intentional):
 * - `'transparent'`
 * - inside `theme/colors.*` (the source of truth)
 * - inside `scripts/` and `__tests__/` (audit/tests can have literals)
 */
'use strict';

const HEX = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGBA = /^rgba?\(\s*\d/i;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded hex/rgba colors in components; use palette from @/theme/colors via useColorScheme',
    },
    schema: [],
    messages: {
      hex: 'Hex/rgba color "{{value}}" hardcoded — use palette (e.g. C.text, statusColors.ok, primaryMuted) so dark mode works.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (/theme\/colors\./.test(filename)) return {};
    if (/eslint-local-rules\//.test(filename)) return {};
    if (/scripts\//.test(filename)) return {};
    if (/__tests__\//.test(filename)) return {};
    if (/node_modules\//.test(filename)) return {};

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (HEX.test(node.value) || RGBA.test(node.value)) {
          context.report({ node, messageId: 'hex', data: { value: node.value } });
        }
      },
      // Template strings with no interpolation that contain only a color literal
      TemplateLiteral(node) {
        if (node.expressions.length > 0) return;
        const raw = node.quasis[0]?.value?.raw ?? '';
        if (HEX.test(raw) || RGBA.test(raw)) {
          context.report({ node, messageId: 'hex', data: { value: raw } });
        }
      },
    };
  },
};
