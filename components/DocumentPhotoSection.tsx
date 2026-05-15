/**
 * Secțiunea „Fotografii + OCR" din ecranele documente (add/edit/[id]).
 * Orchestrator pentru DocumentPhotoPage (per pagină) + DocumentOcrTextSection
 * (text OCR colapsabil).
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { DocumentOcrTextSection } from '@/components/document/DocumentOcrTextSection';
import { DocumentPhotoPage } from '@/components/document/DocumentPhotoPage';
import { primary } from '@/theme/colors';

export interface PhotoPage {
  id: string;
  uri: string;
}

interface Props {
  pages: PhotoPage[];
  ocrLoading: boolean;
  ocrText?: string;
  isEditing?: boolean;
  refreshKey?: number;
  onAddPage: () => void;
  onRotate: (pageId: string, degrees: number) => void;
  onDelete: (pageId: string) => void;
  onRunOcr: () => void;
  onFullscreen: (uri: string) => void;
  onReorderPage?: (fromIndex: number, toIndex: number) => void;
  onOcrTextSave?: (text: string) => Promise<void>;
}

export function DocumentPhotoSection({
  pages,
  ocrLoading,
  ocrText,
  isEditing = true,
  refreshKey,
  onAddPage,
  onRotate,
  onDelete,
  onRunOcr,
  onFullscreen,
  onReorderPage,
  onOcrTextSave,
}: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const canReorder = isEditing && pages.length > 1 && !!onReorderPage;

  return (
    <View style={styles.container}>
      {pages.map((page, idx) => (
        <DocumentPhotoPage
          key={`${page.id}_${page.uri}_${refreshKey ?? 0}`}
          page={page}
          pageIndex={idx}
          pageCount={pages.length}
          isEditing={isEditing}
          canReorder={canReorder}
          refreshKey={refreshKey ?? 0}
          scheme={scheme}
          onRotate={onRotate}
          onDelete={onDelete}
          onFullscreen={onFullscreen}
          onReorderPage={onReorderPage}
        />
      ))}

      {isEditing && (
        <View style={styles.actionsRow}>
          <Pressable style={styles.actionBtn} onPress={onAddPage}>
            <Text style={styles.actionBtnText}>
              {pages.length === 0 ? '+ Adaugă fișier' : '+ Fișier nou'}
            </Text>
          </Pressable>
          {pages.length > 0 && (
            <Pressable
              style={[styles.actionBtn, ocrLoading && styles.disabled]}
              onPress={onRunOcr}
              disabled={ocrLoading}
            >
              {ocrLoading ? (
                <View style={styles.ocrLoadingRow}>
                  <ActivityIndicator size="small" color={primary} />
                  <Text style={styles.ocrLoadingText}> OCR...</Text>
                </View>
              ) : (
                <Text style={styles.actionBtnText}>
                  🔍 OCR{pages.length > 1 ? ` (${pages.length})` : ''}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      <DocumentOcrTextSection
        ocrText={ocrText}
        pageCount={pages.length}
        isEditing={isEditing}
        scheme={scheme}
        onSave={onOcrTextSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { color: primary, fontWeight: '500', fontSize: 14 },
  ocrLoadingRow: { flexDirection: 'row', alignItems: 'center' },
  ocrLoadingText: { color: primary, fontSize: 13 },
  disabled: { opacity: 0.5 },
});
