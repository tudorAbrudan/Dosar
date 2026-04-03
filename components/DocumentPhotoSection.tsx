import { useState } from 'react';
import {
  StyleSheet,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  useColorScheme,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Text, View } from '@/components/Themed';
import { primary } from '@/theme/colors';
import Colors from '@/constants/Colors';
import { isPdfFile } from '@/services/pdfExtractor';

export interface PhotoPage {
  id: string;
  uri: string;
}

interface Props {
  pages: PhotoPage[];
  ocrLoading: boolean;
  ocrText?: string;
  isEditing?: boolean;
  onAddPage: () => void;
  onRotate: (pageId: string, degrees: number) => void;
  onDelete: (pageId: string) => void;
  onRunOcr: () => void;
  onFullscreen: (uri: string) => void;
}

export function DocumentPhotoSection({
  pages,
  ocrLoading,
  ocrText,
  isEditing = true,
  onAddPage,
  onRotate,
  onDelete,
  onRunOcr,
  onFullscreen,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [ocrExpanded, setOcrExpanded] = useState(false);

  return (
    <View style={styles.container}>
      {pages.map((page, idx) => {
        const pageIsPdf = isPdfFile(page.uri) || isPdfFile(page.id);
        return (
          <View key={page.id} style={styles.imageWrap}>
            {pages.length > 1 && (
              <Text style={styles.pageLabel}>
                Pagina {idx + 1} / {pages.length}
              </Text>
            )}
            <View style={[styles.imageContainer, { width: screenWidth - 40 }]}>
              {pageIsPdf ? (
                Platform.OS === 'ios' ? (
                  <WebView
                    source={{
                      uri: page.uri.startsWith('file://') ? page.uri : `file://${page.uri}`,
                    }}
                    style={[styles.pdfWebView, { width: screenWidth - 40 }]}
                    originWhitelist={['file://*', '*']}
                    allowFileAccess
                  />
                ) : (
                  <View style={[styles.pdfPlaceholder, { width: screenWidth - 40 }]}>
                    <Text style={styles.pdfIcon}>📄</Text>
                    <Text style={styles.pdfLabel}>Document PDF</Text>
                    <Text style={styles.pdfSubLabel}>Vizualizare disponibilă după salvare</Text>
                  </View>
                )
              ) : (
                <Image
                  source={{ uri: page.uri }}
                  style={[styles.image, { width: screenWidth - 40 }]}
                  resizeMode="contain"
                />
              )}
              {!pageIsPdf && (
                <Pressable style={styles.fullscreenBtn} onPress={() => onFullscreen(page.uri)}>
                  <Text style={styles.fullscreenBtnText}>⤢</Text>
                </Pressable>
              )}
            </View>
            {/* Rotate / delete bar — doar în modul editare */}
            {isEditing && (
              <View style={styles.rotateBar}>
                {!pageIsPdf && (
                  <>
                    <Pressable
                      style={[styles.rotateBtn, styles.rotateBtnBorderRight]}
                      onPress={() => onRotate(page.id, -90)}
                    >
                      <Text style={styles.rotateBtnText}>↺ Rotește</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.rotateBtn, styles.rotateBtnBorderRight]}
                      onPress={() => onRotate(page.id, 90)}
                    >
                      <Text style={styles.rotateBtnText}>↻ Rotește</Text>
                    </Pressable>
                  </>
                )}
                <Pressable style={styles.rotateBtn} onPress={() => onDelete(page.id)}>
                  <Text style={[styles.rotateBtnText, styles.deleteText]}>Șterge</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {/* Add page + OCR — doar în modul editare */}
      {isEditing && (
        <View style={styles.photoActionsRow}>
          <Pressable style={styles.photoActionBtn} onPress={onAddPage}>
            <Text style={styles.photoActionBtnText}>
              {pages.length === 0 ? '+ Adaugă fișier' : '+ Fișier nou'}
            </Text>
          </Pressable>
          {pages.length > 0 && (
            <Pressable
              style={[styles.photoActionBtn, ocrLoading && styles.btnDisabled]}
              onPress={onRunOcr}
              disabled={ocrLoading}
            >
              {ocrLoading ? (
                <View style={styles.ocrLoadingRow}>
                  <ActivityIndicator size="small" color={primary} />
                  <Text style={styles.ocrLoadingText}> OCR...</Text>
                </View>
              ) : (
                <Text style={styles.photoActionBtnText}>
                  🔍 OCR{pages.length > 1 ? ` (${pages.length})` : ''}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {ocrText ? (
        <View style={[styles.ocrSection, { borderColor: C.border }]}>
          <Pressable onPress={() => setOcrExpanded(v => !v)} style={styles.ocrToggleRow}>
            <Text style={styles.ocrToggleLabel}>Text complet extras (OCR)</Text>
            <Text style={styles.ocrToggleChevron}>{ocrExpanded ? '▲ Ascunde' : '▼ Arată'}</Text>
          </Pressable>
          {ocrExpanded && (
            <Text
              style={[styles.ocrText, { backgroundColor: C.background, color: C.text }]}
              selectable
            >
              {ocrText}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  imageWrap: {
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
  },
  pageLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  imageContainer: { position: 'relative' },
  image: { height: 260 },
  pdfWebView: {
    height: 420,
    borderRadius: 8,
  },
  pdfPlaceholder: {
    height: 180,
    backgroundColor: '#f8faf4',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2ebd4',
    borderStyle: 'dashed',
  },
  pdfIcon: { fontSize: 40 },
  pdfLabel: { fontSize: 16, fontWeight: '600', color: '#333' },
  pdfSubLabel: { fontSize: 12, color: '#888', textAlign: 'center', paddingHorizontal: 16 },
  fullscreenBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenBtnText: { color: '#fff', fontSize: 16 },

  // Segmented control row for rotate/delete
  rotateBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  rotateBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateBtnBorderRight: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#ccc',
  },
  rotateBtnText: { color: primary, fontSize: 13, fontWeight: '500' },
  deleteText: { color: '#E53935' },

  // Add page + OCR side by side
  photoActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  photoActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActionBtnText: { color: primary, fontWeight: '500', fontSize: 14 },
  ocrLoadingRow: { flexDirection: 'row', alignItems: 'center' },
  ocrLoadingText: { color: primary, fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  ocrSection: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    marginBottom: 10,
    overflow: 'hidden',
  },
  ocrToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ocrToggleLabel: { fontSize: 14, opacity: 0.9, fontWeight: '500' },
  ocrToggleChevron: { color: primary, fontSize: 13, fontWeight: '500' },
  ocrText: {
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.75,
    fontFamily: 'Courier',
    backgroundColor: '#f8f8f8',
    padding: 12,
  },
});
