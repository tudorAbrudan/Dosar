/**
 * Pagină individuală în DocumentPhotoSection — imagine/PDF + bara de acțiuni
 * (reorder ↑↓, rotire stânga/dreapta, șterge).
 */
import { Image, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { isPdfFile } from '@/services/pdfExtractor';
import type { PhotoPage } from '@/components/DocumentPhotoSection';

interface DocumentPhotoPageProps {
  page: PhotoPage;
  pageIndex: number;
  pageCount: number;
  isEditing: boolean;
  canReorder: boolean;
  refreshKey: number;
  scheme: 'light' | 'dark';
  onRotate: (pageId: string, degrees: number) => void;
  onDelete: (pageId: string) => void;
  onFullscreen: (uri: string) => void;
  onReorderPage?: (fromIndex: number, toIndex: number) => void;
}

export function DocumentPhotoPage({
  page,
  pageIndex,
  pageCount,
  isEditing,
  canReorder,
  refreshKey,
  scheme,
  onRotate,
  onDelete,
  onFullscreen,
  onReorderPage,
}: DocumentPhotoPageProps) {
  const { width: screenWidth } = useWindowDimensions();
  const C = Colors[scheme];
  const pageIsPdf = isPdfFile(page.uri) || isPdfFile(page.id);
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === pageCount - 1;

  return (
    <View
      key={`${page.id}_${page.uri}_${refreshKey}`}
      style={[styles.imageWrap, { backgroundColor: C.surface }]}
    >
      {pageCount > 1 && (
        <Text style={styles.pageLabel}>
          Pagina {pageIndex + 1} / {pageCount}
        </Text>
      )}
      <View style={[styles.imageContainer, { width: screenWidth - 40 }]}>
        {pageIsPdf ? (
          Platform.OS === 'ios' ? (
            <WebView
              source={{ uri: page.uri.startsWith('file://') ? page.uri : `file://${page.uri}` }}
              style={[styles.pdfWebView, { width: screenWidth - 40 }]}
              originWhitelist={['file://*', '*']}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
            />
          ) : (
            <View
              style={[
                styles.pdfPlaceholder,
                { width: screenWidth - 40, backgroundColor: C.surface, borderColor: C.border },
              ]}
            >
              <Text style={styles.pdfIcon}>📄</Text>
              <Text style={[styles.pdfLabel, { color: C.text }]}>Document PDF</Text>
              <Text style={[styles.pdfSubLabel, { color: C.textSecondary }]}>
                Vizualizare disponibilă după salvare
              </Text>
            </View>
          )
        ) : (
          <Image
            source={{ uri: page.uri }}
            style={[styles.image, { width: screenWidth - 40, backgroundColor: C.surface }]}
            resizeMode="contain"
          />
        )}
        {!pageIsPdf && (
          <Pressable style={styles.fullscreenBtn} onPress={() => onFullscreen(page.uri)}>
            <Text style={styles.fullscreenBtnText}>⤢</Text>
          </Pressable>
        )}
      </View>
      {isEditing && (
        <View style={[styles.rotateBar, { borderTopColor: C.border }]}>
          {canReorder && (
            <>
              <Pressable
                style={[
                  styles.rotateBtn,
                  styles.rotateBtnReorder,
                  styles.rotateBtnBorderRight,
                  { borderRightColor: C.border },
                  isFirst && styles.disabled,
                ]}
                onPress={() => !isFirst && onReorderPage!(pageIndex, pageIndex - 1)}
                disabled={isFirst}
              >
                <Text style={[styles.rotateBtnText, isFirst && styles.disabledText]}>↑</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.rotateBtn,
                  styles.rotateBtnReorder,
                  styles.rotateBtnBorderRight,
                  { borderRightColor: C.border },
                  isLast && styles.disabled,
                ]}
                onPress={() => !isLast && onReorderPage!(pageIndex, pageIndex + 1)}
                disabled={isLast}
              >
                <Text style={[styles.rotateBtnText, isLast && styles.disabledText]}>↓</Text>
              </Pressable>
            </>
          )}
          {!pageIsPdf && (
            <>
              <Pressable
                style={[
                  styles.rotateBtn,
                  styles.rotateBtnBorderRight,
                  { borderRightColor: C.border },
                ]}
                onPress={() => onRotate(page.id, -90)}
              >
                <Text style={styles.rotateBtnText}>↺ Rotește</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.rotateBtn,
                  styles.rotateBtnBorderRight,
                  { borderRightColor: C.border },
                ]}
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
}

const styles = StyleSheet.create({
  imageWrap: { marginBottom: 12, borderRadius: 12, overflow: 'hidden' },
  pageLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  imageContainer: { position: 'relative' },
  image: { height: 260 },
  pdfWebView: { height: 420, borderRadius: 8 },
  pdfPlaceholder: {
    height: 180,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  pdfIcon: { fontSize: 40 },
  pdfLabel: { fontSize: 16, fontWeight: '600' },
  pdfSubLabel: { fontSize: 12, textAlign: 'center', paddingHorizontal: 16 },
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
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  fullscreenBtnText: { color: '#fff', fontSize: 16 },
  rotateBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  rotateBtn: { flex: 1, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  rotateBtnReorder: { flex: 0, width: 36 },
  rotateBtnBorderRight: { borderRightWidth: StyleSheet.hairlineWidth },
  rotateBtnText: { color: primary, fontSize: 13, fontWeight: '500' },
  deleteText: { color: statusColors.critical },
  disabled: { opacity: 0.5 },
  disabledText: { opacity: 0.3 },
});
