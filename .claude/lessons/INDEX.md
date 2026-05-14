# Lessons Index

Cronologic, descrescător. Front-matter pe fiecare fișier: `date`, `tags`, `trigger`.

| Data | Subiect | Tags |
|---|---|---|
| 2026-04-22 | [iOS linker / pcm errors](2026-04-22-ios-linker-pcm.md) | ios, build, pods, xcode, linker |
| 2026-04-20 | [Checklist modificări fișiere mari](2026-04-20-checklist-fisiere-mari.md) | refactoring, large-files, ai-development |
| 2026-04-20 | [Image rerender alb după navigare](2026-04-20-image-rerender.md) | react-native, ios, navigation, image |
| 2026-04-20 | [`router.push` din Alert → ecran alb](2026-04-20-navigation-from-alert.md) | react-native, ios, navigation, alert |
| 2026-03-23 | [`expo prebuild` + deployment target](2026-03-23-expo-build-properties.md) | expo, prebuild, ios, podfile |
| 2026-03-15 | [Union types nu există la runtime](2026-03-15-union-types-runtime.md) | typescript, types, runtime |
| 2026-03-15 | [Hook async fără `error` state](2026-03-15-hook-error-state.md) | hooks, architecture, error-handling |
| 2026-03-15 | [Chei API ≠ `EXPO_PUBLIC_*`](2026-03-15-no-expo-public-secrets.md) | security, env, secrets, expo |
| 2026-03-15 | [SQLite: indexuri pe coloane filtrate](2026-03-15-sqlite-indexes.md) | sqlite, performance, indexes |
| 2026-03-15 | [Vizibilitate tipuri — sursă unică](2026-03-15-visibility-propagation.md) | architecture, hooks, document-types |

## Cum cauți

```bash
# după tag
grep -lE "^- " .claude/lessons/*.md | xargs grep -l "tags:.*ios"

# direct prin front-matter
grep -rh "^tags:" .claude/lessons/ | sort -u

# după trigger
grep -li "trigger:.*navigation" .claude/lessons/
```

## Convenția pentru o lecție nouă

1. Fișier nou `.claude/lessons/YYYY-MM-DD-<topic>.md` cu front-matter:
   ```yaml
   ---
   date: YYYY-MM-DD
   tags: [tag1, tag2, ...]
   trigger: una propoziție când se aplică
   ---
   ```
2. Conținut: **Problemă** → **Cauză** → **Regulă** → **Aplicabil**.
3. Adaugă rând nou în `INDEX.md` (tabelul de mai sus, cronologic descrescător).
