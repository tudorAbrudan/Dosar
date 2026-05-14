/* eslint-env node */
'use strict';

/**
 * Updater pentru app.json (Expo config).
 *
 * - `expo.version` ← marketing version (3.5.0)
 * - `expo.ios.buildNumber` ← incrementat cu 1 la fiecare release
 *   (CFBundleVersion trebuie să crească monoton pentru App Store Connect)
 */

module.exports = {
  readVersion(contents) {
    return JSON.parse(contents).expo.version;
  },
  writeVersion(contents, version) {
    const json = JSON.parse(contents);
    json.expo.version = version;
    const currentBuild = parseInt(json.expo.ios.buildNumber, 10) || 0;
    json.expo.ios.buildNumber = String(currentBuild + 1);
    return JSON.stringify(json, null, 2) + '\n';
  },
};
