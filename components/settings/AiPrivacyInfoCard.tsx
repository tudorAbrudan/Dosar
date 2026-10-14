import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import type { AiRoute } from '@/services/aiProvider';

interface AiPrivacyInfoCardProps {
  /** Ruta configurației din formular (încă nesalvată) — vezi `getAiRoute`. */
  route: AiRoute;
  scheme: 'light' | 'dark';
}

interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  sub: string;
}

/**
 * „Ce pleacă de pe telefon" pentru modul ales în formular — aceleași reguli pe
 * care le aplică gate-urile din services/aiGuard.ts. Rândul despre „Notă
 * privată" apare mereu: e garanția care nu depinde de mod.
 */
function rowsFor(route: AiRoute): Row[] {
  const privateNote: Row = {
    icon: 'lock-closed-outline',
    color: statusColors.ok,
    title: 'Niciodată: „Notă privată", PIN-ul aplicației, CVV',
    sub: 'Folosește „Notă privată" pentru date strict sensibile (PIN-uri, parole).',
  };

  if (route.text === 'off') {
    return [
      {
        icon: 'shield-checkmark-outline',
        color: statusColors.ok,
        title: 'Nimic nu se trimite nicăieri',
        sub: 'Câmpurile se completează doar din textul citit pe telefon.',
      },
    ];
  }

  if (route.text === 'device') {
    const rows: Row[] = [
      {
        icon: 'phone-portrait-outline',
        color: statusColors.ok,
        title: 'Chat-ul și textul rămân pe telefon',
        sub: 'Modelul rulează local; întrebările și documentele nu pleacă nicăieri.',
      },
    ];
    if (route.images === 'cloud') {
      rows.push({
        icon: 'image-outline',
        color: primary,
        title: 'Pozele documentelor: doar când apeși „Trimite documentul la AI"',
        sub: 'Pleacă la providerul de imagini configurat în „Avansat".',
      });
    }
    rows.push(privateNote);
    return rows;
  }

  const rows: Row[] = [
    {
      icon: 'document-text-outline',
      color: primary,
      title: 'Automat, la atașare: textul citit din document',
      sub: 'Ca AI-ul să completeze câmpurile. Actele de identitate te întreabă întâi; documentele medicale pleacă doar cu acordul dat pe dosar.',
    },
    {
      icon: 'chatbubble-outline',
      color: primary,
      title: 'În chat: întrebarea și datele relevante din documente',
      sub: 'Documentele medicale nu ajung în chat-ul general; au chat-ul lor, în fiecare dosar.',
    },
  ];
  if (route.images === 'cloud') {
    rows.push({
      icon: 'image-outline',
      color: primary,
      title: 'Poza documentului: doar când apeși „Trimite documentul la AI"',
      sub: 'Și la scanarea unui bon de carburant sau a unei facturi de utilități.',
    });
  }
  rows.push(privateNote);
  return rows;
}

export function AiPrivacyInfoCard({ route, scheme }: AiPrivacyInfoCardProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[styles.heading, { color: C.textSecondary }]}>Ce pleacă de pe telefon</Text>
      {rowsFor(route).map(row => (
        <View key={row.title} style={styles.row}>
          <Ionicons name={row.icon} size={18} color={row.color} style={styles.icon} />
          <View style={styles.text}>
            <Text style={[styles.title, { color: C.text }]}>{row.title}</Text>
            <Text style={[styles.sub, { color: C.textSecondary }]}>{row.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  heading: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 8 },
  icon: { marginTop: 2 },
  text: { flex: 1 },
  title: { fontSize: 13, fontWeight: '600' },
  sub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});
