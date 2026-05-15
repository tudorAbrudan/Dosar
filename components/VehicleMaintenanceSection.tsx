import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import { StyleSheet, View, Text, Alert } from 'react-native';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useMaintenanceTasks } from '@/hooks/useMaintenanceTasks';
import * as maintenance from '@/services/maintenance';
import {
  addMaintenanceCalendarEvent,
  updateMaintenanceCalendarEvent,
  deleteMaintenanceCalendarEvent,
  isCalendarAvailable,
} from '@/services/calendar';
import { MaintenanceTaskCard } from '@/components/maintenance/MaintenanceTaskCard';
import {
  MaintenanceFormFields,
  type MaintenanceFormState,
} from '@/components/maintenance/MaintenanceFormFields';
import type { VehicleMaintenanceTask, MaintenancePreset } from '@/types';

type Props = {
  vehicleId: string;
  vehicleName: string;
};

const emptyForm: MaintenanceFormState = {
  presetKey: 'custom',
  name: '',
  triggerKm: '',
  triggerMonths: '',
  lastDoneKm: '',
  lastDoneDate: '',
  note: '',
  addToCalendar: true,
};

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
    const [form, setForm] = useState<MaintenanceFormState>(emptyForm);
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

        {tasksWithStatus.map(({ task, status }) => (
          <MaintenanceTaskCard
            key={task.id}
            task={task}
            status={status}
            scheme={scheme}
            onPress={() => handleTaskOptions(task)}
          />
        ))}

        <FormSheetModal
          visible={modalVisible}
          title={editingId ? 'Editează mentenanță' : 'Adaugă mentenanță'}
          onClose={() => setModalVisible(false)}
          onSave={handleSave}
          saving={saving}
        >
          <MaintenanceFormFields
            form={form}
            scheme={scheme}
            currentKm={currentKm}
            calendarAvailable={calendarAvailable}
            onChange={setForm}
            onApplyPreset={applyPreset}
          />
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
  sectionTitle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  kmHint: { fontSize: 11, fontWeight: '500' },
});
