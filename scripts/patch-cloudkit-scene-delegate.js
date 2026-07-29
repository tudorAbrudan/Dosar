#!/usr/bin/env node
/**
 * patch-cloudkit-scene-delegate.js
 *
 * Acceptarea CKShare NU trece prin `UIApplicationDelegate.application(_:
 * userDidAcceptCloudKitShareWith:)` pe iOS modern — confirmat direct pe device
 * 2026-07-29 (log de sistem arată livrarea acțiunii către scenă, dar handler-ul
 * vechi nu se apelează niciodată). Fix-ul cere un `UIWindowSceneDelegate` propriu:
 *
 *   1. `SceneDelegate.swift` (nou) — implementează `windowScene(_:
 *      userDidAcceptCloudKitShareWith:)` (numele Swift corect, verificat din
 *      eroarea de compilator "has been renamed to" — headerul ObjC brut din
 *      UIWindowScene.h arată `userDidAcceptCloudKitShareWithMetadata:`, dar
 *      Apple îl redenumește pentru Swift). Tot aici se mută bootstrap-ul RN
 *      (`UIWindow(windowScene:)` + `factory.startReactNative`), pentru că odată
 *      ce `UIApplicationSceneManifest` e prezent, UIKit se așteaptă ca fereastra
 *      să fie creată în `scene(_:willConnectTo:options:)`, nu în AppDelegate.
 *   2. `AppDelegate.swift` — `didFinishLaunchingWithOptions` NU mai creează
 *      fereastra (dublă creare de fereastră + dublă pornire RN = bug real,
 *      reprodus pe device: app se lansa și se suspenda imediat).
 *   3. `project.pbxproj` — SceneDelegate.swift trebuie înregistrat manual
 *      (PBXFileReference + PBXBuildFile + grup + Sources build phase) fiindcă
 *      acest proiect NU folosește PBXFileSystemSynchronizedRootGroup.
 *
 * `UIApplicationSceneManifest` (Info.plist/app.json) e deja durabil prin
 * `app.json` → infoPlist (se propagă automat la fiecare prebuild, fără script).
 *
 * NU editat direct în ios/ — toate trei fișierele sunt regenerate la fiecare
 * `expo prebuild` (CNG). Acest script rulează DUPĂ prebuild (vezi
 * package.json → "prebuild"), la fel ca patch-share-extension-swift.js.
 *
 * Rulare: node scripts/patch-cloudkit-scene-delegate.js
 */

const fs = require('fs');
const path = require('path');

const IOS_DIR = path.join(__dirname, '..', 'ios', 'Dosar');
const APP_DELEGATE_PATH = path.join(IOS_DIR, 'AppDelegate.swift');
const SCENE_DELEGATE_PATH = path.join(IOS_DIR, 'SceneDelegate.swift');
const PBXPROJ_PATH = path.join(__dirname, '..', 'ios', 'Dosar.xcodeproj', 'project.pbxproj');

const SCENE_DELEGATE_CONTENT = `import CloudKit
internal import ExpoCloudKitShare
import UIKit

/**
 * Adăugat exclusiv pentru acceptarea CKShare (vezi scripts/patch-cloudkit-scene-delegate.js).
 * Pe iOS modern, \`UIApplicationDelegate.application(_:userDidAcceptCloudKitShareWith:)\`
 * NU mai e apelat — acceptarea trece prin scene delegate (confirmat pe device
 * 2026-07-29 via syslog: "Received action(s) in scene-create/scene-update").
 *
 * \`UIApplicationSceneManifest\` fiind prezent, UIKit ne cere să creăm fereastra AICI
 * (nu mai există fallback pe AppDelegate.window) — de-aici bootstrap-ul RN mutat din
 * AppDelegate.didFinishLaunchingWithOptions (care doar pregătește
 * reactNativeDelegate/reactNativeFactory, fără fereastră).
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)

    // Lansare la rece prin link CKShare (app-ul nu rula încă).
    if let metadata = connectionOptions.cloudKitShareMetadata {
      ExpoCloudKitShareAppDelegate().application(
        UIApplication.shared, userDidAcceptCloudKitShareWith: metadata)
    }
  }

  // App-ul rulează deja (foreground sau fundal) când userul acceptă link-ul.
  // Selectorul ObjC brut din UIWindowScene.h e
  // \`windowScene:userDidAcceptCloudKitShareWithMetadata:\`, dar Apple îl
  // redenumește pentru Swift via NS_SWIFT_NAME — compilatorul confirmă explicit
  // (eroare "has been renamed to") că numele Swift corect e cel de mai jos,
  // fără "Metadata" în label.
  @objc func windowScene(
    _ windowScene: UIWindowScene,
    userDidAcceptCloudKitShareWith cloudKitShareMetadata: CKShare.Metadata
  ) {
    ExpoCloudKitShareAppDelegate().application(
      UIApplication.shared, userDidAcceptCloudKitShareWith: cloudKitShareMetadata)
  }
}
`;

