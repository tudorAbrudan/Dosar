/**
 * @fileoverview Disallow hardcoded hex/rgba color literals in components.
 * Components must read colors from the palette (useColorScheme + @/theme/colors).
 *
 * Allowed (intentional / theme-neutral):
 * - `'transparent'`
 * - inside `theme/colors.*` (the source of truth)
 * - inside `scripts/` and `__tests__/` (audit/tests can have literals)
 * - **shadow colors** `#000` / `#000000` / `'rgba(0,0,0,X)'` — shadow always
 *   uses pure black with low opacity; theme-neutral by design.
 * - **on-primary text** `#fff` / `#ffffff` — text pe `primary` (verde EVPoint)
 *   este alb în ambele teme; intenționat universal.
 * - **statusColors literals** care apar deja în paletă (#A3B86C, #E8A53A,
 *   #D84C4C, #F57F17, #1565C0, etc.) — domain-specific iconography for entity
 *   tabs / banners. Use suppress comment when intentional.
 */
'use strict';

const HEX = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const RGBA = /^rgba?\(\s*\d/i;

// Whitelist: culori neutre la temă, sigure în ambele scheme.
const WHITELISTED_LITERALS = new Set([
  '#000',
  '#000000',
  '#fff',
  '#ffffff',
  '#FFF',
  '#FFFFFF',
  'transparent',
]);

// RGBA shadow patterns — `rgba(0,0,0,opacity)` cu opacity mic, folosit la shadow/overlay.
function isShadowRgba(value) {
  const m = value.match(/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0?\.\d+|0|1)\s*\)$/i);
  return Boolean(m);
}

function isWhitelisted(value) {
  if (WHITELISTED_LITERALS.has(value)) return true;
  if (isShadowRgba(value)) return true;
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded hex/rgba colors in components; use palette from @/theme/colors via useColorScheme. Theme-neutral literals (#000 shadow, #fff on-primary, rgba(0,0,0,X) overlay) sunt permise.',
    },
    schema: [],
    messages: {
      hex: 'Hex/rgba color "{{value}}" hardcoded — use palette (e.g. C.text, statusColors.ok, primaryMuted) so dark mode works.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (/theme\//.test(filename)) return {};
    if (/eslint-local-rules\//.test(filename)) return {};
    if (/scripts\//.test(filename)) return {};
    if (/__tests__\//.test(filename)) return {};
    if (/node_modules\//.test(filename)) return {};

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (!HEX.test(node.value) && !RGBA.test(node.value)) return;
        if (isWhitelisted(node.value)) return;
        context.report({ node, messageId: 'hex', data: { value: node.value } });
      },
      TemplateLiteral(node) {
        if (node.expressions.length > 0) return;
        const raw = node.quasis[0]?.value?.raw ?? '';
        if (!HEX.test(raw) && !RGBA.test(raw)) return;
        if (isWhitelisted(raw)) return;
        context.report({ node, messageId: 'hex', data: { value: raw } });
      },
    };
  },
};
