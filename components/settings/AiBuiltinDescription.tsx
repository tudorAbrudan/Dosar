import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';

interface AiBuiltinDescriptionProps {
  scheme: 'light' | 'dark';
}

/**
 * Card readonly afișat când provider-ul AI selectat e `builtin` —
 * explică că serviciul e inclus și nu necesită cheie API.
 */
export function AiBuiltinDescription({ scheme }: AiBuiltinDescriptionProps) {
  const C = Colors[scheme];
  return (
    <View
      style={[
        styles.box,
        { borderColor: C.border, backgroundColor: C.background },
      ]}
    >
      <Text style={[styles.text, { color: C.textSecondary }]}>
        Utilizează serviciul AI inclus în aplicație. Nu este necesară o cheie API personală.
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
