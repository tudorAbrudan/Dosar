import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import { StyleSheet, View, Text, Pressable, TextInput, Switch, Alert } from 'react-native';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { useMaintenanceTasks } from '@/hooks/useMaintenanceTasks';
import * as maintenance from '@/services/maintenance';
import {
  addMaintenanceCalendarEvent,
  updateMaintenanceCalendarEvent,
  deleteMaintenanceCalendarEvent,
  isCalendarAvailable,
} from '@/services/calendar';
import { MAINTENANCE_PRESETS, getPreset } from '@/services/maintenancePresets';
import type { VehicleMaintenanceTask, MaintenancePreset, MaintenancePresetKey } from '@/types';

type Props = {
  vehicleId: string;
  vehicleName: string;
};

type FormState = {
  presetKey: MaintenancePresetKey;
  name: string;
  triggerKm: string;
  triggerMonths: string;
  lastDoneKm: string;
  lastDoneDate: string;
  note: string;
  addToCalendar: boolean;
};

const emptyForm: FormState = {
  presetKey: 'custom',
  name: '',
  triggerKm: '',
  triggerMonths: '',
  lastDoneKm: '',
  lastDoneDate: '',
  note: '',
  addToCalendar: true,
};

function statusColor(s: 'ok' | 'warning' | 'critical'): string {
  if (s === 'critical') return statusColors.critical;
  if (s === 'warning') return statusColors.warning;
  return statusColors.ok;
}

export type VehicleMaintenanceSectionHandle = {
  openAddModal: () => void;
};

