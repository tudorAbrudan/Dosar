import ExpoModulesCore
import CoreImage
import UIKit
import Vision

public class ExpoPerspectiveCropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPerspectiveCrop")

    // ─── cropPerspective ─────────────────────────────────────────────────
    // Aplică perspective correction folosind CIPerspectiveCorrection.
    // Input: { uri, corners: {topLeft, topRight, bottomRight, bottomLeft}, quality? }
    // Output: { uri, width, height }
    AsyncFunction("cropPerspective") { (options: [String: Any]) -> [String: Any] in
      guard let uriString = options["uri"] as? String else {
        throw makeError(1, "uri obligatoriu")
      }
      guard let cornersDict = options["corners"] as? [String: [String: Double]] else {
        throw makeError(2, "corners obligatoriu")
      }
      let quality = (options["quality"] as? Int) ?? 95
      let url = parseURL(uriString)

      guard let uiImage = UIImage(contentsOfFile: url.path) else {
        throw makeError(3, "Nu s-a putut citi imaginea")
      }
      guard let cgImage = normalizedCGImage(uiImage) else {
        throw makeError(4, "Nu s-a putut normaliza orientarea imaginii")
      }
      let ciImage = CIImage(cgImage: cgImage)
      let imageHeight = ciImage.extent.height

      func point(_ key: String) -> CIVector {
        guard let p = cornersDict[key], let x = p["x"], let y = p["y"] else {
          return CIVector(x: 0, y: 0)
        }
        // JS folosește origine top-left; CoreImage folosește bottom-left.
        return CIVector(x: x, y: imageHeight - y)
      }

      guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
        throw makeError(5, "Filtrul CIPerspectiveCorrection indisponibil")
      }
      filter.setValue(ciImage, forKey: kCIInputImageKey)
      filter.setValue(point("topLeft"), forKey: "inputTopLeft")
      filter.setValue(point("topRight"), forKey: "inputTopRight")
      filter.setValue(point("bottomRight"), forKey: "inputBottomRight")
      filter.setValue(point("bottomLeft"), forKey: "inputBottomLeft")

      guard let output = filter.outputImage else {
        throw makeError(6, "Filtrul perspective a eșuat")
      }

      let context = CIContext(options: nil)
      guard let outCG = context.createCGImage(output, from: output.extent) else {
        throw makeError(7, "Rendering CGImage eșuat")
      }

      let outImage = UIImage(cgImage: outCG)
      guard let jpeg = outImage.jpegData(compressionQuality: CGFloat(quality) / 100.0) else {
        throw makeError(8, "Encoding JPEG eșuat")
      }

      let tmpURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("crop_\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
      try jpeg.write(to: tmpURL)

      return [
        "uri": tmpURL.absoluteString,
        "width": Int(output.extent.width),
        "height": Int(output.extent.height),
      ]
    }

    // ─── detectCorners ───────────────────────────────────────────────────
    // VNDetectDocumentSegmentationRequest (iOS 15+). Returnează cele 4 colțuri
    // ale celui mai încrezător observation. Dacă nimic e detectat, returnează
    // { corners: null, confidence: 0 } — apelantul JS folosește atunci default-ul.
    AsyncFunction("detectCorners") { (uriString: String) -> [String: Any] in
      let empty: [String: Any] = ["corners": NSNull(), "confidence": 0.0]
      let url = parseURL(uriString)
      guard let uiImage = UIImage(contentsOfFile: url.path),
            let cgImage = normalizedCGImage(uiImage) else {
        return empty
      }
      let width = CGFloat(cgImage.width)
      let height = CGFloat(cgImage.height)

      let request = VNDetectDocumentSegmentationRequest()
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
      do {
        try handler.perform([request])
      } catch {
        return empty
      }

      guard let observations = request.results as? [VNRectangleObservation],
            let best = observations.max(by: { $0.confidence < $1.confidence }) else {
        return empty
      }

      // Vision returnează coordonate normalizate [0,1] cu origine bottom-left.
      // Convertim la pixeli cu origine top-left (cum folosește JS-ul).
      func toPixel(_ p: CGPoint) -> [String: Double] {
        return [
          "x": Double(p.x * width),
          "y": Double((1.0 - p.y) * height),
        ]
      }

      return [
        "corners": [
          "topLeft": toPixel(best.topLeft),
          "topRight": toPixel(best.topRight),
          "bottomRight": toPixel(best.bottomRight),
          "bottomLeft": toPixel(best.bottomLeft),
        ],
        "confidence": Double(best.confidence),
      ]
    }
  }
}

// MARK: - Helpers

private func makeError(_ code: Int, _ message: String) -> NSError {
  return NSError(
    domain: "ExpoPerspectiveCrop",
    code: code,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}

private func parseURL(_ s: String) -> URL {
  if let url = URL(string: s), url.scheme != nil {
    return url
  }
  return URL(fileURLWithPath: s)
}

/// Redesenează imaginea cu EXIF orientation aplicat, ca pixelii CGImage să fie
/// în orientarea de afișare (origine top-left, fără rotații implicite).
private func normalizedCGImage(_ image: UIImage) -> CGImage? {
  if image.imageOrientation == .up, let cg = image.cgImage {
    return cg
  }
  let renderer = UIGraphicsImageRenderer(size: image.size)
  let normalized = renderer.image { _ in image.draw(at: .zero) }
  return normalized.cgImage
}
