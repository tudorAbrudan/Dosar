/**
 * Modal fullscreen pentru afișarea pozelor unui document, cu swipe între
 * pagini (FlatList orizontal + pagingEnabled) și pinch-zoom per pagină
 * (ScrollView cu maximumZoomScale). Inspirat de iPhone Photos:
 *
 *  - zoom 1× → swipe orizontal navighează între pagini
 *  - zoom > 1× → swipe orizontal pan-uiește în interiorul pozei
 *  - schimbarea paginii resetează zoom-ul pe pagina anterioară
 *
 * Rotirea telefonului dezbloca-aplică orientarea liberă cât timp modalul e
 * deschis (vezi useEffect pe `visible`). Restul aplicației rămâne portrait.
 */
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

export interface PhotoItem {
  uri: string;
}

interface FullscreenPhotoModalProps {
  photos: PhotoItem[];
  initialIndex: number | null;
  onClose: () => void;
}

export function FullscreenPhotoModal({ photos, initialIndex, onClose }: FullscreenPhotoModalProps) {
  const { width, height } = useWindowDimensions();
  const visible = initialIndex !== null && photos.length > 0;

  const [currentIndex, setCurrentIndex] = useState(initialIndex ?? 0);
  const [zoomed, setZoomed] = useState(false);

  const flatListRef = useRef<FlatList<PhotoItem>>(null);
  const scrollRefs = useRef<Record<number, ScrollView | null>>({});

  // Resincronizează indexul când userul redeschide modalul pe altă pagină.
  useEffect(() => {
    if (initialIndex !== null) {
      setCurrentIndex(initialIndex);
      setZoomed(false);
    }
  }, [initialIndex]);

  // La rotire, reașează poziția FlatList-ului la pagina curentă (pentru că
  // pagingEnabled folosește lățimea curentă, iar contentOffset rămâne în pixeli
  // din lățimea anterioară).
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => {
      flatListRef.current?.scrollToOffset({
        offset: currentIndex * width,
        animated: false,
      });
    }, 0);
    return () => clearTimeout(id);
  }, [width, visible, currentIndex]);

  // Deblochează rotirea cât e deschis; blochează portrait la închidere.
  useEffect(() => {
    if (!visible) return;
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [visible]);

  function handleMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIndex === currentIndex) return;
    const prev = scrollRefs.current[currentIndex];
    // scrollResponderZoomTo există pe iOS pentru ScrollView; resetează zoom-ul
    // pe pagina pe care plecăm ca să nu rămână mărită când userul revine.
    const zoomTo = (
      prev as unknown as {
        scrollResponderZoomTo?: (r: {
          x: number;
          y: number;
          width: number;
          height: number;
          animated?: boolean;
        }) => void;
      }
    )?.scrollResponderZoomTo;
    if (zoomTo) {
      zoomTo({ x: 0, y: 0, width: 1, height: 1, animated: false });
    }
    setCurrentIndex(newIndex);
    setZoomed(false);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <StatusBar hidden />
        <FlatList
          ref={flatListRef}
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex ?? 0}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          keyExtractor={(item, i) => `${i}_${item.uri}`}
          extraData={width}
          renderItem={({ item, index }) => (
            <ScrollView
              ref={r => {
                scrollRefs.current[index] = r;
              }}
              style={{ width, height }}
              contentContainerStyle={styles.scrollContent}
              maximumZoomScale={6}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
              bouncesZoom
              scrollEventThrottle={16}
              onScroll={e => {
                if (index === currentIndex) {
                  setZoomed(e.nativeEvent.zoomScale > 1.01);
                }
              }}
            >
              <Image source={{ uri: item.uri }} style={{ width, height }} resizeMode="contain" />
            </ScrollView>
          )}
        />
        {photos.length > 1 && (
          <View pointerEvents="none" style={styles.counterWrap}>
            <Text style={styles.counter}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </View>
        )}
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Fullscreen photo viewer e intenționat dark (theme-neutral overlay).
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  overlay: { flex: 1, backgroundColor: '#000' },
  scrollContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  closeBtn: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    // Buton close peste foto dark — bg translucent dark, theme-neutral.
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text peste fundal dark — alb intenționat.
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  closeBtnText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  counterWrap: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  counter: {
    // Text alb peste fundal dark — intenționat.
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
