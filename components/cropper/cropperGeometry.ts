/**
 * Helper-e pure pentru cropper-ul de perspectivă.
 *
 * Cropper-ul lucrează în două spații de coordonate:
 *  - „display" — pixeli pe ecran, relativ la containerul de preview (cum vede userul);
 *  - „image"   — pixeli reali ai imaginii originale (cum o vede modulul nativ de crop).
 *
 * Funcțiile de aici convertesc între cele două și asigură că colțurile rămân
 * mereu în interiorul cadrului imaginii.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** Cele 4 colțuri ale crop-ului, în ordine fixă. */
export interface Quadrilateral {
  topLeft: Point2D;
  topRight: Point2D;
  bottomRight: Point2D;
  bottomLeft: Point2D;
}

export type CornerKey = keyof Quadrilateral;

export const CORNER_ORDER: readonly CornerKey[] = [
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
];

export interface Size {
  w: number;
  h: number;
}

export function displayToImage(displayPoint: Point2D, displaySize: Size, imageSize: Size): Point2D {
  const scaleX = imageSize.w / displaySize.w;
  const scaleY = imageSize.h / displaySize.h;
  return { x: displayPoint.x * scaleX, y: displayPoint.y * scaleY };
}

export function imageToDisplay(imagePoint: Point2D, displaySize: Size, imageSize: Size): Point2D {
  const scaleX = displaySize.w / imageSize.w;
  const scaleY = displaySize.h / imageSize.h;
  return { x: imagePoint.x * scaleX, y: imagePoint.y * scaleY };
}

/** Colțurile inițiale: un dreptunghi cu padding 10% pe fiecare latură. */
export function defaultCorners(imageSize: Size): Quadrilateral {
  const padX = imageSize.w * 0.1;
  const padY = imageSize.h * 0.1;
  return {
    topLeft: { x: padX, y: padY },
    topRight: { x: imageSize.w - padX, y: padY },
    bottomRight: { x: imageSize.w - padX, y: imageSize.h - padY },
    bottomLeft: { x: padX, y: imageSize.h - padY },
  };
}

/** Clamp un punct astfel încât să rămână în interiorul imaginii. */
export function clampToImage(p: Point2D, imageSize: Size): Point2D {
  return {
    x: Math.max(0, Math.min(imageSize.w, p.x)),
    y: Math.max(0, Math.min(imageSize.h, p.y)),
  };
}

/**
 * Calculează dimensiunile imaginii preview astfel încât să încapă într-un
 * container respectând aspect ratio-ul imaginii originale (echivalent
 * `resizeMode: 'contain'`).
 */
export function fitContain(imageSize: Size, container: Size): Size {
  const scale = Math.min(container.w / imageSize.w, container.h / imageSize.h);
  return { w: imageSize.w * scale, h: imageSize.h * scale };
}
