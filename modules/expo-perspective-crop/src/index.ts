import { requireNativeModule } from 'expo-modules-core';

export interface Point2D {
  x: number;
  y: number;
}

/** Cele 4 colțuri, în coordonate pixel cu origine top-left. */
export interface Quadrilateral {
  topLeft: Point2D;
  topRight: Point2D;
  bottomRight: Point2D;
  bottomLeft: Point2D;
}

export interface CropPerspectiveOptions {
  uri: string;
  corners: Quadrilateral;
  /** Calitate JPEG output (1–100). Default 95. */
  quality?: number;
}

export interface CropPerspectiveResult {
  uri: string;
  width: number;
  height: number;
}

export interface DetectCornersResult {
  /** null dacă nimic nu a fost detectat. */
  corners: Quadrilateral | null;
  /** 0–1. Sub 0.5 apelantul ar trebui să trateze ca „neutil". */
  confidence: number;
}

const NativeModule = requireNativeModule('ExpoPerspectiveCrop');

/**
 * Aplică perspective correction pe imagine: mapează cele 4 colțuri date
 * la un dreptunghi corect și returnează URI-ul imaginii rezultate.
 */
export async function cropPerspective(
  options: CropPerspectiveOptions
): Promise<CropPerspectiveResult> {
  if (!options.uri) throw new Error('cropPerspective: uri obligatoriu');
  if (!options.corners) throw new Error('cropPerspective: corners obligatoriu');
  return NativeModule.cropPerspective(options);
}

/**
 * Auto-detect cele 4 colțuri ale unui document în imagine (iOS Vision
 * Framework, VNDetectDocumentSegmentationRequest). Returnează null pe
 * confidence prea mic sau dacă nimic nu a fost detectat.
 */
export async function detectCorners(uri: string): Promise<DetectCornersResult> {
  if (!uri) throw new Error('detectCorners: uri obligatoriu');
  return NativeModule.detectCorners(uri);
}