export const VehicleMaintenanceSection = forwardRef<VehicleMaintenanceSectionHandle, Props>(
  function VehicleMaintenanceSection({ vehicleId, vehicleName }, ref) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const C = Colors[scheme];
    const { tasks, currentKm, refresh } = useMaintenanceTasks(vehicleId);
    const calendarAvailable = isCalendarAvailable();

    const [modalVisible, setModalVisible] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);

    const openAddModal = useCallback(() => {
      setEditingId(null);
      setForm({ ...emptyForm, lastDoneDate: new Date().toISOString().slice(0, 10) });
      setModalVisible(true);
    }, []);

    useImperativeHandle(ref, () => ({ openAddModal }), [openAddModal]);

    const openEditModal = useCallback((t: VehicleMaintenanceTask) => {
      setEditingId(t.id);
      setForm({
        presetKey: t.preset_key ?? 'custom',
        name: t.name,
        triggerKm: t.trigger_km != null ? String(t.trigger_km) : '',
        triggerMonths: t.trigger_months != null ? String(t.trigger_months) : '',
        lastDoneKm: t.last_done_km != null ? String(t.last_done_km) : '',
        lastDoneDate: t.last_done_date ?? '',
        note: t.note ?? '',
        addToCalendar: !!t.calendar_event_id,
      });
      setModalVisible(true);
    }, []);

    const applyPreset = useCallback((preset: MaintenancePreset) => {
      setForm(f => ({
        ...f,
        presetKey: preset.key,
        name: preset.key === 'custom' ? f.name : preset.name,
        triggerKm: preset.trigger_km != null ? String(preset.trigger_km) : '',
        triggerMonths: preset.trigger_months != null ? String(preset.trigger_months) : '',
      }));
    }, []);

    const handleSave = useCallback(async () => {
      const trimmedName = form.name.trim();
      if (!trimmedName) {
        Alert.alert('Nume lipsă', 'Introdu un nume pentru task.');
        return;
      }
      const triggerKm = form.triggerKm.trim() ? parseInt(form.triggerKm, 10) : undefined;
      const triggerMonths = form.triggerMonths.trim()
        ? parseInt(form.triggerMonths, 10)
        : undefined;
      if (triggerKm == null && triggerMonths == null) {
        Alert.alert('Prag lipsă', 'Setează cel puțin un prag (km sau luni).');
        return;
      }
      if (triggerKm != null && (isNaN(triggerKm) || triggerKm <= 0)) {
        Alert.alert('Km invalid', 'Valoarea km trebuie să fie un număr pozitiv.');
        return;
      }
      if (triggerMonths != null && (isNaN(triggerMonths) || triggerMonths <= 0)) {
        Alert.alert('Luni invalide', 'Valoarea lunilor trebuie să fie un număr pozitiv.');
        return;
      }
      const lastDoneKm = form.lastDoneKm.trim() ? parseInt(form.lastDoneKm, 10) : undefined;
      if (lastDoneKm != null && (isNaN(lastDoneKm) || lastDoneKm < 0)) {
        Alert.alert('Km invalid', 'Km-ul ultimei efectuări nu poate fi negativ.');
        return;
      }
      const lastDoneDate = form.lastDoneDate.trim() || undefined;

      setSaving(true);
      try {
        let taskId: string;
        let existingEventId: string | undefined;
        if (editingId) {
          const before = await maintenance.getMaintenanceTask(editingId);
          existingEventId = before?.calendar_event_id;
          await maintenance.updateMaintenanceTask(editingId, {
            name: trimmedName,
            preset_key: form.presetKey,
            trigger_km: triggerKm,
            trigger_months: triggerMonths,
            last_done_km: lastDoneKm,
            last_done_date: lastDoneDate,
            note: form.note.trim() || undefined,
          });
          taskId = editingId;
        } else {
          const created = await maintenance.createMaintenanceTask({
            vehicle_id: vehicleId,
            name: trimmedName,
            preset_key: form.presetKey,
            trigger_km: triggerKm,
            trigger_months: triggerMonths,
            last_done_km: lastDoneKm,
            last_done_date: lastDoneDate,
            note: form.note.trim() || undefined,
          });
          taskId = created.id;
        }

        // Sync calendar (dacă e disponibil, utilizatorul dorește calendar și există trigger_months)
        if (calendarAvailable) {
          const updated = await maintenance.getMaintenanceTask(taskId);
          if (updated) {
            const wantsCalendar = form.addToCalendar && triggerMonths != null;
            if (wantsCalendar && existingEventId) {
              const newId = await updateMaintenanceCalendarEvent(
                existingEventId,
                updated,
                vehicleName
              );
              if (newId !== existingEventId) {
                await maintenance.setMaintenanceCalendarEventId(taskId, newId);
              }
            } else if (wantsCalendar && !existingEventId) {
              const newId = await addMaintenanceCalendarEvent(updated, vehicleName);
              if (newId) {
                await maintenance.setMaintenanceCalendarEventId(taskId, newId);
              }
            } else if (!wantsCalendar && existingEventId) {
              await deleteMaintenanceCalendarEvent(existingEventId);
              await maintenance.setMaintenanceCalendarEventId(taskId, null);
            }
          }
        }

        setModalVisible(false);
        await refresh();
      } catch (e) {
        Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva task-ul.');
      } finally {
        setSaving(false);
      }
    }, [editingId, form, vehicleId, vehicleName, calendarAvailable, refresh]);

    const handleMarkDone = useCallback(
      (task: VehicleMaintenanceTask) => {
        Alert.alert(
          'Marchează efectuat',
          `Confirmă că „${task.name}" a fost efectuat acum${
            currentKm != null ? ` (km actual: ${currentKm.toLocaleString('ro-RO')})` : ''
          }.`,
          [
            { text: 'Anulează', style: 'cancel' },
            {
              text: 'Confirmă',
              onPress: async () => {
                try {
                  await maintenance.markMaintenanceDone(
                    task.id,
                    currentKm ?? undefined,
                    new Date().toISOString().slice(0, 10)
                  );

                  // Calendar: dacă task-ul avea eveniment și are încă trigger_months,
                  // actualizează evenimentul cu noua dată. Dacă nu mai are trigger_months,
                  // șterge-l. Asta acoperă cazul "km a declanșat mai repede": după mark done,
                  // următorul reminder e calculat de la data actuală.
                  if (calendarAvailable && task.calendar_event_id) {
                    const updated = await maintenance.getMaintenanceTask(task.id);
                    if (updated) {
                      const newId = await updateMaintenanceCalendarEvent(
                        task.calendar_event_id,
                        updated,
                        vehicleName
                      );
                      if (newId !== task.calendar_event_id) {
                        await maintenance.setMaintenanceCalendarEventId(task.id, newId);
                      }
                    }
                  }

                  await refresh();
                } catch (e) {
                  Alert.alert(
                    'Eroare',
                    e instanceof Error ? e.message : 'Nu s-a putut marca efectuat.'
                  );
                }
              },
            },
          ]
        );
      },
      [currentKm, vehicleName, calendarAvailable, refresh]
    );

    const handleDelete = useCallback(
      (task: VehicleMaintenanceTask) => {
        Alert.alert('Șterge task', `Ștergi „${task.name}"?`, [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Șterge',
            style: 'destructive',
            onPress: async () => {
              try {
                if (calendarAvailable && task.calendar_event_id) {
                  await deleteMaintenanceCalendarEvent(task.calendar_event_id);
                }
                await maintenance.deleteMaintenanceTask(task.id);
                await refresh();
              } catch (e) {
                Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge.');
              }
            },
          },
        ]);
      },
      [calendarAvailable, refresh]
    );

    const handleTaskOptions = useCallback(
      (task: VehicleMaintenanceTask) => {
        Alert.alert(task.name, 'Ce vrei să faci?', [
          { text: 'Anulează', style: 'cancel' },
          { text: 'Marchează efectuat', onPress: () => handleMarkDone(task) },
          { text: 'Editează', onPress: () => openEditModal(task) },
          { text: 'Șterge', style: 'destructive', onPress: () => handleDelete(task) },
        ]);
      },
      [handleMarkDone, openEditModal, handleDelete]
    );

    const tasksWithStatus = useMemo(
      () =>
        tasks.map(t => ({
          task: t,
          status: maintenance.computeTaskStatus(t, currentKm),
        })),
      [tasks, currentKm]
    );

    return (
      <>
        {tasksWithStatus.length > 0 ? (
          <View style={styles.headerRow}>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>MENTENANȚĂ</Text>
            {currentKm != null ? (
              <Text style={[styles.kmHint, { color: C.textSecondary }]}>
                {currentKm.toLocaleString('ro-RO')} km
              </Text>
            ) : null}
          </View>
        ) : null}

        {tasksWithStatus.length === 0
          ? null
          : tasksWithStatus.map(({ task, status }) => {
              const preset = getPreset(task.preset_key);
              const iconName = (preset?.icon ??
                'construct-outline') as keyof typeof Ionicons.glyphMap;
              const color = statusColor(status.status);
              return (
                <Pressable
                  key={task.id}
                  onPress={() => handleTaskOptions(task)}
                  style={[
                    styles.taskCard,
                    { backgroundColor: C.card, borderColor: C.border, borderLeftColor: color },
                  ]}
                >
                  <View style={[styles.taskIcon, { backgroundColor: `${color}22` }]}>
                    <Ionicons name={iconName} size={20} color={color} />
                  </View>
                  <View style={styles.taskBody}>
                    <Text style={[styles.taskName, { color: C.text }]} numberOfLines={1}>
                      {task.name}
                    </Text>
                    <Text style={[styles.taskDue, { color }]} numberOfLines={1}>
                      {status.dueMessage}
                    </Text>
                    <Text style={[styles.taskMeta, { color: C.textSecondary }]} numberOfLines={1}>
                      Interval:{' '}
                      {task.trigger_km != null
                        ? `${task.trigger_km.toLocaleString('ro-RO')} km`
                        : '—'}
                      {task.trigger_km != null && task.trigger_months != null ? ' / ' : ''}
                      {task.trigger_months != null
                        ? `${task.trigger_months} luni`
                        : task.trigger_km == null
                          ? '—'
                          : ''}
                    </Text>
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={18} color={C.textSecondary} />
                </Pressable>
              );
            })}

        <FormSheetModal
          visible={modalVisible}
          title={editingId ? 'Editează mentenanță' : 'Adaugă mentenanță'}
          onClose={() => setModalVisible(false)}
          onSave={handleSave}
          saving={saving}
        >
          <View>
            <Text style={[styles.label, { color: C.textSecondary }]}>Preset</Text>
            <View style={styles.presetRow}>
              {MAINTENANCE_PRESETS.map(p => {
                const active = form.presetKey === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => applyPreset(p)}
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
                      color={active ? '#fff' : C.text}
                    />
                    <Text
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
              onChangeText={t => setForm(f => ({ ...f, name: t }))}
              placeholder="ex: Schimb ulei"
              placeholderTextColor={C.textSecondary}
              style={[
                styles.input,
                { color: C.text, borderColor: C.border, backgroundColor: C.card },
              ]}
            />
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: C.textSecondary }]}>Interval km</Text>
              <TextInput
                value={form.triggerKm}
                onChangeText={t => setForm(f => ({ ...f, triggerKm: t.replace(/[^0-9]/g, '') }))}
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
                onChangeText={t =>
                  setForm(f => ({ ...f, triggerMonths: t.replace(/[^0-9]/g, '') }))
                }
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
                onChangeText={t => setForm(f => ({ ...f, lastDoneKm: t.replace(/[^0-9]/g, '') }))}
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
              <Text style={[styles.label, { color: C.textSecondary }]}>
                Ultima efectuare — dată
              </Text>
              <TextInput
                value={form.lastDoneDate}
                onChangeText={t => setForm(f => ({ ...f, lastDoneDate: t }))}
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
              onChangeText={t => setForm(f => ({ ...f, note: t }))}
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
                  Reminder cu 7 zile înainte de scadența pe luni. Se actualizează automat când
                  marchezi intervenția ca efectuată.
                </Text>
              </View>
              <Switch
                value={form.addToCalendar}
                onValueChange={v => setForm(f => ({ ...f, addToCalendar: v }))}
                trackColor={{ false: C.border, true: primary }}
              />
            </View>
          ) : null}
        </FormSheetModal>
      </>
    );
  }
);

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  kmHint: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyText: {
    flex: 1,
    fontSize: 13,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: 8,
  },
  taskIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: {
    flex: 1,
    gap: 2,
  },
  taskName: {
    fontSize: 15,
    fontWeight: '600',
  },
  taskDue: {
    fontSize: 13,
    fontWeight: '500',
  },
  taskMeta: {
    fontSize: 11,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row2: {
    flexDirection: 'row',
    gap: 12,
  },
  helper: {
    fontSize: 11,
    marginTop: -8,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  calendarTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  calendarHint: {
    fontSize: 12,
  },
});
