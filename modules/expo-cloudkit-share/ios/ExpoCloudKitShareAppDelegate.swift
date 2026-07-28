import ExpoModulesCore
import CloudKit
import UIKit

/**
 * Wiring pentru sharing live (Increment 2):
 *   - `didFinishLaunchingWithOptions` → înregistrează pentru remote notifications
 *     (necesar ca `CKDatabaseSubscription` din modul să livreze silent push).
 *   - `didReceiveRemoteNotification` → silent push CloudKit → postează
 *     `ExpoCloudKitShareRemoteChange`, pe care modulul îl re-emite ca JS event
 *     `onRemoteChange`.
 *   - `userDidAcceptCloudKitShareWith` → acceptă share-ul primit prin link, apoi
 *     postează același notification ca participantul să tragă imediat.
 *
 * `ExpoAppDelegate` (baza din pachetul `expo`) face fan-out la toate cele trei
 * metode către fiecare `ExpoAppDelegateSubscriber` — verificat în
 * `node_modules/expo-modules-core/ios/AppDelegates/ExpoAppDelegateSubscriberManager.swift`,
 * fără nicio modificare necesară în `AppDelegate.swift` propriu al proiectului.
 *
 * ⚠️ UNVERIFIED on-device — necesită al 2-lea cont iCloud pentru test real.
 */
public class ExpoCloudKitShareAppDelegate: ExpoAppDelegateSubscriber {
  private let container = CKContainer(identifier: "iCloud.com.ax.documente")

  private static let remoteChangeNotification = Notification.Name("ExpoCloudKitShareRemoteChange")

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    application.registerForRemoteNotifications()
    return true
  }

  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    NotificationCenter.default.post(name: Self.remoteChangeNotification, object: nil)
    completionHandler(.newData)
  }

  public func application(
    _ application: UIApplication,
    userDidAcceptCloudKitShareWith metadata: CKShare.Metadata
  ) {
    Task {
      do {
        _ = try await container.accept(metadata)
        NSLog("[ExpoCloudKitShare] share acceptat: zona \(metadata.share.recordID.zoneID.zoneName)")
        await MainActor.run {
          NotificationCenter.default.post(name: Self.remoteChangeNotification, object: nil)
        }
      } catch {
        NSLog("[ExpoCloudKitShare] accept share eșuat: \(error.localizedDescription)")
      }
    }
  }
}
