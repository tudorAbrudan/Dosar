#!/usr/bin/env node
/**
 * patch-share-extension-swift.js
 *
 * expo-share-intent@6.1.1 generează ios/ShareExtension/ShareViewController.swift
 * (la fiecare `expo prebuild`) cu un bug de concurență: handleImages() rulează
 * fiecare atașament într-un Task.detached neasteptat de bucla exterioară din
 * handleViewLoad(), deci mai multe imagini se procesează concurent în loc de
 * secvențial. Redirect-ul către app se declanșează la `index == count - 1`
 * (ultimul index din buclă), nu la "toate atașamentele au terminat efectiv de
 * adăugat în sharedMedia" — deci în funcție de ordinea reală de completare,
 * unele imagini nu apucă să fie în array la momentul redirect-ului și se
 * pierd silențios.
 *
 * Reprodus manual: share cu 2-3 imagini din Photos → doar 1 ajunge la
 * aplicație, fără nicio alertă (2026-07-13).
 *
 * Fix: elimină cele două niveluri de concurență nestructurată (Task.detached +
 * Task { @MainActor in }) din handleImages, astfel încât bucla for-await din
 * handleViewLoad() devine cu adevărat secvențială.
 *
 * NU editat direct în ios/ — fișierul e regenerat de la zero la fiecare
 * `expo prebuild` (CNG). Acest script rulează DUPĂ prebuild (vezi
 * package.json → "prebuild") ca să reaplice patch-ul.
 *
 * Rulare: node scripts/patch-share-extension-swift.js
 */

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(
  __dirname,
  '..',
  'ios',
  'ShareExtension',
  'ShareViewController.swift'
);

// Concatenare linie-cu-linie (nu template literal) — ancorele conțin linii
// "goale" cu spații de indentare finale (trailing whitespace), pe care un
// template literal multi-linie riscă să le piardă la orice reformatare.
const OLD_OPEN = [
  '    Task.detached {',
  '      do {',
  '        let item = try await attachment.loadItem(forTypeIdentifier: self.imageContentType)',
  '        ',
  '        Task { @MainActor in',
].join('\n');

const NEW_OPEN = [
  '    do {',
  '      let item = try await attachment.loadItem(forTypeIdentifier: self.imageContentType)',
  '',
].join('\n');

const OLD_CLOSE = [
  '            self.redirectToHostApp(type: .media)',
  '          }',
  '        }',
  '      } catch {',
  '        NSLog("[ERROR] handleImages: Exception loading image item: \\(error)")',
  '        await self.dismissWithError(message: "Cannot load image content: \\(error.localizedDescription)")',
  '      }',
  '    }',
  '  }',
].join('\n');

const NEW_CLOSE = [
  '            self.redirectToHostApp(type: .media)',
  '          }',
  '      } catch {',
  '        NSLog("[ERROR] handleImages: Exception loading image item: \\(error)")',
  '        await self.dismissWithError(message: "Cannot load image content: \\(error.localizedDescription)")',
  '      }',
  '  }',
].join('\n');

function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.log(
      '[patch-share-extension-swift] ios/ShareExtension/ nu există (Android-only build sau prebuild neefectuat) — sar peste.'
    );
    return;
  }

  const content = fs.readFileSync(FILE_PATH, 'utf8');

  if (content.includes(NEW_OPEN) && !content.includes(OLD_OPEN)) {
    console.log('[patch-share-extension-swift] deja aplicat, sar peste.');
    return;
  }

  if (!content.includes(OLD_OPEN) || !content.includes(OLD_CLOSE)) {
    console.error(
      '[patch-share-extension-swift] ✗ Ancorele nu au fost găsite în ShareViewController.swift.\n' +
        'Template-ul expo-share-intent s-a schimbat (versiune nouă?) — actualizează acest script.'
    );
    process.exit(1);
  }

  const patched = content.split(OLD_OPEN).join(NEW_OPEN).split(OLD_CLOSE).join(NEW_CLOSE);
  fs.writeFileSync(FILE_PATH, patched, 'utf8');
  console.log(
    '[patch-share-extension-swift] ✓ handleImages patched (fix race condition la share multi-imagine).'
  );
}

main();
