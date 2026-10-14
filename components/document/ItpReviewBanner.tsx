import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors, light, dark } from '@/theme/colors';

interface ItpReviewBannerProps {
  /** Data ITP din formular (YYYY-MM-DD) sau '' dacă n-a putut fi citită. */
  expiryDate: string;
  onConfirm: () => void;
}

/**
 * Banner galben sub câmpul „Expiră" al talonului: data ITP vine de pe ștampila
 * RAR scrisă de mână, deci nu e sigură până n-o confirmă utilizatorul.
 * Fără dată → cere completarea manuală.
 */
export function ItpReviewBanner({ expiryDate, onConfirm }: ItpReviewBannerProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const hasDate = expiryDate !== '';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor:
            scheme === 'dark' ? statusColors.warningSurfaceDark : statusColors.warningSurfaceSoft,
          borderColor: statusColors.warning,
        },
      ]}
    >
      <Text style={[styles.title, { color: statusColors.warning }]}>
        {hasDate ? 'Verifică data ITP' : 'Completează data ITP'}
      </Text>
      <Text style={[styles.body, { color: palette.text }]}>
        {hasDate
          ? 'Data a fost citită automat de pe ștampila scrisă de mână și poate fi greșită. Compar-o cu ultima ștampilă din tabelul ITP al talonului.'
          : 'Lipsește data ITP. Introdu-o din ultima ștampilă din tabelul ITP al talonului — scrisul de mână nu poate fi citit sigur automat.'}
      </Text>
      {hasDate ? (
        <Pressable
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel="Confirmă că data ITP e corectă"
          hitSlop={8}
          style={({ pressed }) => [
            styles.button,
            { borderColor: statusColors.warning },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.buttonText, { color: statusColors.warning }]}>Data e corectă</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
  },
  button: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginTop: 2,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
