import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { AI_MODE_OPTIONS, type AiProviderType } from '@/services/aiProvider';

interface AiModeCardsProps {
  selected: AiProviderType;
  scheme: 'light' | 'dark';
  /** „Model local" primește eticheta „Recomandat" doar dacă telefonul îl poate rula. */
  localRecommended: boolean;
  onSelect: (type: AiProviderType) => void;
}

const MODE_ICON: Record<AiProviderType, keyof typeof Ionicons.glyphMap> = {
  local: 'phone-portrait-outline',
  builtin: 'cloud-outline',
  external: 'key-outline',
  none: 'close-circle-outline',
};

/**
 * Cele 4 moduri AI ca alegere „unde merg datele" — aceleași carduri și texte în
 * onboarding și în Setări → Asistent AI (sursa textelor: `AI_MODE_OPTIONS`).
 * Modul selectat își arată și rândul „ce pleacă de pe telefon".
 */
export function AiModeCards({ selected, scheme, localRecommended, onSelect }: AiModeCardsProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {AI_MODE_OPTIONS.map(option => {
        const isSelected = option.type === selected;
        return (
          <Pressable
            key={option.type}
            onPress={() => onSelect(option.type)}
            style={[
              styles.card,
              {
                backgroundColor: C.card,
                borderColor: isSelected ? primary : C.border,
                borderWidth: isSelected ? 2 : 1,
              },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${option.title}. ${option.summary}`}
          >
            <Ionicons
              name={MODE_ICON[option.type]}
              size={22}
              color={isSelected ? primary : C.textSecondary}
              style={styles.icon}
            />
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: C.text }]}>{option.title}</Text>
                {option.type === 'local' && localRecommended && (
                  <View style={[styles.badge, { backgroundColor: `${primary}26` }]}>
                    <Text style={[styles.badgeText, { color: primary }]}>Recomandat</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.summary, { color: C.textSecondary }]}>{option.summary}</Text>
              {isSelected && (
                <Text style={[styles.dataFlow, { color: C.text }]}>{option.dataFlow}</Text>
              )}
            </View>
            <View style={[styles.radio, { borderColor: isSelected ? primary : C.border }]}>
              {isSelected && <View style={[styles.radioInner, { backgroundColor: primary }]} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  icon: { marginTop: 1 },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  summary: { fontSize: 13, lineHeight: 18 },
  dataFlow: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
});
