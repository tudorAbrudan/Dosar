import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';

interface AiDisclosureProps {
  title: string;
  scheme: 'light' | 'dark';
  /** Deschis inițial — ex. când opțiunile avansate sunt deja configurate. */
  initiallyOpen?: boolean;
  children: ReactNode;
}

/**
 * Rând „Avansat ›" / „Alte modele ›" care ascunde opțiunile rar folosite din
 * Setări → Asistent AI. Calea obișnuită (alegi modul, eventual descarci modelul
 * recomandat) rămâne vizibilă; restul nu mai concurează pentru atenție.
 */
export function AiDisclosure({
  title,
  scheme,
  initiallyOpen = false,
  children,
}: AiDisclosureProps) {
  const C = Colors[scheme];
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View>
      <Pressable
        style={styles.header}
        onPress={() => setOpen(v => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
      >
        <Text style={[styles.title, { color: C.textSecondary }]}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} />
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  title: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  body: { gap: 16, paddingTop: 8 },
});
