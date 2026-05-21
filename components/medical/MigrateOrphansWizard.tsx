import { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { Text } from '@/components/Themed';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { createMedicalRecord, findPersonsWithOrphanMedicalDocs } from '@/services/medicalRecord';
import { emit } from '@/services/events';
import type { Person } from '@/types';

interface Props {
  visible: boolean;
  onClose(): void;
  onDone(createdCount: number): void;
}

export function MigrateOrphansWizard({ visible, onClose, onDone }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [orphans, setOrphans] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    findPersonsWithOrphanMedicalDocs().then(list => {
      setOrphans(list);
      setSelected(new Set(list.map(p => p.id)));
    });
  }, [visible]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = useCallback(async () => {
    if (saving) return;
    if (selected.size === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      let count = 0;
      for (const p of orphans) {
        if (!selected.has(p.id)) continue;
        await createMedicalRecord({ person_id: p.id, name: `Dosar ${p.name}` });
        count++;
      }
      emit('entities:changed');
      onDone(count);
      onClose();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Migrarea a eșuat.');
    } finally {
      setSaving(false);
    }
  }, [saving, selected, orphans, onClose, onDone]);

  return (
    <FormSheetModal
      visible={visible}
      title="Migrează la dosar medical"
      onClose={onClose}
      onSave={handleCreate}
      saveLabel={saving ? 'Se creează...' : 'Creează dosare'}
      saveDisabled={saving || selected.size === 0}
      saving={saving}
    >
      <View style={styles.container}>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          Aceste persoane au documente medicale dar nu au încă un dosar medical dedicat. Bifează
          cele pentru care vrei să creezi un dosar.
        </Text>
        {orphans.length === 0 ? (
          <Text style={[styles.empty, { color: palette.text }]}>
            Niciun document medical orfan.
          </Text>
        ) : (
          <View style={styles.list}>
            {orphans.map(p => {
              const isSelected = selected.has(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => toggle(p.id)}
                  style={[
                    styles.row,
                    {
                      backgroundColor: isSelected ? palette.surface : palette.card,
                      borderColor: isSelected ? primary : palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? primary : palette.textSecondary}
                    style={styles.checkbox}
                  />
                  <Text style={[styles.personName, { color: palette.text }]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </FormSheetModal>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 32,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  checkbox: {
    marginRight: 12,
  },
  personName: {
    fontSize: 16,
    flex: 1,
  },
});
