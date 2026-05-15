import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';

interface LocalModelWarningBannerProps {
  onContactDeveloper: () => void;
}

/**
 * Banner avertisment afișat când e ales `aiProviderType === 'local'`.
 * Modelele on-device pot produce halucinații — explică limitarea și oferă link email.
 */
export function LocalModelWarningBanner({ onContactDeveloper }: LocalModelWarningBannerProps) {
  return (
    <View style={styles.container}>
      <Ionicons
        name="flask-outline"
        size={16}
        color={iconColors.amber.fg}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={styles.title}>Model local – în testare</Text>
        <Text style={styles.text}>
          Modelele locale pot produce răspunsuri incorecte (halucinații). Dacă observi erori,
          te rugăm să contactezi dezvoltatorul.{' '}
          <Text style={styles.link} onPress={onContactDeveloper}>
            Trimite email
          </Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: iconColors.amberLight.bg,
    borderColor: iconColors.amberLight.fg,
  },
  icon: { marginRight: 6, marginTop: 1 },
  body: { flex: 1 },
  title: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
    color: iconColors.warning.fg,
  },
  text: {
    fontSize: 12,
    lineHeight: 17,
    color: iconColors.brown.fg,
  },
  link: {
    color: primary,
    textDecorationLine: 'underline',
  },
});
