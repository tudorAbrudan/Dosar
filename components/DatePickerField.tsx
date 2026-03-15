import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

interface DatePickerFieldProps {
  label: string;
  value: string; // YYYY-MM-DD sau ''
  onChange: (value: string) => void; // YYYY-MM-DD sau ''
  placeholder?: string;
  disabled?: boolean;
}

/** Convertește YYYY-MM-DD → ZZ.LL.AAAA */
function valueToDisplay(value: string): string {
  if (!value || value.length < 10) return '';
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return '';
  return `${d}.${m}.${y}`;
}

/** Auto-formatează input numeric → ZZ.LL.AAAA, returnează YYYY-MM-DD sau '' */
function formatInput(raw: string): { display: string; value: string } {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let display = digits;
  if (digits.length > 2) display = `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length > 4) display = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;

  let isoValue = '';
  if (digits.length === 8) {
    const d = digits.slice(0, 2);
    const m = digits.slice(2, 4);
    const y = digits.slice(4, 8);
    const date = new Date(`${y}-${m}-${d}`);
    if (!isNaN(date.getTime())) {
      isoValue = `${y}-${m}-${d}`;
    }
  }

  return { display, value: isoValue };
}

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = 'ZZ.LL.AAAA',
  disabled = false,
}: DatePickerFieldProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [display, setDisplay] = useState<string>(valueToDisplay(value));
  const [focused, setFocused] = useState(false);
  // Ref pentru a păstra mereu ultima valoare ISO (evită stale closure la submit)
  const latestValue = useRef(value);

  // Sincronizează display când value vine din exterior (OCR, reset)
  useEffect(() => {
    if (value !== latestValue.current) {
      latestValue.current = value;
      setDisplay(valueToDisplay(value));
    }
  }, [value]);

  function handleChange(raw: string) {
    const { display: newDisplay, value: newValue } = formatInput(raw);
    latestValue.current = newValue;
    setDisplay(newDisplay);
    onChange(newValue);
  }

  function handleClear() {
    setDisplay('');
    onChange('');
  }

  const hasValue = display.length > 0;

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: C.text }]}>{label}</Text>
      <View
        style={[
          styles.container,
          { borderColor: focused ? '#9EB567' : C.border, backgroundColor: C.background },
        ]}
      >
        <TextInput
          style={[styles.input, { color: C.text }]}
          value={display}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={C.textSecondary ?? '#999'}
          keyboardType="numeric"
          maxLength={10}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {hasValue && !disabled && (
          <Pressable onPress={handleClear} style={styles.clearBtn} hitSlop={8}>
            <Text style={[styles.clearText, { color: C.textSecondary ?? '#999' }]}>✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    marginBottom: 6,
    opacity: 0.9,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  clearBtn: {
    paddingLeft: 8,
  },
  clearText: {
    fontSize: 16,
  },
});
