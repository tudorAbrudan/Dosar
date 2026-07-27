import ExpoModulesCore
import CloudKit
import UIKit

/**
 * Spike Faza 0 — dovedește round-trip CKShare între două conturi iCloud.
 *
 * Owner side (device A):
 *   isAvailable → createSharedZone → putRecord → shareZone (prezintă invitația)
 * Participant side (device B), după accept share:
 *   listSharedZones → getRecord (din sharedCloudDatabase)
 *
 * ⚠️ De verificat pe device fizic (nu pe simulator):
 *   - accountStatus == available cu 2 Apple ID-uri diferite
 *   - CKShare(recordZoneID:) funcționează pe zonă custom (zone-wide sharing)
 *   - link-ul de invitație e acceptat pe device-ul B și zona apare în shared DB
 *   - accept-handler-ul (userDidAcceptCloudKitShareWith) — wiring separat în AppDelegate
 *
 * Containerul e hardcodat la spike; în Faza 1 devine configurabil.
 */
public class ExpoCloudKitShareModule: Module {
  private let container = CKContainer(identifier: "iCloud.com.ax.documente")

  public func definition() -> ModuleDefinition {
    Name("ExpoCloudKitShare")

    // ─── isAvailable ─────────────────────────────────────────────────────
    // Statusul contului iCloud. `available` = putem folosi CloudKit DB.
    AsyncFunction("isAvailable") { () async throws -> [String: Any] in
      let status = try await self.container.accountStatus()
      return [
        "available": status == .available,
        "accountStatus": Self.accountStatusString(status),
      ]
    }

    // ─── createSharedZone ────────────────────────────────────────────────
    // Creează o zonă custom în private DB. O zonă per entitate partajată (D5).
    AsyncFunction("createSharedZone") { (zoneName: String) async throws -> [String: Any] in
      let zone = CKRecordZone(zoneName: zoneName)
      let db = self.container.privateCloudDatabase
      let (saveResults, _) = try await db.modifyRecordZones(saving: [zone], deleting: [])
      for (_, result) in saveResults { _ = try result.get() }
      return ["zoneName": zoneName]
    }

    // ─── putRecord ───────────────────────────────────────────────────────
    // Fetch-or-create + salvare. Câmpuri string (spike). Nu suprascrie orb
    // changeTag-ul — citim recordul existent înainte, ca la LWW real (D2).
    AsyncFunction("putRecord") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String,
            let recordName = options["recordName"] as? String,
            let recordType = options["recordType"] as? String else {
        throw makeError(1, "zoneName, recordName, recordType obligatorii")
      }
      let fields = options["fields"] as? [String: String] ?? [:]
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
      let recordID = CKRecord.ID(recordName: recordName, zoneID: zoneID)
      let db = self.container.privateCloudDatabase

      let record: CKRecord
      if let existing = try? await db.record(for: recordID) {
        record = existing
      } else {
        record = CKRecord(recordType: recordType, recordID: recordID)
      }
      for (key, value) in fields { record[key] = value as CKRecordValue }

      let saved = try await db.save(record)
      return [
        "recordName": saved.recordID.recordName,
        "changeTag": saved.recordChangeTag ?? "",
      ]
    }

    // ─── getRecord ───────────────────────────────────────────────────────
    // Citește dintr-o bază dată: "private" (owner) sau "shared" (participant).
    // Returnează null dacă nu există.
    AsyncFunction("getRecord") { (options: [String: Any]) async throws -> Any in
      guard let zoneName = options["zoneName"] as? String,
            let recordName = options["recordName"] as? String else {
        throw makeError(2, "zoneName, recordName obligatorii")
      }
      let scope = (options["scope"] as? String) ?? "private"
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let db = scope == "shared" ? self.container.sharedCloudDatabase
                                 : self.container.privateCloudDatabase
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)
      let recordID = CKRecord.ID(recordName: recordName, zoneID: zoneID)

