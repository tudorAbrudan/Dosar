/* eslint-env node */
'use strict';

/**
 * Updater pentru ios/Dosar/Info.plist (manual prebuild result).
 *
 * - CFBundleShortVersionString ← marketing version
 * - CFBundleVersion ← buildNumber (mirror din app.json după update)
 *
 * Notă: `npm run release` rulează acest updater DUPĂ `.versionrc.app.js`,
 * deci buildNumber-ul din app.json este deja incrementat. Citim din Info.plist
 * propriul build curent și incrementăm cu 1 (păstrăm aliniere cu app.json
 * pentru că ambele pleacă din aceeași valoare).
 */

module.exports = {
  readVersion(contents) {
    const match = contents.match(
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
    );
    return match ? match[1] : '0.0.0';
  },
  writeVersion(contents, version) {
    let out = contents.replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`
    );

    out = out.replace(
      /(<key>CFBundleVersion<\/key>\s*<string>)(\d+)(<\/string>)/,
      (_match, prefix, buildNum, suffix) => {
        const next = parseInt(buildNum, 10) + 1;
        return `${prefix}${next}${suffix}`;
      }
    );

    return out;
  },
};
