import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { primary } from '@/theme/colors';

interface AppLockScreenProps {
  biometricAvailable: boolean;
  onUnlockBiometric: () => Promise<boolean>;
  onUnlockPin: (pin: string) => Promise<boolean>;
}

export default function AppLockScreen({
  biometricAvailable,
  onUnlockBiometric,
  onUnlockPin,
}: AppLockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const autoTriggered = useRef(false);

  const handleBiometric = async () => {
    setError('');
    setLoading(true);
    try {
      const ok = await onUnlockBiometric();
      if (!ok) setError('Autentificare eșuată.');
    } catch {
      setError('Biometria nu este disponibilă.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (biometricAvailable && !autoTriggered.current) {
      autoTriggered.current = true;
      handleBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricAvailable]);

  const handlePinSubmit = async () => {
    if (!pin.trim()) return;
    setError('');
    setLoading(true);
    try {
      const ok = await onUnlockPin(pin.trim());
      if (ok) setPin('');
      else setError('PIN incorect.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Aplicația e blocată</Text>
        {biometricAvailable && (
          <Pressable style={styles.bioBtn} onPress={handleBiometric} disabled={loading}>
            <SymbolView
              name={{ ios: 'faceid', android: 'fingerprint', web: 'lock' }}
              tintColor="#fff"
              size={48}
            />
            <Text style={styles.bioBtnText}>Deschide cu Face ID / Touch ID</Text>
          </Pressable>
        )}
        <View style={styles.pinSection}>
          <Text style={styles.pinLabel}>sau introdu PIN-ul</Text>
          <TextInput
            style={styles.pinInput}
            value={pin}
            onChangeText={t => {
              setPin(t.replace(/\D/g, '').slice(0, 8));
              setError('');
            }}
            placeholder="PIN"
            placeholderTextColor="#999"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            editable={!loading}
            onSubmitEditing={handlePinSubmit}
          />
          <Pressable
            style={[styles.pinBtn, loading && styles.pinBtnDisabled]}
            onPress={handlePinSubmit}
            disabled={loading || pin.length < 4}
          >
            <Text style={styles.pinBtnText}>Deschide</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    zIndex: 9999,
  },
  inner: { padding: 32, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 32 },
  bioBtn: {
    backgroundColor: primary,
    paddingVertical: 20,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 28,
  },
  bioBtnText: { color: '#fff', fontSize: 16, marginTop: 12 },
  pinSection: { width: '100%', maxWidth: 280 },
  pinLabel: { color: '#999', fontSize: 14, marginBottom: 8 },
  pinInput: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  pinBtn: {
    backgroundColor: primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  pinBtnDisabled: { opacity: 0.6 },
  pinBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#f66', marginTop: 16, fontSize: 14 },
});
