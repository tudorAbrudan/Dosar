import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { DAILY_AI_LIMIT } from '@/services/aiProvider';

interface AiBuiltinDescriptionProps {
  scheme: 'light' | 'dark';
  /** Cereri Dosar AI folosite azi (contorul zilnic). */
  usedToday: number;
}

/**
 * Card readonly afișat când provider-ul AI selectat e `builtin` —
 * explică că serviciul e inclus și nu necesită cheie API.
 */
export function AiBuiltinDescription({ scheme, usedToday }: AiBuiltinDescriptionProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.box, { borderColor: C.border, backgroundColor: C.background }]}>
      <Text style={[styles.text, { color: C.textSecondary }]}>
        Serviciul AI inclus în aplicație, fără cheie API. Azi ai folosit {usedToday} din{' '}
        {DAILY_AI_LIMIT} cereri; contorul se resetează la miezul nopții. Pentru folosire nelimitată
        alege „Model local" sau „Cheie API proprie".
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    fontSize: 13,
    lineHeight: 20,
  },
});
