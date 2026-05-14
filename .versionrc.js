/* eslint-env node */
'use strict';

/**
 * Configurare standard-version pentru Dosar.
 *
 * Bump-uri:
 * - Marketing version: package.json + app.json (expo.version)
 * - Build number iOS: app.json (expo.ios.buildNumber) + ios/Dosar/Info.plist (CFBundleVersion)
 *
 * Rulare:
 *   npm run release            # auto-detect bump (patch/minor/major) din commits
 *   npm run release -- --release-as patch
 *   npm run release -- --release-as minor
 *   npm run release -- --dry-run   # preview, fără modificări
 */

module.exports = {
  types: [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'refactor', section: 'Refactoring' },
    { type: 'perf', section: 'Performance' },
    { type: 'docs', section: 'Documentation' },
    { type: 'test', section: 'Tests' },
    { type: 'ci', section: 'CI/CD' },
    { type: 'build', section: 'Build' },
    { type: 'chore', hidden: true },
    { type: 'style', hidden: true },
    { type: 'release', hidden: true },
  ],
  bumpFiles: [
    { filename: 'package.json', type: 'json' },
    { filename: 'app.json', updater: '.versionrc.app.js' },
    { filename: 'ios/Dosar/Info.plist', updater: '.versionrc.plist.js' },
  ],
  skip: {
    // Tag-ul îl creează standard-version; commit-ul îl creează tot el.
    // Nu skip nimic.
  },
};
