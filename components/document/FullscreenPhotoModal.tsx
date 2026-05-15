/**
 * Modal fullscreen pentru afișarea unei imagini cu pinch-zoom.
 * Folosit identic în add.tsx / edit.tsx / [id].tsx — extras din 3 copii inline.
 */
import { useWindowDimensions } from 'react-native';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface FullscreenPhotoModalProps {
  uri: string | null;
  onClose: () => void;
}

export function FullscreenPhotoModal({ uri, onClose }: FullscreenPhotoModalProps) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={!!uri} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <StatusBar hidden />
        <ScrollView
          key={uri}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          maximumZoomScale={6}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
          bouncesZoom
        >
          {uri && (
            <Image
              key={uri}
              source={{ uri }}
              style={{ width, height }}
              resizeMode="contain"
            />
          )}
        </ScrollView>
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
});
