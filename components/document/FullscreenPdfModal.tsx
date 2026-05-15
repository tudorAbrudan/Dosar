/**
 * Modal fullscreen pentru vizualizarea unui PDF folosind WebView. PDF-urile
 * se randează cu viewer-ul nativ al WebView-ului (suportă pinch-zoom și
 * scroll multi-pagină).
 *
 * Counterpart la `FullscreenPhotoModal` — pentru imagini.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

interface FullscreenPdfModalProps {
  uri: string | null;
  onClose: () => void;
}

export function FullscreenPdfModal({ uri, onClose }: FullscreenPdfModalProps) {
  return (
    <Modal visible={!!uri} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <StatusBar hidden />
        {uri && (
          <WebView
            source={{ uri }}
            style={{ flex: 1 }}
            originWhitelist={['file://*', '*']}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
            scrollEnabled
          />
        )}
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // PDF viewer e intenționat dark (theme-neutral overlay).
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  overlay: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    // Buton close peste overlay dark — bg translucent dark, theme-neutral.
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text peste fundal dark — alb intenționat.
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  closeBtnText: { color: '#fff', fontSize: 20, fontWeight: '600' },
});
