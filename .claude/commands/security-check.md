# Security Check – /security-check

Verifică securitatea și conformitatea GDPR a modificărilor curente.

## Pași

### 1. Scanează pentru date sensibile expuse
```bash
grep -r "console.log" /Users/ax/work/documents/app/services/ --include="*.ts"
grep -r "console.log" /Users/ax/work/documents/app/hooks/ --include="*.ts"
```
Raportează orice log care ar putea include date sensibile (name, document number, etc).

### 2. Verifică storage corect
- PIN / biometric → `expo-secure-store` ✓
- Setări → `AsyncStorage` ✓
- Date structurate → SQLite ✓
- Fișiere → `expo-file-system` sandbox ✓
- Chei API → NU în `EXPO_PUBLIC_*` (vizibile în bundle!)

### 3. Verifică GDPR completeness
- [ ] Export date funcțional (backup.ts exportBackup)
- [ ] Ștergere completă (toate tabelele + fișiere)
- [ ] Nicio transmisie date fără consimțământ

### 4. Verifică queries SQL
Caută parametrizare: toate queries trebuie să folosească `?` placeholders, nu template literals.

### 5. Raport
Grupat pe CRITIC | IMPORTANT | INFO.
