/* eslint-env jest */
/**
 * Mock Jest pentru modulul nativ expo-perspective-crop.
 * Returnează valori identity utile pentru unit tests fără runtime nativ.
 */

module.exports = {
  cropPerspective: jest.fn(async ({ uri }) => ({
    uri: `${uri}?cropped=1`,
    width: 800,
    height: 1200,
  })),
  detectCorners: jest.fn(async () => ({
    corners: null,
    confidence: 0,
  })),
};