// AppDelegate: blocul de creare a ferestrei, așa cum îl generează template-ul Expo.
const OLD_WINDOW_BLOCK = [
  '#if os(iOS) || os(tvOS)',
  '    window = UIWindow(frame: UIScreen.main.bounds)',
  '    factory.startReactNative(',
  '      withModuleName: "main",',
  '      in: window,',
  '      launchOptions: launchOptions)',
  '#endif',
].join('\n');

const NEW_WINDOW_BLOCK = [
  '    // Fereastra NU se mai creează aici — UIApplicationSceneManifest (vezi',
  '    // ios/Dosar/SceneDelegate.swift) mută bootstrap-ul RN în',
  '    // scene(_:willConnectTo:options:), care are nevoie de UIWindowScene.',
  '    // factory/delegate rămân accesibile de acolo prin acest AppDelegate.',
].join('\n');

// pbxproj: ancore pe intrările existente AppDelegate.swift (stabile — parte din
// template-ul standard Expo, nu doar din patch-ul nostru).
const PBX_BUILD_FILE_ANCHOR =
  '\t\tF11748422D0307B40044C1D9 /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = F11748412D0307B40044C1D9 /* AppDelegate.swift */; };\n/* End PBXBuildFile section */';
const PBX_BUILD_FILE_NEW =
  '\t\tF11748422D0307B40044C1D9 /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = F11748412D0307B40044C1D9 /* AppDelegate.swift */; };\n\t\tF11748462D0722840044C1D9 /* SceneDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = F11748452D0722830044C1D9 /* SceneDelegate.swift */; };\n/* End PBXBuildFile section */';

const PBX_FILE_REF_ANCHOR =
  '\t\tF11748412D0307B40044C1D9 /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = Dosar/AppDelegate.swift; sourceTree = "<group>"; };';
const PBX_FILE_REF_NEW =
  '\t\tF11748412D0307B40044C1D9 /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = Dosar/AppDelegate.swift; sourceTree = "<group>"; };\n\t\tF11748452D0722830044C1D9 /* SceneDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = SceneDelegate.swift; path = Dosar/SceneDelegate.swift; sourceTree = "<group>"; };';

const PBX_GROUP_ANCHOR =
  '\t\t\t\tF11748412D0307B40044C1D9 /* AppDelegate.swift */,\n\t\t\t\tF11748442D0722820044C1D9 /* Dosar-Bridging-Header.h */,';
const PBX_GROUP_NEW =
  '\t\t\t\tF11748412D0307B40044C1D9 /* AppDelegate.swift */,\n\t\t\t\tF11748452D0722830044C1D9 /* SceneDelegate.swift */,\n\t\t\t\tF11748442D0722820044C1D9 /* Dosar-Bridging-Header.h */,';

const PBX_SOURCES_ANCHOR =
  '\t\t\t\tF11748422D0307B40044C1D9 /* AppDelegate.swift in Sources */,\n\t\t\t\t14B3409614B9541A387AFE67 /* ExpoModulesProvider.swift in Sources */,';
const PBX_SOURCES_NEW =
  '\t\t\t\tF11748422D0307B40044C1D9 /* AppDelegate.swift in Sources */,\n\t\t\t\tF11748462D0722840044C1D9 /* SceneDelegate.swift in Sources */,\n\t\t\t\t14B3409614B9541A387AFE67 /* ExpoModulesProvider.swift in Sources */,';