      do {
        let record = try await db.record(for: recordID)
        var fields: [String: String] = [:]
        for key in record.allKeys() {
          if let s = record[key] as? String { fields[key] = s }
        }
        return [
          "recordName": record.recordID.recordName,
          "changeTag": record.recordChangeTag ?? "",
          "fields": fields,
        ]
      } catch {
        return NSNull()
      }
    }

    // ─── shareZone ───────────────────────────────────────────────────────
    // Creează CKShare pe zonă + prezintă UICloudSharingController (invitația
    // nativă). Returnează URL-ul share-ului. Promise callback-style fiindcă
    // prezentarea UI trebuie pe main thread.
    AsyncFunction("shareZone") { (options: [String: Any], promise: Promise) in
      guard let zoneName = options["zoneName"] as? String else {
        promise.reject(makeError(3, "zoneName obligatoriu"))
        return
      }
      let title = (options["title"] as? String) ?? "Entitate Dosar"
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)

      Task {
        do {
          let share = CKShare(recordZoneID: zoneID)
          share[CKShare.SystemFieldKey.title] = title as CKRecordValue
          // Link public read-only: oricine deschide link-ul (trimis pe WhatsApp/
          // Messages) intră ca participant și poate CITI. `.none` ar cere invitație
          // punctuală per Apple ID → link-ul copiat nu ar da acces. Read-only se
          // potrivește cu sync-ul one-directional actual (owner → participant);
          // când adăugăm sync bidirecțional, urcăm la `.readWrite`.
          share.publicPermission = .readOnly

          let db = self.container.privateCloudDatabase
          let (saveResults, _) = try await db.modifyRecords(saving: [share], deleting: [])
          for (_, result) in saveResults { _ = try result.get() }

          let shareURL = share.url?.absoluteString ?? ""
          await MainActor.run {
            self.presentSharingController(share: share, fallbackURL: shareURL, promise: promise)
          }
        } catch {
          promise.reject(error)
        }
      }
    }

    // ─── listSharedZones ─────────────────────────────────────────────────
    // Zonele din shared DB = share-uri acceptate de acest cont (participant).
    AsyncFunction("listSharedZones") { () async throws -> [[String: Any]] in
      let zones = try await self.container.sharedCloudDatabase.allRecordZones()
      return zones.map { zone in
        [
          "zoneName": zone.zoneID.zoneName,
          "ownerName": zone.zoneID.ownerName,
        ]
      }
    }

    // ─── pushBundle ──────────────────────────────────────────────────────
    // Owner side: creează/actualizează entity CKRecord + document CKRecords +
    // CKAsset-uri, într-o zonă. Bundle-ul vine DEJA fără private_notes/medical
    // (services/sharing.ts). Returnează change-tag per recordName.
    // ⚠️ UNVERIFIED on-device (nu există al 2-lea cont iCloud pentru test).
    AsyncFunction("pushBundle") { (bundle: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = bundle["zoneName"] as? String else {
        throw makeError(10, "zoneName obligatoriu")
      }
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
      let db = self.container.privateCloudDatabase

      let (zoneResults, _) = try await db.modifyRecordZones(
        saving: [CKRecordZone(zoneID: zoneID)], deleting: []
      )
      for (_, r) in zoneResults { _ = try r.get() }

      guard let entity = bundle["entity"] as? [String: Any],
            let entityRecordName = entity["recordName"] as? String,
            let entityRecordType = entity["recordType"] as? String else {
        throw makeError(11, "entity invalid în bundle")
      }
      let entityID = CKRecord.ID(recordName: entityRecordName, zoneID: zoneID)
      let entityRecord =
        (try? await db.record(for: entityID)) ?? CKRecord(recordType: entityRecordType, recordID: entityID)
      applyFields(entity["fields"] as? [String: String] ?? [:], to: entityRecord)

      var toSave: [CKRecord] = [entityRecord]
      for doc in bundle["documents"] as? [[String: Any]] ?? [] {
        guard let recordName = doc["recordName"] as? String else { continue }
        let recordType = (doc["recordType"] as? String) ?? "document"
        let recordID = CKRecord.ID(recordName: recordName, zoneID: zoneID)
        let record =
          (try? await db.record(for: recordID)) ?? CKRecord(recordType: recordType, recordID: recordID)
        applyFields(doc["fields"] as? [String: String] ?? [:], to: record)
        record.parent = CKRecord.Reference(recordID: entityID, action: .none)
        for file in doc["files"] as? [[String: Any]] ?? [] {
          guard let key = file["key"] as? String, let path = file["path"] as? String else { continue }
          let localPath = path.replacingOccurrences(of: "file://", with: "")
          if FileManager.default.fileExists(atPath: localPath) {
            record[key] = CKAsset(fileURL: URL(fileURLWithPath: localPath))
          }
        }
        toSave.append(record)
      }

      let (saveResults, _) = try await db.modifyRecords(saving: toSave, deleting: [])
      var changeTags: [String: String] = [:]
      for (id, result) in saveResults {
        if let rec = try? result.get() { changeTags[id.recordName] = rec.recordChangeTag ?? "" }
      }
      return ["changeTags": changeTags]
    }

    // ─── fetchZoneChanges ────────────────────────────────────────────────
    // Pull toate recordurile dintr-o zonă. scope 'private' (owner) sau 'shared'
    // (participant). CKAsset-urile se descarcă în tmp și se întorc ca path.
    // ⚠️ UNVERIFIED. Full-fetch (since: nil); incremental cu token = Faza 4.
    // ⚠️ De verificat forma `recordZoneChanges` față de SDK-ul curent pe device.
    AsyncFunction("fetchZoneChanges") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String else {
        throw makeError(12, "zoneName obligatoriu")
      }
      let scope = (options["scope"] as? String) ?? "shared"
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let db = scope == "private" ? self.container.privateCloudDatabase : self.container.sharedCloudDatabase
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)

      let result = try await db.recordZoneChanges(inZoneWith: zoneID, since: nil)
      var records: [[String: Any]] = []
      for modification in result.modificationResultsByID.values {
        guard let record = try? modification.get().record else { continue }
        // Sari record-urile de sistem CloudKit (`cloudkit.share` etc.) — nu sunt
        // date de-ale noastre și n-au câmpurile entității.
        if record.recordType.hasPrefix("cloudkit.") { continue }
        var fields: [String: String] = [:]
        var assets: [[String: String]] = []
        for key in record.allKeys() {
          if let s = record[key] as? String {
            fields[key] = s
          } else if let asset = record[key] as? CKAsset, let src = asset.fileURL {
            let dest = FileManager.default.temporaryDirectory
              .appendingPathComponent("ckasset_\(record.recordID.recordName)_\(key)")
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.copyItem(at: src, to: dest)
            assets.append(["key": key, "path": dest.path])
          }
        }
        records.append([
          "recordName": record.recordID.recordName,
          "recordType": record.recordType,
          "changeTag": record.recordChangeTag ?? "",
          "fields": fields,
          "assets": assets,
        ])
      }
      let deleted = result.deletions.map { $0.recordID.recordName }
      return ["records": records, "deletedRecordNames": deleted]
    }

    // ─── stopSharing ─────────────────────────────────────────────────────
    // Owner side: șterge CKShare-ul zonei → participanții pierd accesul
    // (forward-only). Datele rămân la owner. ⚠️ UNVERIFIED on-device.
    AsyncFunction("stopSharing") { (zoneName: String) async throws -> [String: Any] in
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
      let shareID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID)
      let (_, deleteResults) = try await self.container.privateCloudDatabase.modifyRecords(
        saving: [], deleting: [shareID]
      )
      for (_, r) in deleteResults { _ = try r.get() }
      return ["revoked": true]
    }
  }

  // MARK: - Sharing UI

  @MainActor
  private func presentSharingController(share: CKShare, fallbackURL: String, promise: Promise) {
    guard let top = Self.topViewController() else {
      // Fără context UI — întoarce totuși URL-ul ca JS-ul să-l poată trimite manual.
      promise.resolve(["shareURL": fallbackURL, "presented": false])
      return
    }
    let controller = UICloudSharingController(share: share, container: container)
    let delegate = SharingDelegate(title: (share[CKShare.SystemFieldKey.title] as? String) ?? "Dosar")
    controller.delegate = delegate
    // Reține delegate-ul cât trăiește controllerul (altfel e dealloc imediat).
    objc_setAssociatedObject(controller, &SharingDelegate.assocKey, delegate, .OBJC_ASSOCIATION_RETAIN)
    controller.availablePermissions = [.allowReadWrite, .allowPrivate]

    if let popover = controller.popoverPresentationController {
      popover.sourceView = top.view
      popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }
    top.present(controller, animated: true) {
      promise.resolve(["shareURL": fallbackURL, "presented": true])
    }
  }

  // MARK: - Helpers

  private static func accountStatusString(_ status: CKAccountStatus) -> String {
    switch status {
    case .available: return "available"
    case .noAccount: return "noAccount"
    case .restricted: return "restricted"
    case .couldNotDetermine: return "couldNotDetermine"
    case .temporarilyUnavailable: return "temporarilyUnavailable"
    @unknown default: return "unknown"
    }
  }

  @MainActor
  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .first { $0.activationState == .foregroundActive } as? UIWindowScene
    let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    var top = window?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

// MARK: - UICloudSharingControllerDelegate

private final class SharingDelegate: NSObject, UICloudSharingControllerDelegate {
  static var assocKey: UInt8 = 0
  private let title: String

  init(title: String) {
    self.title = title
  }

  func itemTitle(for csc: UICloudSharingController) -> String? {
    return title
  }

  func cloudSharingController(
    _ csc: UICloudSharingController,
    failedToSaveShareWithError error: Error
  ) {
    NSLog("[ExpoCloudKitShare] failedToSaveShare: \(error.localizedDescription)")
  }

  func cloudSharingControllerDidSaveShare(_ csc: UICloudSharingController) {
    NSLog("[ExpoCloudKitShare] didSaveShare")
  }

  func cloudSharingControllerDidStopSharing(_ csc: UICloudSharingController) {
    NSLog("[ExpoCloudKitShare] didStopSharing")
  }
}

private func makeError(_ code: Int, _ message: String) -> NSError {
  return NSError(
    domain: "ExpoCloudKitShare",
    code: code,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}

private func applyFields(_ fields: [String: String], to record: CKRecord) {
  for (key, value) in fields { record[key] = value as CKRecordValue }
}
