---
paths:
  - "theme/**"
  - "components/**"
  - "constants/Colors.ts"
  - "constants/Theme.ts"
  - "app/(tabs)/**/*.tsx"
---

# Design System – EVPoint + #9EB567

**Sursă:** EVPoint EV Charging Station Finder App UI Kit (Figma node 2627-26364)
**Modificare obligatorie:** orice verde din EVPoint → `#9EB567`
**Detalii complete:** `../docs/DESIGN_SYSTEM.md`

## Theme preference – REGULA #0

**`useColorScheme` se importă DOAR din `@/components/useColorScheme`**, niciodată din `react-native`.

```ts
import { useColorScheme } from '@/components/useColorScheme'; // ✅
import { useColorScheme } from 'react-native';                // ❌
```

Motivul: app-ul expune o setare "Aspect: Auto / Deschis / Întunecat" stocată în `ThemePreferenceContext`. Hook-ul din `react-native` returnează doar schema OS-ului și ignoră această preferință — rezultat: UI afișează dark deși utilizatorul a cerut light (sau invers).

**Singura excepție:** `app/_layout.tsx` folosește `useColorScheme as useColorSchemeNative` pentru a combina valoarea system cu preferința stocată și o injectează în `ThemePreferenceContext.Provider`. Nicăieri altundeva.

Pattern standard în orice componentă care randează vizual:
```ts
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';

const scheme = useColorScheme();
const palette = scheme === 'dark' ? dark : light;
// palette.card, palette.background, palette.surface,
// palette.text, palette.textSecondary, palette.border, palette.cardShadow
```

## Culori – REGULA #1

**Nu hardcoda niciodată culori în componente.** Importă din `@/theme/colors.ts`.

| Rol | Valoare |
|-----|---------|
| Primary (CTA, activ, link) | `#9EB567` |
| Background light | `#f5f5f5` |
| Background dark | `#121212` |
| Surface/card light | `#ffffff` |
| Surface/card dark | `#1e1e1e` |
| Text principal light | `#1a1a1a` |
| Text principal dark | `#f5f5f5` |

Folosire:
```tsx
import { useTheme } from '@react-navigation/native';
// sau
import { AppColors } from '@/theme/colors';

const { colors } = useTheme(); // colors.primary, colors.background, etc.
```

## Spacing

Grid de 8: `8, 16, 24, 32` px. Fără valori arbitrare (ex. nu `13px`).

## Carduri (EVPoint style)

```tsx
{
  backgroundColor: colors.card,
  borderRadius: 12,
  padding: 16,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,  // Android
}
```

## Butoane

- **Primary:** `backgroundColor: colors.primary` (`#9EB567`), height 48, borderRadius 12, text alb bold
- **Secondary:** border `colors.primary`, transparent background
- **Text:** fără background, text `colors.primary`

## Tipografie

- Fonturi native (iOS: SF Pro, Android: Roboto)
- Titluri: 20–24px, fontWeight `'600'` sau `'700'`
- Body: 14–16px, fontWeight `'400'`
- Label/caption: 12px, fontWeight `'400'`

## Navigare

- Tab bar: 5 tab-uri (Home, Entități, Documente, Expirări, Setări)
- Tab activ: `colors.primary` (#9EB567)
- Header: background `colors.card`, shadow ușoară

## Texte UI

**Toate textele vizibile utilizatorului sunt în română.** Fără engleză în UI.

## Verificare design / Checklist code review

Înainte de orice commit cu modificări de UI:
- [ ] `useColorScheme` importat din `@/components/useColorScheme` (nu `react-native`)?
- [ ] Zero `backgroundColor: '#...'`, `color: '#...'`, `borderColor: '#...'` hardcodate (nici în `StyleSheet.create`, nici inline)?
- [ ] `TextInput` are `placeholderTextColor={palette.textSecondary}`?
- [ ] `Switch` are `trackColor` explicit (dacă nu, default-ul e alb și dispare pe tema deschisă)?
- [ ] Carduri / modaluri / banner-uri folosesc `palette.card` sau `palette.surface`?
- [ ] Spacing-ul e multiplu de 8
- [ ] Primary color e `#9EB567` (nu alt verde)
- [ ] Textele sunt în română

Excepții acceptate pentru culori literale:
- `'transparent'`
- `statusColors.{ok,warning,critical}` importate din paletă
- Compoziții cu alpha pe valori din paletă (ex. `${palette.border}80`)
