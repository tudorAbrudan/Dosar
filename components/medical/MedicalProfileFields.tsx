/**
 * Câmpurile de profil de urgență ale dosarului medical (medicamente, afecțiuni,
 * implanturi, medic de familie etc.) — sursa: `MEDICAL_PROFILE_FIELDS`.
 *
 * - `MedicalProfileInputs`: input-urile din formularul de editare.
 * - `MedicalProfileDetails`: afișarea read-only din antetul extins al dosarului.
 */
import { View, TextInput, Pressable, StyleSheet, Linking } from 'react-native';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary } from '@/theme/colors';
import { MEDICAL_PROFILE_FIELDS } from '@/types';
import type { MedicalProfileField, MedicalRecord } from '@/types';

export type MedicalProfileDraft = Record<MedicalProfileField, string>;

export function profileDraftFromRecord(record: MedicalRecord): MedicalProfileDraft {
  return Object.fromEntries(
    MEDICAL_PROFILE_FIELDS.map(f => [f.key, record[f.key] ?? ''])
  ) as MedicalProfileDraft;
}

export function profilePatchFromDraft(
  draft: MedicalProfileDraft
): Record<MedicalProfileField, string | null> {
  return Object.fromEntries(
    MEDICAL_PROFILE_FIELDS.map(f => [f.key, draft[f.key].trim() || null])
  ) as Record<MedicalProfileField, string | null>;
}

export function hasProfileData(record: MedicalRecord): boolean {
  return MEDICAL_PROFILE_FIELDS.some(f => !!record[f.key]);
}

interface InputsProps {
  draft: MedicalProfileDraft;
  onChange: (key: MedicalProfileField, value: string) => void;
  editable: boolean;
}

export function MedicalProfileInputs({ draft, onChange, editable }: InputsProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const renderGroup = (essential: boolean) =>
    MEDICAL_PROFILE_FIELDS.filter(f => f.essential === essential).map(f => (
      <View key={f.key}>
        <Text style={[styles.formLabel, { color: palette.text }]}>
          {f.label}
          {f.unit ? ` (${f.unit})` : ''} (opțional)
        </Text>
        <TextInput
          value={draft[f.key]}
          onChangeText={v => onChange(f.key, v)}
          placeholder={f.placeholder}
          placeholderTextColor={palette.textSecondary}
          keyboardType={f.keyboard ?? 'default'}
          multiline={f.multiline}
          style={[
            styles.formInput,
            {
              color: palette.text,
              borderColor: palette.border,
              backgroundColor: palette.surface,
            },
            f.multiline ? styles.multiline : null,
          ]}
          editable={editable}
        />
      </View>
    ));

  return (
    <>
      <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>
        IMPORTANT ÎN URGENȚĂ
      </Text>
      {renderGroup(true)}
      <Text style={[styles.sectionTitle, { color: palette.textSecondary }]}>ALTE DATE UTILE</Text>
      {renderGroup(false)}
    </>
  );
}

export function MedicalProfileDetails({ record }: { record: MedicalRecord }) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const filled = MEDICAL_PROFILE_FIELDS.filter(f => !!record[f.key]);
  if (filled.length === 0) return null;
  return (
    <View style={styles.details}>
      {filled.map(f => {
        const value = `${record[f.key]}${f.unit ? ` ${f.unit}` : ''}`;
        return (
          <View key={f.key} style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.textSecondary }]}>{f.label}</Text>
            {f.keyboard === 'phone-pad' ? (
              <Pressable onPress={() => Linking.openURL(`tel:${record[f.key]}`)}>
                <Text style={[styles.detailValue, { color: primary }]}>{value}</Text>
              </Pressable>
            ) : (
              <Text style={[styles.detailValue, { color: palette.text }]}>{value}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  details: {
    gap: 8,
    marginTop: 8,
  },
  detailRow: {
    gap: 2,
  },
  detailLabel: {
    fontSize: 12,
  },
  detailValue: {
    fontSize: 14,
  },
});
