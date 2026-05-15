/**
 * Inline PDF viewer pentru o pagină PDF a documentului — WKWebView (nativ iOS,
 * randează PDF cu paginare). Pe Android cădem la deschidere externă (RN nu are
 * un viewer PDF nativ în WebView).
 *
 * Folosit în `documente/[id].tsx` pentru fiecare pagină PDF din `allPages`.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';

import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

interface DocumentPdfViewerProps {
  pdfUri: string;
  scheme: 'light' | 'dark';
  label: string;
  onFullscreen: () => void;
}

export function DocumentPdfViewer({ pdfUri, scheme, label, onFullscreen }: DocumentPdfViewerProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.container, { borderColor: C.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>{label}</Text>
        {Platform.OS === 'ios' && (
          <Pressable style={styles.fullscreenBtn} onPress={onFullscreen}>
            <Ionicons name="expand-outline" size={18} color={primary} />
          </Pressable>
        )}
      </View>
      {Platform.OS === 'ios' ? (
        <WebView
          source={{ uri: pdfUri }}
          style={styles.webView}
          originWhitelist={['file://*', '*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
          scrollEnabled
        />
      ) : (
        <Pressable
          style={[styles.openBtn, { backgroundColor: C.card }]}
          onPress={() => Linking.openURL(pdfUri)}
        >
          <Text style={[styles.openBtnText, { color: primary }]}>📄 Deschide PDF extern</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    marginVertical: 12,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fullscreenBtn: { padding: 4 },
  webView: { height: 480, width: '100%' },
  openBtn: { paddingVertical: 16, alignItems: 'center' },
  openBtnText: { fontSize: 15, fontWeight: '500' },
});
