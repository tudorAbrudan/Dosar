/**
 * Lock policy mai strictă pentru dosarul medical:
 *
 * - Folosește `useAppLock` ca bază. Dacă App Lock e activat global și e blocat,
 *   suntem și noi blocați.
 * - În plus: dacă app-ul a fost în background mai mult de 5 minute, blocăm
 *   independent (chiar dacă App Lock global e dezactivat). Tab Chat și ecranul
 *   detail dosar trebuie să fie întotdeauna în spatele acestui timeout.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAppLock } from './useAppLock';
import { getMedicalAppLockEnabled } from '@/services/settings';

const MEDICAL_TIMEOUT_MS = 5 * 60 * 1000;

interface MedicalLockState {
  /** True dacă App Lock global e blocat SAU timeout-ul medical s-a scurs. */
  locked: boolean;
  /**
   * True dacă App Lock medical e activat (setare separată). Când false,
   * ecranul medical nu afișează lock guard.
   */
  lockEnabled: boolean;
  /** True dacă biometric-ul e disponibil pe device. */
  biometricAvailable: boolean;
  /** Încercăm unlock cu biometric. La succes resetăm și timeout-ul medical. */
  unlockWithBiometric(): Promise<boolean>;
  unlockWithPin(pin: string): Promise<boolean>;
}

export function useMedicalLock(): MedicalLockState {
  const base = useAppLock();
  const [medicalLocked, setMedicalLocked] = useState(false);
  const [medicalLockEnabled, setMedicalLockEnabled] = useState(true);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    getMedicalAppLockEnabled().then(setMedicalLockEnabled);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAtRef.current = Date.now();
      } else if (next === 'active') {
        const bgAt = backgroundedAtRef.current;
        if (bgAt != null && Date.now() - bgAt > MEDICAL_TIMEOUT_MS) {
          setMedicalLocked(true);
        }
        backgroundedAtRef.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    // Dacă App Lock global e activ, încercăm unlock-ul lui; dacă nu, doar
    // resetăm timeout-ul medical (nu există PIN/biometric separat).
    if (base.lockEnabled) {
      const ok = await base.unlockWithBiometric();
      if (ok) setMedicalLocked(false);
      return ok;
    }
    setMedicalLocked(false);
    return true;
  }, [base]);

  const unlockWithPin = useCallback(
    async (pin: string) => {
      if (base.lockEnabled) {
        const ok = await base.unlockWithPin(pin);
        if (ok) setMedicalLocked(false);
        return ok;
      }
      setMedicalLocked(false);
      return true;
    },
    [base]
  );

  return {
    locked: base.locked || medicalLocked,
    lockEnabled: medicalLockEnabled,
    biometricAvailable: base.biometricAvailable,
    unlockWithBiometric,
    unlockWithPin,
  };
}
