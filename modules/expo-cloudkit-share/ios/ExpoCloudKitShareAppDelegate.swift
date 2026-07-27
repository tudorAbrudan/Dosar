import ExpoModulesCore
import CloudKit
import UIKit

/**
 * Acceptă un CKShare când userul deschide link-ul de invitație. După accept,
 * zona partajată apare în `sharedCloudDatabase` (o vede `listSharedZones`).
 * Postează `ExpoCloudKitShareAccepted` ca JS-ul să declanșeze un pull.
 *
 * ⚠️ UNVERIFIED on-device — necesită al 2-lea cont iCloud pentru test real.
 */
public class ExpoCloudKitShareAppDelegate: ExpoAppDelegateSubscriber {
  private let container = CKContainer(identifier: "iCloud.com.ax.documente")

  public func application(
    _ application: UIApplication,
    userDidAcceptCloudKitShareWith metadata: CKShare.Metadata
  ) {
    Task {
      do {
        _ = try await container.accept(metadata)
        NSLog("[ExpoCloudKitShare] share acceptat: zona \(metadata.share.recordID.zoneID.zoneName)")
        await MainActor.run {
          NotificationCenter.default.post(
            name: Notification.Name("ExpoCloudKitShareAccepted"), object: nil
          )
        }
      } catch {
        NSLog("[ExpoCloudKitShare] accept share eșuat: \(error.localizedDescription)")
      }
    }
  }
}
