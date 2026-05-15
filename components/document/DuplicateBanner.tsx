import { Pressable, Text, StyleSheet } from 'react-native';
import type { Document } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors } from '@/theme/colors';
import Colors from '@/constants/Colors';

interface DuplicateBannerProps {
  doc: Document;
  onPress: () => void;
}

/**
 * Banner galben („warning") afișat când există deja un document similar
 * (același tip + dată emitere) pentru aceeași entitate. La tap deschide
 * documentul existent.
 */
export function DuplicateBanner({ doc, onPress }: DuplicateBannerProps) {
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
        Există deja un document de tip „{DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type}"
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
