import {
  StyleSheet,
  ScrollView,
  View as RNView,
  Text as RNText,
  Pressable,
  Linking,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { useEntities } from '@/hooks/useEntities';
import { VIGNETA_COUNTRIES } from '@/services/vigneta';
import type { VignetaCountry } from '@/services/vigneta';

const VIGNETA_URL = 'https://www.autobahn.de/en/vignettes';

export default function VignetaScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { vehicles } = useEntities();

  const vehicle = vehicles.find(v => v.id === vehicleId);
  const vehicleName = vehicle?.name ?? 'vehicul';

  const required = VIGNETA_COUNTRIES.filter(c => c.required);
  const optional = VIGNETA_COUNTRIES.filter(c => !c.required);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      <RNText style={[styles.title, { color: C.text }]}>Vignetă la graniță</RNText>
      <RNText style={[styles.subtitle, { color: C.textSecondary }]}>
        Informații pentru{' '}
        <RNText style={{ color: C.primary, fontWeight: '700' }}>{vehicleName}</RNText>
      </RNText>

      {/* Banner actualizare */}
      <Pressable
        style={[styles.infoBanner, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={() => Linking.openURL(VIGNETA_URL)}
      >
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={C.textSecondary}
          style={{ marginRight: 8, flexShrink: 0 }}
        />
        <RNText style={[styles.infoBannerText, { color: C.textSecondary }]}>
          Datele pot fi depășite. Verifică informații actualizate înainte de plecare.
        </RNText>
        <Ionicons
          name="open-outline"
          size={14}
          color={C.primary}
          style={{ marginLeft: 8, flexShrink: 0 }}
        />
      </Pressable>

      <RNText style={[styles.sectionTitle, { color: primary }]}>VIGNETĂ OBLIGATORIE</RNText>
      {required.map(country => (
        <RequiredCard key={country.code} country={country} C={C} />
      ))}

      <RNText style={[styles.sectionTitle, { color: C.textSecondary, marginTop: 24 }]}>
        FĂRĂ VIGNETĂ / ALTE TAXE
      </RNText>
      {optional.map(country => (
        <OptionalCard key={country.code} country={country} C={C} />
      ))}
    </ScrollView>
  );
}

function RequiredCard({ country, C }: { country: VignetaCountry; C: (typeof Colors)['light'] }) {
  return (
    <RNView style={[styles.card, styles.cardRequired, { backgroundColor: C.primaryMuted }]}>
      <RNView style={styles.cardHeader}>
        <RNText style={[styles.countryName, { color: primary }]}>{country.name}</RNText>
        <RNView style={styles.badgeRequired}>
          <RNText style={styles.badgeRequiredText}>NECESAR</RNText>
        </RNView>
      </RNView>
      {country.validityOptions.length > 0 && (
        <RNView style={styles.validityRow}>
          <RNText style={{ fontSize: 13, color: C.textSecondary }}>Valabilitate: </RNText>
          <RNText style={{ fontSize: 13, fontWeight: '600', color: primary, flexShrink: 1 }}>
            {country.validityOptions.join(' · ')}
          </RNText>
        </RNView>
      )}
      {country.note ? (
        <RNText style={[styles.note, { color: C.textSecondary }]}>{country.note}</RNText>
      ) : null}
      {country.buyUrl ? (
        <Pressable
          style={[styles.buyBtn, { backgroundColor: C.primaryMuted }]}
          onPress={() => Linking.openURL(country.buyUrl!)}
        >
          <Ionicons name="open-outline" size={13} color={primary} style={{ marginRight: 4 }} />
          <RNText style={styles.buyBtnText}>Cumpără online</RNText>
        </Pressable>
      ) : null}
    </RNView>
  );
}

function OptionalCard({ country, C }: { country: VignetaCountry; C: (typeof Colors)['light'] }) {
  return (
    <RNView style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <RNView style={styles.cardHeader}>
        <RNText style={[styles.countryName, { color: C.text }]}>{country.name}</RNText>
        <RNView style={[styles.badgeOptional, { backgroundColor: C.border }]}>
          <RNText style={[styles.badgeOptionalText, { color: C.textSecondary }]}>NU</RNText>
        </RNView>
      </RNView>
      {country.note ? (
        <RNText style={[styles.note, { color: C.textSecondary }]}>{country.note}</RNText>
      ) : null}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardRequired: {
    borderColor: primary,
    shadowColor: primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  countryName: { fontSize: 16, fontWeight: '600', flex: 1 },
  badgeRequired: {
    backgroundColor: primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeRequiredText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  badgeOptional: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOptionalText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  validityRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  note: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 20,
  },
  infoBannerText: { flex: 1, fontSize: 12, lineHeight: 17 },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  buyBtnText: { fontSize: 12, fontWeight: '600', color: primary },
});
