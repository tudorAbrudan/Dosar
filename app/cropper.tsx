/**
 * Ecran modal pentru ajustarea zonei de crop a unei imagini din galerie cu
 * perspective correction reală (CIPerspectiveCorrection prin modulul nativ
 * expo-perspective-crop).
 *
 * Flow:
 *   1. La mount, citim dimensiunile imaginii și rulăm `detectCorners` în paralel.
 *   2. Dacă auto-detect-ul are confidence ≥ 0.5, populăm cele 4 colțuri pe
 *      conturul documentului detectat. Altfel, default 10% padding.
 *   3. Userul ajustează manual dacă e nevoie.
 *   4. La „Aplică" apelăm `cropPerspective(uri, corners)` — output e o imagine
 *      dreptunghiulară rectificată (documentul „îndreptat" indiferent de unghi).
 *
 * Navigare:
 *   const requestId = makeRequestId();
 *   router.push({ pathname: '/cropper', params: { uri, requestId } });
 *   const croppedUri = await awaitCropper(requestId);
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { cropPerspective, detectCorners } from '@/modules/expo-perspective-crop/src';
import { useColorScheme } from '@/components/useColorScheme';
import { dark, light } from '@/theme/colors';
import { PerspectiveCropperView } from '@/components/cropper/PerspectiveCropperView';
import {
  defaultCorners,
  type Quadrilateral,
  type Size,
} from '@/components/cropper/cropperGeometry';
import { resolveCropper } from '@/services/cropperBridge';

const AUTODETECT_MIN_CONFIDENCE = 0.5;

export default function CropperScreen() {
  const { uri, requestId } = useLocalSearchParams<{ uri: string; requestId: string }>();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [initialCorners, setInitialCorners] = useState<Quadrilateral | null>(null);
  const [corners, setCorners] = useState<Quadrilateral | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const finish = useCallback(
    (resultUri: string | null) => {
      if (done) return;
      setDone(true);
      if (requestId) resolveCropper(requestId, resultUri);
      router.back();
    },
    [done, requestId]
  );

  useEffect(() => {
    if (!uri) {
      Alert.alert('Eroare', 'Imaginea lipsește.');
      finish(null);
      return;
    }

    let cancelled = false;

    // 1. dimensiunile imaginii
    const sizePromise = new Promise<Size | null>(resolve => {
      RNImage.getSize(
        uri,
        (w, h) => resolve({ w, h }),
        () => resolve(null)
      );
    });

    // 2. auto-detect colțuri (paralel)
    const detectPromise = detectCorners(uri).catch(() => ({
      corners: null as Quadrilateral | null,
      confidence: 0,
    }));

    Promise.all([sizePromise, detectPromise])
      .then(([size, detection]) => {
        if (cancelled) return;
        if (!size) {
          Alert.alert('Eroare', 'Nu s-au putut citi dimensiunile imaginii.');
          finish(null);
          return;
        }
        setImageSize(size);

        let start: Quadrilateral;
        if (detection.corners && detection.confidence >= AUTODETECT_MIN_CONFIDENCE) {
          start = clampCornersToImage(detection.corners, size);
        } else {
          start = defaultCorners(size);
        }
        setInitialCorners(start);
        setCorners(start);
        setDetecting(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetecting(false);
        Alert.alert('Eroare', 'Nu s-a putut pregăti imaginea pentru decupare.');
        finish(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  async function handleApply() {
    if (!corners || !uri || busy) return;
    setBusy(true);
    try {
      const result = await cropPerspective({ uri, corners, quality: 95 });
      finish(result.uri);
    } catch (e) {
      setBusy(false);
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut decupa imaginea.');
    }
  }

  function handleCancel() {
    if (busy) return;
    finish(null);
  }

  const ready = imageSize !== null && initialCorners !== null && !detecting;

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: palette.card, borderBottomColor: palette.border },
        ]}
      >
        <Pressable onPress={handleCancel} hitSlop={12} disabled={busy}>
          <Text style={[styles.action, { color: busy ? palette.textSecondary : palette.text }]}>
            Anulează
          </Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Decupează documentul</Text>
        <Pressable onPress={handleApply} hitSlop={12} disabled={busy || !ready}>
          <Text
            style={[
              styles.action,
              {
                color: !ready ? palette.textSecondary : palette.primary,
                fontWeight: '600',
              },
            ]}
          >
            Aplică
          </Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {ready && imageSize && uri && initialCorners ? (
          <PerspectiveCropperView
            imageUri={uri}
            imageSize={imageSize}
            initialCorners={initialCorners}
            onChange={setCorners}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={palette.primary} />
            <Text style={[styles.detectingText, { color: palette.textSecondary }]}>
              {detecting ? 'Caut documentul în imagine…' : ''}
            </Text>
          </View>
        )}
      </View>

      <View
        style={[styles.hint, { backgroundColor: palette.card, borderTopColor: palette.border }]}
      >
        <Text style={[styles.hintText, { color: palette.textSecondary }]}>
          {busy
            ? 'Se decupează și se îndreaptă…'
            : 'Trage colțurile peste marginile documentului. Imaginea va fi îndreptată automat.'}
        </Text>
      </View>
    </View>
  );
}

function clampCornersToImage(q: Quadrilateral, size: Size): Quadrilateral {
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(size.w, p.x)),
    y: Math.max(0, Math.min(size.h, p.y)),
  });
  return {
    topLeft: clamp(q.topLeft),
    topRight: clamp(q.topRight),
    bottomRight: clamp(q.bottomRight),
    bottomLeft: clamp(q.bottomLeft),
  };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '600' },
  action: { fontSize: 16 },
  body: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  detectingText: { fontSize: 13 },
  hint: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hintText: { fontSize: 13, textAlign: 'center' },
});