function patchAppDelegate() {
  if (!fs.existsSync(APP_DELEGATE_PATH)) {
    console.log('[patch-cloudkit-scene-delegate] ios/Dosar/AppDelegate.swift nu există — sar peste.');
    return false;
  }
  const content = fs.readFileSync(APP_DELEGATE_PATH, 'utf8');
  if (content.includes(NEW_WINDOW_BLOCK)) {
    console.log('[patch-cloudkit-scene-delegate] AppDelegate.swift deja patch-uit.');
    return true;
  }
  if (!content.includes(OLD_WINDOW_BLOCK)) {
    console.error(
      '[patch-cloudkit-scene-delegate] ✗ Ancora blocului de fereastră nu a fost găsită în AppDelegate.swift.\n' +
        'Template-ul Expo s-a schimbat — actualizează acest script.'
    );
    process.exit(1);
  }
  fs.writeFileSync(APP_DELEGATE_PATH, content.split(OLD_WINDOW_BLOCK).join(NEW_WINDOW_BLOCK), 'utf8');
  console.log('[patch-cloudkit-scene-delegate] ✓ AppDelegate.swift — creare fereastră mutată în SceneDelegate.');
  return true;
}

function writeSceneDelegate() {
  if (!fs.existsSync(IOS_DIR)) {
    console.log('[patch-cloudkit-scene-delegate] ios/Dosar/ nu există — sar peste.');
    return false;
  }
  const existing = fs.existsSync(SCENE_DELEGATE_PATH)
    ? fs.readFileSync(SCENE_DELEGATE_PATH, 'utf8')
    : null;
  if (existing === SCENE_DELEGATE_CONTENT) {
    console.log('[patch-cloudkit-scene-delegate] SceneDelegate.swift deja la zi.');
    return true;
  }
  fs.writeFileSync(SCENE_DELEGATE_PATH, SCENE_DELEGATE_CONTENT, 'utf8');
  console.log('[patch-cloudkit-scene-delegate] ✓ SceneDelegate.swift scris.');
  return true;
}

function patchPbxproj() {
  if (!fs.existsSync(PBXPROJ_PATH)) {
    console.log('[patch-cloudkit-scene-delegate] project.pbxproj nu există — sar peste.');
    return;
  }
  let content = fs.readFileSync(PBXPROJ_PATH, 'utf8');
  if (content.includes('SceneDelegate.swift')) {
    console.log('[patch-cloudkit-scene-delegate] project.pbxproj deja înregistrează SceneDelegate.swift.');
    return;
  }
  const anchors = [
    [PBX_BUILD_FILE_ANCHOR, PBX_BUILD_FILE_NEW, 'PBXBuildFile'],
    [PBX_FILE_REF_ANCHOR, PBX_FILE_REF_NEW, 'PBXFileReference'],
    [PBX_GROUP_ANCHOR, PBX_GROUP_NEW, 'grup Dosar'],
    [PBX_SOURCES_ANCHOR, PBX_SOURCES_NEW, 'Sources build phase'],
  ];
  for (const [anchor, , label] of anchors) {
    if (!content.includes(anchor)) {
      console.error(
        `[patch-cloudkit-scene-delegate] ✗ Ancora „${label}" nu a fost găsită în project.pbxproj.\n` +
          'Structura proiectului Xcode s-a schimbat — actualizează acest script (sau adaugă manual SceneDelegate.swift în Xcode: File > Add Files, bifează target-ul Dosar).'
      );
      process.exit(1);
    }
  }
  for (const [anchor, replacement] of anchors) {
    content = content.split(anchor).join(replacement);
  }
  fs.writeFileSync(PBXPROJ_PATH, content, 'utf8');
  console.log('[patch-cloudkit-scene-delegate] ✓ project.pbxproj — SceneDelegate.swift înregistrat în target-ul Dosar.');
}

function main() {
  const appDelegateOk = patchAppDelegate();
  const sceneDelegateOk = writeSceneDelegate();
  if (appDelegateOk && sceneDelegateOk) patchPbxproj();
}

main();
