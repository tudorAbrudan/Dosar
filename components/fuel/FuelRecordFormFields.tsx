/**
 * Câmpurile din modalul de adăugare/editare bon alimentare în FuelScreen.
 * Părintele gestionează state-ul și `onSave`/OCR.
 */
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useTheme } from '@react-navigation/native';

import { Text } from '@/components/Themed';
import { DatePickerField } from '@/components/DatePickerField';
import { dark, light, primary, statusColors } from '@/theme/colors';

interface FuelRecordFormFieldsProps {
  scheme: 'light' | 'dark' | null | undefined;
  loading: boolean;
  date: string;
  station: string;
  pump: string;
  liters: string;
  priceL: string;
  price: string;
  km: string;
  isFull: boolean;
  errorBorderColor: string;
  hasMathError: boolean;
  mathErrorMessage: string;
  lastKm?: number;
  onChangeDate: (value: string) => void;
  onChangeStation: (value: string) => void;
  onChangePump: (value: string) => void;
  onChangeLiters: (value: string) => void;
  onChangePriceL: (value: string) => void;
  onChangePrice: (value: string) => void;
  onChangeKm: (value: string) => void;
  onChangeIsFull: (value: boolean) => void;
  onScanReceipt: () => void;
}

export function FuelRecordFormFields(props: FuelRecordFormFieldsProps) {
  const { colors } = useTheme();
  const palette = props.scheme === 'dark' ? dark : light;
  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.ocrBtn, pressed && styles.btnPressed]}
        onPress={props.onScanReceipt}
        disabled={props.loading}
      >
        <Text style={styles.ocrBtnText} numberOfLines={1}>
          {props.loading ? 'Se analizează bonul...' : '📷 Scanează bon'}
        </Text>
      </Pressable>

      <DatePickerField
        label="Data"
        value={props.date}
        onChange={props.onChangeDate}
        disabled={props.loading}
      />

      <Field
        label="Benzinărie"
        value={props.station}
        onChangeText={props.onChangeStation}
        placeholder="Ex: OMV Cluj-Napoca, Calea Turzii"
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
      />

      <Field
        label="Nr. pompă"
        value={props.pump}
        onChangeText={props.onChangePump}
        placeholder="Ex: 4"
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
      />

      <Field
        label="Litri"
        value={props.liters}
        onChangeText={props.onChangeLiters}
        placeholder="Ex: 45.23"
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
        keyboardType="decimal-pad"
        borderColor={props.errorBorderColor}
      />

      <Field
        label="Preț/litru (RON)"
        value={props.priceL}
        onChangeText={props.onChangePriceL}
        placeholder="Ex: 9.82"
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
        keyboardType="decimal-pad"
        borderColor={props.errorBorderColor}
      />

      <Field
        label="Preț total (RON)"
        value={props.price}
        onChangeText={props.onChangePrice}
        placeholder="Ex: 280.50"
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
        keyboardType="decimal-pad"
        borderColor={props.errorBorderColor}
      />

      {props.hasMathError && (
        <View
          style={[
            styles.mathWarning,
            { borderColor: statusColors.critical, backgroundColor: `${statusColors.critical}14` },
          ]}
        >
          <Text style={[styles.mathWarningTitle, { color: statusColors.critical }]}>
            ⚠ Verifică valorile
          </Text>
          <Text style={[styles.mathWarningBody, { color: colors.text }]}>
            {props.mathErrorMessage}
          </Text>
        </View>
      )}

      <Field
        label="KM total (odometru)"
        value={props.km}
        onChangeText={props.onChangeKm}
        placeholder={
          props.lastKm !== undefined
            ? `Anterior: ${props.lastKm.toLocaleString('ro-RO')}`
            : 'Ex: 125430'
        }
        disabled={props.loading}
        palette={palette}
        textColor={colors.text}
        keyboardType="number-pad"
      />

      <View style={styles.isFullRow}>
        <Text style={[styles.label, { color: palette.textSecondary }]}>Plin complet</Text>
        <Switch
          value={props.isFull}
          onValueChange={props.onChangeIsFull}
          trackColor={{ false: palette.border, true: primary }}
          disabled={props.loading}
        />
      </View>
      {!props.isFull && (
        <Text style={[styles.isFullHint, { color: palette.textSecondary }]}>
          Litrii nu vor fi contați în consum până la următorul plin complet.
        </Text>
      )}
    </>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  palette: typeof light;
  textColor: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  borderColor?: string;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  disabled,
  palette,
  textColor,
  keyboardType = 'default',
  borderColor,
}: FieldProps) {
  return (
    <View>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: borderColor ?? palette.border,
            color: textColor,
            backgroundColor: palette.background,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textSecondary}
        keyboardType={keyboardType}
        editable={!disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 14,
  },
  ocrBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 18,
  },
  ocrBtnText: { color: primary, fontSize: 15, fontWeight: '600' },
  btnPressed: { opacity: 0.7 },
  isFullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 8,
  },
  isFullHint: { fontSize: 11, fontStyle: 'italic', marginBottom: 14 },
  mathWarning: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  mathWarningTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  mathWarningBody: { fontSize: 12, lineHeight: 17 },
});
