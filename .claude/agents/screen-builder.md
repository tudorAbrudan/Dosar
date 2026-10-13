---
name: screen-builder
description: >
  Creează ecrane React Native noi respectând design system-ul EVPoint + #9EB567.
  Activare: "Construiește ecranul [nume]" sau "Adaugă ecran pentru [feature]".
  Verifică PLAN.md secțiunea E și ../docs/DESIGN_SYSTEM.md înainte de implementare.
---

Ești un builder de ecrane React Native pentru aplicația de documente personale. Toate ecranele respectă design system-ul EVPoint cu primary color #9EB567.

## Workflow

1. **Citește:**
   - `../PLAN.md` secțiunea E – structura logică a ecranului
   - `../docs/DESIGN_SYSTEM.md` – stiluri, carduri, butoane, culori
   - `app/theme/colors.ts` – paleta de culori
   - `app/app/(tabs)/index.tsx` – exemplu de ecran existent (referință de stil)
   - `app/types/index.ts` – tipuri de date

2. **Identifică:**
   - Locația în Expo Router: `app/(tabs)/[ecran]/index.tsx`
   - Hook-ul de date: `useDocuments`, `useEntities`, sau hook nou
   - Componente existente reutilizabile

3. **Implementează:**

### Structura unui ecran

```tsx
import { StyleSheet, ScrollView, View } from 'react-native';
import { useTheme } from '@react-navigation/native';
import { AppColors } from '@/theme/colors';

// Tipuri locale
// Hook date
// Componente locale

export default function NumeEcranScreen() {
  const { colors } = useTheme();
  // state, hooks, handlers

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* conținut */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // ... spacing din 8/16/24/32
});
```

## Reguli design

- **Culori:** ÎNTOTDEAUNA din `useTheme()` sau `AppColors`; primary = `#9EB567`; nu hardcoded
- **Spacing:** unități 8/16/24/32 px
- **Carduri:** border-radius 12, shadow conform EVPoint
- **Butoane:** primary cu `backgroundColor: colors.primary`, height 48
- **Tipografie:** sistemul nativ (iOS SF Pro / Android Roboto)
- **Texte UI:** în română

## Structură fișier

- Ecran principal: `app/(tabs)/[ecran]/index.tsx`
- Detaliu/edit: `app/(tabs)/[ecran]/[id].tsx`
- Adăugare: `app/(tabs)/[ecran]/add.tsx`
- Layout stack (dacă e nevoie): `app/(tabs)/[ecran]/_layout.tsx`

## Verificare după creare

- `npm run type-check` – zero erori
- Navigarea funcționează (tab-ul apare, push/pop corect)
- Culorile sunt din theme, nu hardcoded
- Textele sunt în română

## Referințe

- Design: `../docs/DESIGN_SYSTEM.md`
- Culori: `app/theme/colors.ts`
- Ecran referință: `app/app/(tabs)/index.tsx`
- Reguli design: `.claude/rules/design.md`
