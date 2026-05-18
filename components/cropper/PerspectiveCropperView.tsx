/**
 * UI pentru ajustarea manuală a celor 4 colțuri de crop ale unei imagini.
 *
 * Randează imaginea în interiorul unui container (resizeMode='contain') și
 * suprapune un quadrilater SVG cu 4 handle-uri drag-able. Coordonatele
 * interne sunt în spațiul imaginii originale (px reali); conversia
 * display ↔ image se face cu helper-ele din `cropperGeometry`.
 *
 * Pas 1 din planul „gallery-document-scanner": doar UI-ul de ajustare,
 * fără aplicarea efectivă a transformării (modulul nativ vine în Pas 2).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type PanResponderInstance,
} from 'react-native';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';
import {
  CORNER_ORDER,
  type CornerKey,
  type Point2D,
  type Quadrilateral,
  type Size,
  clampToImage,
  defaultCorners,
  fitContain,
  imageToDisplay,
} from './cropperGeometry';

interface Props {
  imageUri: string;
  imageSize: Size;
  initialCorners?: Quadrilateral;
  onChange?: (corners: Quadrilateral) => void;
}

const HANDLE_RADIUS = 14;
const HANDLE_HIT_SLOP = HANDLE_RADIUS * 2;

export function PerspectiveCropperView({ imageUri, imageSize, initialCorners, onChange }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [containerSize, setContainerSize] = useState<Size | null>(null);
  const [corners, setCorners] = useState<Quadrilateral>(
    () => initialCorners ?? defaultCorners(imageSize)
  );

  const cornersRef = useRef(corners);
  cornersRef.current = corners;

  const dragStartRef = useRef<Point2D | null>(null);

  const previewSize = useMemo<Size | null>(() => {
    if (!containerSize) return null;
    return fitContain(imageSize, containerSize);
  }, [containerSize, imageSize]);

  function handleLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ w: width, h: height });
  }

  const displayCorners = useMemo<Record<CornerKey, Point2D> | null>(() => {
    if (!previewSize) return null;
    const map: Partial<Record<CornerKey, Point2D>> = {};
    for (const k of CORNER_ORDER) {
      map[k] = imageToDisplay(corners[k], previewSize, imageSize);
    }
    return map as Record<CornerKey, Point2D>;
  }, [corners, previewSize, imageSize]);

  const responders = useMemo<Record<CornerKey, PanResponderInstance>>(() => {
    const make = (key: CornerKey) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragStartRef.current = { ...cornersRef.current[key] };
        },
        onPanResponderMove: (_, gesture) => {
          const start = dragStartRef.current;
          if (!start || !previewSize) return;
          const scaleX = imageSize.w / previewSize.w;
          const scaleY = imageSize.h / previewSize.h;
          const next = clampToImage(
            { x: start.x + gesture.dx * scaleX, y: start.y + gesture.dy * scaleY },
            imageSize
          );
          setCorners(prev => ({ ...prev, [key]: next }));
        },
        onPanResponderRelease: () => {
          dragStartRef.current = null;
          onChange?.(cornersRef.current);
        },
        onPanResponderTerminate: () => {
          dragStartRef.current = null;
        },
      });
    return {
      topLeft: make('topLeft'),
      topRight: make('topRight'),
      bottomRight: make('bottomRight'),
      bottomLeft: make('bottomLeft'),
    };
  }, [previewSize, imageSize, onChange]);

  // Notifică onChange și la mount (cu colțurile inițiale), util pt. consumatori
  // care vor pasa rezultatul mai departe la apăsarea „Aplică".
  useEffect(() => {
    onChange?.(corners);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]} onLayout={handleLayout}>
      {previewSize && containerSize && displayCorners && (
        <View
          style={[
            styles.previewBox,
            {
              width: previewSize.w,
              height: previewSize.h,
              left: (containerSize.w - previewSize.w) / 2,
              top: (containerSize.h - previewSize.h) / 2,
            },
          ]}
        >
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <Svg
            style={StyleSheet.absoluteFill}
            width={previewSize.w}
            height={previewSize.h}
            pointerEvents="none"
          >
            <Polygon
              points={CORNER_ORDER.map(k => `${displayCorners[k].x},${displayCorners[k].y}`).join(
                ' '
              )}
              fill={`${palette.primary}33`}
              stroke={palette.primary}
              strokeWidth={2}
            />
            {CORNER_ORDER.map(k => (
              <Circle
                key={k}
                cx={displayCorners[k].x}
                cy={displayCorners[k].y}
                r={HANDLE_RADIUS}
                fill={palette.primary}
                stroke={palette.card}
                strokeWidth={3}
              />
            ))}
          </Svg>
          {CORNER_ORDER.map(k => (
            <View
              key={k}
              accessibilityLabel={`Colț ${labelForCorner(k)}`}
              {...responders[k].panHandlers}
              style={[
                styles.handleHit,
                {
                  left: displayCorners[k].x - HANDLE_HIT_SLOP,
                  top: displayCorners[k].y - HANDLE_HIT_SLOP,
                },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function labelForCorner(k: CornerKey): string {
  if (k === 'topLeft') return 'stânga sus';
  if (k === 'topRight') return 'dreapta sus';
  if (k === 'bottomRight') return 'dreapta jos';
  return 'stânga jos';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  previewBox: {
    position: 'absolute',
  },
  handleHit: {
    position: 'absolute',
    width: HANDLE_HIT_SLOP * 2,
    height: HANDLE_HIT_SLOP * 2,
    backgroundColor: 'transparent',
  },
});
