import { Pressable, Text, StyleSheet } from 'react-native';
import type { CustomDocumentType, Document } from '@/types';
import { getDocumentLabel } from '@/types';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors } from '@/theme/colors';
import Colors from '@/constants/Colors';

interface DuplicateBannerProps {
  doc: Document;
  /** Tipurile custom — necesare pentru a afișa numele real al unui document
   *  de tip `custom` în loc de label-ul generic „Tip personalizat".
   *  Optional pentru retro-compat — fallback la generic dacă lipsește. */
  customTypes?: CustomDocumentType[];
  onPress: () => void;
}

/**
 * Banner galben („warning") afișat când există deja un document similar
 * (același tip + dată emitere) pentru aceeași entitate. La tap deschide
 * documentul existent.
 */
export function DuplicateBanner({ doc, customTypes, onPress }: DuplicateBannerProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <Pressable
      style={[
        styles.container,
        {
          backgroundColor:
            scheme === 'dark' ? statusColors.warningSurfaceDark : statusColors.warningSurfaceSoft,
          borderColor: statusColors.warning,
        },
      ]}
      onPress={onPress}
      accessibilityLabel="Deschide documentul similar"
    >
      <Text style={[styles.title, { color: statusColors.warning }]}>
        Document similar găsit
      </Text>
      <Text style={[styles.body, { color: C.text }]}>
        Există deja un document de tip „{getDocumentLabel(doc, customTypes ?? [])}"
        {doc.issue_date ? ` din ${doc.issue_date}` : ''} pentru această entitate.
      </Text>
      <Text style={[styles.link, { color: statusColors.warning }]}>
        Deschide documentul existent →
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    marginBottom: 6,
  },
  link: {
    fontSize: 12,
    fontWeight: '600',
  },
});
