/**
 * Câmpurile din modalul de adăugare/editare task mentenanță: chips preset,
 * nume, interval km/luni, ultima efectuare, notă, toggle calendar.
 * Părintele (`VehicleMaintenanceSection`) gestionează state-ul și `onSave`.
 */
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { MAINTENANCE_PRESETS } from '@/services/maintenancePresets';
import type { MaintenancePreset, MaintenancePresetKey } from '@/types';

export type MaintenanceFormState = {
  presetKey: MaintenancePresetKey;
  name: string;
  triggerKm: string;
  triggerMonths: string;
  lastDoneKm: string;
  lastDoneDate: string;
  note: string;
  addToCalendar: boolean;
};

interface MaintenanceFormFieldsProps {
  form: MaintenanceFormState;
  scheme: 'light' | 'dark';
  currentKm: number | null;
  calendarAvailable: boolean;
  onChange: (updater: (f: MaintenanceFormState) => MaintenanceFormState) => void;
  onApplyPreset: (preset: MaintenancePreset) => void;
}

export function MaintenanceFormFields({
  form,
  scheme,
  currentKm,
  calendarAvailable,
  onChange,
  onApplyPreset,
}: MaintenanceFormFieldsProps) {
  const C = Colors[scheme];
  return (
    <>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Preset</Text>
        <View style={styles.presetRow}>
          {MAINTENANCE_PRESETS.map(p => {
            const active = form.presetKey === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => onApplyPreset(p)}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor: active ? primary : C.card,
                    borderColor: active ? primary : C.border,
                  },
                ]}
              >
                <Ionicons
                  name={p.icon as keyof typeof Ionicons.glyphMap}
                  size={14}
                  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
                  color={active ? '#fff' : C.text}
                />
                <Text
                  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
                  style={[styles.presetChipText, { color: active ? '#fff' : C.text }]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Nume</Text>
        <TextInput
          value={form.name}
          onChangeText={t => onChange(f => ({ ...f, name: t }))}
          placeholder="ex: Schimb ulei"
          placeholderTextColor={C.textSecondary}
          style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
        />
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: C.textSecondary }]}>Interval km</Text>
          <TextInput
            value={form.triggerKm}
            onChangeText={t => onChange(f => ({ ...f, triggerKm: t.replace(/[^0-9]/g, '') }))}
            placeholder="ex: 15000"
            placeholderTextColor={C.textSecondary}
            keyboardType="number-pad"
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: C.textSecondary }]}>Interval luni</Text>
          <TextInput
            value={form.triggerMonths}
            onChangeText={t => onChange(f => ({ ...f, triggerMonths: t.replace(/[^0-9]/g, '') }))}
            placeholder="ex: 12"
            placeholderTextColor={C.textSecondary}
            keyboardType="number-pad"
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
        </View>
      </View>
      <Text style={[styles.helper, { color: C.textSecondary }]}>
        Setează cel puțin un prag. Task-ul e „due" când oricare e atins.
      </Text>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: C.textSecondary }]}>Ultima efectuare — km</Text>
          <TextInput
            value={form.lastDoneKm}
            onChangeText={t => onChange(f => ({ ...f, lastDoneKm: t.replace(/[^0-9]/g, '') }))}
            placeholder={currentKm != null ? currentKm.toLocaleString('ro-RO') : 'opțional'}
            placeholderTextColor={C.textSecondary}
            keyboardType="number-pad"
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: C.textSecondary }]}>Ultima efectuare — dată</Text>
          <TextInput
            value={form.lastDoneDate}
            onChangeText={t => onChange(f => ({ ...f, lastDoneDate: t }))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.textSecondary}
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
        </View>
      </View>

      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Notă (opțional)</Text>
        <TextInput
          value={form.note}
          onChangeText={t => onChange(f => ({ ...f, note: t }))}
          placeholder="ex: schimbat la service Popescu"
          placeholderTextColor={C.textSecondary}
          multiline
          style={[
            styles.input,
            {
              color: C.text,
              borderColor: C.border,
              backgroundColor: C.card,
              height: 80,
              textAlignVertical: 'top',
              paddingTop: 12,
            },
          ]}
        />
      </View>

      {calendarAvailable && form.triggerMonths.trim() ? (
        <View style={[styles.calendarRow, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.calendarTitle, { color: C.text }]}>Adaugă în calendar</Text>
            <Text style={[styles.calendarHint, { color: C.textSecondary }]}>
              Reminder cu 7 zile înainte de scadența pe luni. Se actualizează automat când marchezi
              intervenția ca efectuată.
            </Text>
          </View>
          <Switch
            value={form.addToCalendar}
            onValueChange={v => onChange(f => ({ ...f, addToCalendar: v }))}
            trackColor={{ false: C.border, true: primary }}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row2: { flexDirection: 'row', gap: 12 },
  helper: { fontSize: 11, marginTop: -8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  presetChipText: { fontSize: 12, fontWeight: '500' },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  calendarTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  calendarHint: { fontSize: 12 },
});
