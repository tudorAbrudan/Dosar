# Fix Quality – /fix-quality

Identifică și corectează automat problemele de calitate din codul modificat.

## Pași

### 1. Detectează fișierele modificate
```bash
git diff --name-only HEAD
git diff --name-only --cached
```

### 2. Rulează type-check
```bash
cd /Users/ax/work/documents/app && npm run type-check
```
Corectează orice erori TypeScript găsite.

### 3. Verifică hooks pattern
Pentru fiecare hook modificat verifică că are:
- `loading: boolean`
- `error: string | null`
- `refresh()` sau funcție echivalentă

### 4. Verifică error handling
Pentru fiecare `try { }` verifică că `catch` are mesaj în română, user-friendly.

### 5. Verifică imports
Fără `any` nejustificat. Fără `console.log` uitat.

### 6. Rulează lint fix
```bash
cd /Users/ax/work/documents/app && npm run lint:fix
```

### 7. Raport
- ✅/❌ TypeScript
- ✅/❌ Hook patterns
- ✅/❌ Error handling
- ✅/❌ ESLint
