import ExpoModulesCore
import CloudKit
import UIKit

/**
 * CloudKit zone sharing (CKShare) — Increment 2: motor live (fetch incremental
 * cu token, push granular per-record cu LWW, silent push via CKDatabaseSubscription).
 * Vezi docs/superpowers/plans/2026-07-27-cloudkit-bidirectional-sharing.md.
 *
 * Deployment target iOS 16 → CKDatabase manual (NU CKSyncEngine, care cere iOS 17).
 *
 * ⚠️ Fluxul CloudKit real (push/pull între două conturi, silent push) rămâne
 * UNVERIFIED on-device fără un al doilea cont iCloud — validare reală = TestFlight
 * pe două telefoane.
 */
public class ExpoCloudKitShareModule: Module {
  private let container = CKContainer(identifier: "iCloud.com.ax.documente")

  public func definition() -> ModuleDefinition {
    Name("ExpoCloudKitShare")

    Events("onRemoteChange")

    // Silent push CloudKit (AppDelegate → NotificationCenter) + schimbare de cont
    // iCloud — ambele re-emise ca „onRemoteChange" către JS, care doar re-rulează
    // syncSharedEntities() (guard-ul isCloudKitAvailable() de acolo tratează și
    // pauza/re-verificarea de cont).
    OnCreate {
      NotificationCenter.default.addObserver(
        forName: Notification.Name("ExpoCloudKitShareRemoteChange"), object: nil, queue: nil
      ) { _ in
        self.sendEvent("onRemoteChange", ["reason": "push"])
      }
      NotificationCenter.default.addObserver(
        forName: .CKAccountChanged, object: nil, queue: nil
      ) { _ in
        self.sendEvent("onRemoteChange", ["reason": "accountChanged"])
      }
    }

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
    // Creează o zonă custom în private DB. O zonă per entitate partajată.
    AsyncFunction("createSharedZone") { (zoneName: String) async throws -> [String: Any] in
      let zone = CKRecordZone(zoneName: zoneName)
      let db = self.container.privateCloudDatabase
      let (saveResults, _) = try await db.modifyRecordZones(saving: [zone], deleting: [])
      for (_, result) in saveResults { _ = try result.get() }
      return ["zoneName": zoneName]
    }

    // ─── putRecord ───────────────────────────────────────────────────────
    // Fetch-or-create + salvare. Câmpuri string. Nu suprascrie orb changeTag-ul —
    // citim recordul existent înainte.
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
      applyFields(fields, to: record)

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
    // Prezintă invitația nativă pe zonă. Dacă zona e deja partajată, reprezintă
    // share-ul EXISTENT (`CKRecordNameZoneWideShare`) — crearea unui al doilea
    // CKShare pe aceeași zonă eșuează. Promise callback-style fiindcă prezentarea
    // UI trebuie pe main thread.
    AsyncFunction("shareZone") { (options: [String: Any], promise: Promise) in
      guard let zoneName = options["zoneName"] as? String else {
        promise.reject(makeError(3, "zoneName obligatoriu"))
        return
      }
      let title = (options["title"] as? String) ?? "Entitate Dosar"
      let permission = (options["permission"] as? String) ?? "read"
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)

      Task {
        do {
          let db = self.container.privateCloudDatabase
          let existingShareID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID)

          let share: CKShare
          if let existingRecord = try? await db.record(for: existingShareID),
             let existingShare = existingRecord as? CKShare {
            share = existingShare
          } else {
            let newShare = CKShare(recordZoneID: zoneID)
            newShare[CKShare.SystemFieldKey.title] = title as CKRecordValue
            // Permisiunea se stabilește DOAR la crearea share-ului nou (Faza 2:
            // alegere „Doar citire"/„Poate edita" la share). Re-share pe zonă deja
            // partajată (ramura de mai sus) NU o schimbă retroactiv — nu există UI
            // pentru asta încă.
            newShare.publicPermission = permission == "readwrite" ? .readWrite : .readOnly
            let (saveResults, _) = try await db.modifyRecords(saving: [newShare], deleting: [])
            for (_, result) in saveResults { _ = try result.get() }
            share = newShare
          }

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

    // ─── acceptShareURL ──────────────────────────────────────────────────
    // Fallback manual: acceptă un CKShare direct dintr-un URL lipit de user,
    // fără să depindă de handler-ul de sistem (windowScene(_:userDidAcceptCloudKitShareWith:)
    // — verificat pe device 2026-07-29 că nu se apelează deloc pe iOS 26.5.2,
    // deși iOS confirmă acceptarea la nivel de sistem). Semnături verificate
    // direct în CKContainer.h: fetchShareMetadataWithURL:completionHandler:
    // (NS_SWIFT_ASYNC_NAME shareMetadata(for:)) + acceptShareMetadata:.
    AsyncFunction("acceptShareURL") { (urlString: String) async throws -> [String: Any] in
      guard let url = URL(string: urlString) else {
        throw makeError(14, "URL invalid")
      }
      let metadata = try await self.container.shareMetadata(for: url)
      let accepted = try await self.container.accept(metadata)
      var result: [String: Any] = [
        "zoneName": accepted.recordID.zoneID.zoneName,
        "ownerName": accepted.recordID.zoneID.ownerName,
      ]
      // `metadata.ownerIdentity` e disponibil direct din fetch-ul share-ului —
      // nu necesită un apel separat. Poate fi nil dacă owner-ul nu e descoperibil
      // (fără contact/profil public) — atunci UI-ul cade pe fallback-ul existent.
      if let displayName = Self.formatUserIdentity(metadata.ownerIdentity) {
        result["ownerDisplayName"] = displayName
      }
      // Titlul (= numele entității, setat de owner la `shareZone`) e singurul nume
      // afișabil al entității înainte de primul pull reușit.
      if let title = Self.shareTitle(accepted) ?? Self.shareTitle(metadata.share) {
        result["title"] = title
      }
      // Permisiunea REALĂ a participantului. Fără ea, JS presupune 'read' și un
      // share „Poate edita" rămâne read-only pe device-ul participantului (UI
      // blocat + push-back refuzat de `pushLocalChange`).
      if let permission = Self.permissionString(accepted) ?? Self.permissionString(metadata.share) {
        result["permission"] = permission
      }
      return result
    }

    // ─── fetchShareInfo ──────────────────────────────────────────────────
    // Best-effort, pentru zone descoperite prin `listSharedZones()` (nu prin
    // `acceptShareURL`, care are deja totul din metadata) — cazul normal când
    // sistemul acceptă share-ul singur, la tap pe link. Fetch-uiește CKShare-ul
    // zonei: numele owner-ului, titlul (= numele entității) și permisiunea mea.
    // Fiecare cheie lipsește din rezultat dacă nu e determinabilă — JS păstrează
    // atunci valoarea deja cunoscută, nu o suprascrie cu un default greșit.
    AsyncFunction("fetchShareInfo") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String else {
        throw makeError(16, "zoneName obligatoriu")
      }
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)
      let shareID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID)
      guard let record = try? await self.container.sharedCloudDatabase.record(for: shareID),
            let share = record as? CKShare else {
        return [:]
      }
      var result: [String: Any] = [:]
      if let displayName = Self.formatUserIdentity(share.owner.userIdentity) {
        result["ownerDisplayName"] = displayName
      }
      if let title = Self.shareTitle(share) {
        result["title"] = title
      }
      if let permission = Self.permissionString(share) {
        result["permission"] = permission
      }
      return result
    }

    // ─── fetchZoneChanges ────────────────────────────────────────────────
    // Pull incremental dintr-o zonă (scope 'private' owner / 'shared' participant),
    // cu `sinceToken` → `newToken`. Loop `moreComing`; pe `.changeTokenExpired`
    // resetează tokenul (o singură dată) și reia full-fetch.
    AsyncFunction("fetchZoneChanges") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String else {
        throw makeError(12, "zoneName obligatoriu")
      }
      let scope = (options["scope"] as? String) ?? "shared"
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let db = scope == "private" ? self.container.privateCloudDatabase : self.container.sharedCloudDatabase
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)

      var token = decodeToken(options["sinceToken"] as? String)
      var records: [[String: Any]] = []
      var deletedNames: [String] = []
      var expiredRetried = false

      while true {
        do {
          var moreComing = true
          while moreComing {
            let result = try await db.recordZoneChanges(inZoneWith: zoneID, since: token)
            for modification in result.modificationResultsByID.values {
              guard let record = try? modification.get().record else { continue }
              // Record-urile de sistem CloudKit (`cloudkit.share` etc.) nu sunt
              // date de-ale noastre.
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
            deletedNames.append(contentsOf: result.deletions.map { $0.recordID.recordName })
            token = result.changeToken
            moreComing = result.moreComing
          }
          break
        } catch let error as CKError where error.code == .changeTokenExpired && !expiredRetried {
          expiredRetried = true
          token = nil
          records = []
          deletedNames = []
        }
      }

      return [
        "records": records,
        "deletedRecordNames": deletedNames,
        "newToken": encodeTokenValue(token),
      ]
    }

    // ─── fetchDatabaseChanges ────────────────────────────────────────────
    // Ce ZONE s-au schimbat/dispărut într-o bază (private/shared), fără să le
    // viziteze pe toate — token DB-level, SEPARAT de tokenul per-zonă.
    AsyncFunction("fetchDatabaseChanges") { (options: [String: Any]) async throws -> [String: Any] in
      let scope = (options["scope"] as? String) ?? "shared"
      let db = scope == "private" ? self.container.privateCloudDatabase : self.container.sharedCloudDatabase

      var token = decodeToken(options["sinceToken"] as? String)
      var changed: [[String: Any]] = []
      var deleted: [[String: Any]] = []
      var expiredRetried = false

      while true {
        do {
          var moreComing = true
          while moreComing {
            let result = try await db.databaseChanges(since: token)
            changed.append(contentsOf: result.modifications.map {
              ["zoneName": $0.zoneID.zoneName, "ownerName": $0.zoneID.ownerName]
            })
            deleted.append(contentsOf: result.deletions.map {
              ["zoneName": $0.zoneID.zoneName, "ownerName": $0.zoneID.ownerName]
            })
            token = result.changeToken
            moreComing = result.moreComing
          }
          break
        } catch let error as CKError where error.code == .changeTokenExpired && !expiredRetried {
          expiredRetried = true
          token = nil
          changed = []
          deleted = []
        }
      }

      return ["changedZones": changed, "deletedZones": deleted, "newToken": encodeTokenValue(token)]
    }

    // ─── pushRecords ─────────────────────────────────────────────────────
    // Push granular per-record (create/update individual) + ștergeri. LWW pe
    // conflict (`.serverRecordChanged` → merge câmpurile noastre pe server record,
    // re-save, max 3 încercări); `.zoneBusy`/`.requestRateLimited` → respectă
    // `retryAfterSeconds` (contor SEPARAT de cel de conflict). Chunk ≤400/apel.
    // CKAsset: `files[].path` → asset nou; `files[].unchanged` → asset existent
    // neatins; orice cheie `file_*` de pe record absentă din `files[]` → ștearsă
    // (altfel o pagină eliminată local lasă un CKAsset orfan pe server).
    // Rezultate PER-RECORD — un eșec izolat nu pică tot batch-ul.
    AsyncFunction("pushRecords") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String else {
        throw makeError(13, "zoneName obligatoriu")
      }
      let scope = (options["scope"] as? String) ?? "private"
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let db = scope == "private" ? self.container.privateCloudDatabase : self.container.sharedCloudDatabase
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)

      let inputRecords = options["records"] as? [[String: Any]] ?? []
      let deletionNames = options["deletions"] as? [String] ?? []

      var toSave: [CKRecord] = []
      for rec in inputRecords {
        guard let recordName = rec["recordName"] as? String,
              let recordType = rec["recordType"] as? String else { continue }
        let recordID = CKRecord.ID(recordName: recordName, zoneID: zoneID)
        let record = (try? await db.record(for: recordID)) ?? CKRecord(recordType: recordType, recordID: recordID)
        applyFields(rec["fields"] as? [String: String] ?? [:], to: record)

        let files = rec["files"] as? [[String: Any]] ?? []
        var desiredKeys = Set<String>()
        for file in files {
          guard let key = file["key"] as? String else { continue }
          desiredKeys.insert(key)
          if let unchanged = file["unchanged"] as? Bool, unchanged { continue }
          guard let path = file["path"] as? String else { continue }
          let localPath = path.replacingOccurrences(of: "file://", with: "")
          if FileManager.default.fileExists(atPath: localPath) {
            record[key] = CKAsset(fileURL: URL(fileURLWithPath: localPath))
          }
        }
        // Curăță CKAsset-uri orfane (pagini eliminate local de la ultimul push).
        for key in record.allKeys() where key.hasPrefix("file_") && !desiredKeys.contains(key) {
          record[key] = nil
        }
        toSave.append(record)
      }

      var succeeded: [String: String] = [:]
      var failed: [String: String] = [:]

      for chunk in toSave.dosarChunked(into: 400) {
        await self.pushChunk(db: db, records: chunk, succeeded: &succeeded, failed: &failed, attempt: 1)
      }

      let deletionIDs = deletionNames.map { CKRecord.ID(recordName: $0, zoneID: zoneID) }
      for chunk in deletionIDs.dosarChunked(into: 400) {
        do {
          let (_, deleteResults) = try await db.modifyRecords(saving: [], deleting: chunk, savePolicy: .ifServerRecordUnchanged, atomically: false)
          for (id, result) in deleteResults {
            switch result {
            case .success:
              succeeded[id.recordName] = "deleted"
            case .failure(let error):
              // Deja șters pe server → succes silențios, nu eroare.
              if let ckError = error as? CKError, ckError.code == .unknownItem {
                succeeded[id.recordName] = "deleted"
              } else {
                failed[id.recordName] = error.localizedDescription
              }
            }
          }
        } catch {
          for id in chunk { failed[id.recordName] = error.localizedDescription }
        }
      }

      return ["succeeded": succeeded, "failed": failed]
    }

    // ─── subscribeDatabase ───────────────────────────────────────────────
    // CKDatabaseSubscription (NU zone subscription — nesuportat în shared/public
    // DB), una per DB, cu silent push (`shouldSendContentAvailable`).
    AsyncFunction("subscribeDatabase") { (options: [String: Any]) async throws -> [String: Any] in
      let scope = (options["scope"] as? String) ?? "shared"
      let db = scope == "private" ? self.container.privateCloudDatabase : self.container.sharedCloudDatabase
      let subscription = CKDatabaseSubscription(subscriptionID: "\(scope)-db-changes")
      let info = CKSubscription.NotificationInfo()
      info.shouldSendContentAvailable = true
      subscription.notificationInfo = info
      let (saveResults, _) = try await db.modifySubscriptions(saving: [subscription], deleting: [])
      for (_, result) in saveResults { _ = try result.get() }
      return ["subscribed": true]
    }

    // ─── stopSharing ─────────────────────────────────────────────────────
    // Owner side: șterge CKShare-ul zonei → participanții pierd accesul
    // (forward-only). Datele rămân la owner.
    AsyncFunction("stopSharing") { (zoneName: String) async throws -> [String: Any] in
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
      let shareID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID)
      let (_, deleteResults) = try await self.container.privateCloudDatabase.modifyRecords(
        saving: [], deleting: [shareID]
      )
      for (_, r) in deleteResults { _ = try r.get() }
      return ["revoked": true]
    }

    // ─── leaveShare ──────────────────────────────────────────────────────
    // Participant side: renunță la accesul propriu. Ștergerea zonei direct
    // din `sharedCloudDatabase` e respinsă de CloudKit („Zone delete not
    // allowed") — mecanismul corect e ștergerea recordului CKShare din shared
    // DB, pe care CloudKit îl interpretează ca auto-eliminare a participantului
    // (owner-ul și restul participanților rămân neafectați). Owner-ul rulează
    // simetricul pe `privateCloudDatabase` (`stopSharing` mai sus).
    AsyncFunction("leaveShare") { (options: [String: Any]) async throws -> [String: Any] in
      guard let zoneName = options["zoneName"] as? String else {
        throw makeError(15, "zoneName obligatoriu")
      }
      let ownerName = (options["ownerName"] as? String) ?? CKCurrentUserDefaultName
      let zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: ownerName)
      let shareID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID)
      let (_, deleteResults) = try await self.container.sharedCloudDatabase.modifyRecords(
        saving: [], deleting: [shareID]
      )
      for (_, r) in deleteResults { _ = try r.get() }
      return ["left": true]
    }
  }

  // MARK: - pushRecords helper

  // Recursiv: trimite un chunk, colectează succese, pe `.serverRecordChanged`
  // reîncearcă DOAR recordurile în conflict (merge pe server record), max 3
  // încercări; pe `.zoneBusy`/`.requestRateLimited` reîncearcă tot chunk-ul după
  // `retryAfterSeconds` (contor separat — nu consumă din cele 3 încercări LWW).
  private func pushChunk(
    db: CKDatabase,
    records: [CKRecord],
    succeeded: inout [String: String],
    failed: inout [String: String],
    attempt: Int
  ) async {
    do {
      let (saveResults, _) = try await db.modifyRecords(
        saving: records, deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: false
      )
      var retryRecords: [CKRecord] = []
      for (id, result) in saveResults {
        switch result {
        case .success(let saved):
          succeeded[id.recordName] = saved.recordChangeTag ?? ""
        case .failure(let error):
          if let ckError = error as? CKError, ckError.code == .serverRecordChanged,
             attempt < 3,
             let serverRecord = ckError.userInfo[CKRecordChangedErrorServerRecordKey] as? CKRecord,
             let ours = records.first(where: { $0.recordID == id }) {
            for key in ours.allKeys() { serverRecord[key] = ours[key] }
            retryRecords.append(serverRecord)
          } else {
            failed[id.recordName] = error.localizedDescription
          }
        }
      }
      if !retryRecords.isEmpty {
        await pushChunk(db: db, records: retryRecords, succeeded: &succeeded, failed: &failed, attempt: attempt + 1)
      }
    } catch let error as CKError where error.code == .zoneBusy || error.code == .requestRateLimited {
      let delay = error.retryAfterSeconds ?? 2
      try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
      await pushChunk(db: db, records: records, succeeded: &succeeded, failed: &failed, attempt: attempt)
    } catch {
      for record in records { failed[record.recordID.recordName] = error.localizedDescription }
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
    // .allowPublic ESTE necesar: fluxul de acceptare al aplicației e link-paste
    // (`acceptShareURL`), nu invitație pe contact — fără el, sheet-ul forțează
    // modul „doar persoane invitate", unde `share.publicPermission` (setat mai
    // sus după alegerea „Doar citire"/„Poate edita") e ignorat de CloudKit, iar
    // participantul primește read-only implicit indiferent de alegere.
    controller.availablePermissions = [.allowPublic, .allowPrivate, .allowReadOnly, .allowReadWrite]

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

  /**
   * Nume afișabil dintr-un `CKUserIdentity` — folosit pentru „partajat de la ...".
   * NU confunda cu `CKRecordZone.ID.ownerName` (identificator opac CloudKit,
   * niciodată un nume) — acela rămâne folosit strict pentru construcția
   * `CKRecordZone.ID`/`CKRecord.ID` în celelalte funcții din acest modul.
   * `nameComponents` poate lipsi dacă owner-ul nu e descoperibil (fără contact/
   * profil public) — atunci încercăm email/telefon din `lookupInfo`, altfel nil.
   */
  private static func formatUserIdentity(_ identity: CKUserIdentity?) -> String? {
    guard let identity = identity else { return nil }
    if let components = identity.nameComponents {
      let formatted = PersonNameComponentsFormatter.localizedString(from: components, style: .default)
      if !formatted.isEmpty { return formatted }
    }
    if let email = identity.lookupInfo?.emailAddress { return email }
    if let phone = identity.lookupInfo?.phoneNumber { return phone }
    return nil
  }

  /** Titlul share-ului (`CKShare.SystemFieldKey.title`) — setat de owner la `shareZone` = numele entității. */
  private static func shareTitle(_ share: CKShare) -> String? {
    guard let title = share[CKShare.SystemFieldKey.title] as? String, !title.isEmpty else {
      return nil
    }
    return title
  }

  /**
   * Permisiunea EFECTIVĂ a userului curent pe un share primit: participantul
   * propriu dacă e determinat, altfel permisiunea publică a link-ului (fluxul
   * acestei aplicații e link-paste, unde accesul vine din `publicPermission`).
   * `nil` = nedeterminabilă → apelantul păstrează ce știe deja.
   */
  private static func permissionString(_ share: CKShare) -> String? {
    var effective = share.currentUserParticipant?.permission ?? .unknown
    if effective != .readOnly && effective != .readWrite {
      effective = share.publicPermission
    }
    switch effective {
    case .readWrite: return "readwrite"
    case .readOnly: return "read"
    default: return nil
    }
  }

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

// MARK: - CKServerChangeToken (de)serialization

/** `NSKeyedArchiver` base64 — reprezentarea pe care JS-ul o pasează înapoi ca `sinceToken`. */
private func encodeTokenValue(_ token: CKServerChangeToken?) -> Any {
  guard let token = token,
        let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
  else {
    return NSNull()
  }
  return data.base64EncodedString()
}

private func decodeToken(_ base64: String?) -> CKServerChangeToken? {
  guard let base64 = base64, let data = Data(base64Encoded: base64) else { return nil }
  return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
}

// MARK: - Chunking

private extension Array {
  /** Prefix `dosar` — evită coliziune cu vreun `chunked` adăugat de o dependință viitoare. */
  func dosarChunked(into size: Int) -> [[Element]] {
    guard size > 0, !isEmpty else { return isEmpty ? [] : [self] }
    return stride(from: 0, to: count, by: size).map {
      Array(self[$0..<Swift.min($0 + size, count)])
    }
  }
}
