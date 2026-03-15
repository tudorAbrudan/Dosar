# AutoLearn – /autolearn

Capturează o lecție dintr-o corecție sau feedback și o persistă în `.claude/lessons.md`.

## Trigger
Rulează după orice corecție majoră sau când utilizatorul spune "nu mai face asta", "învață", "adaugă regulă".

## Pași

### 1. Identifică lecția
Analizează ultimele modificări sau mesajul utilizatorului:
- Ce s-a greșit?
- Care e cauza rădăcină?
- Ce regulă generală previne repetarea?

### 2. Scrie intrarea în `.claude/lessons.md`
Format:
```
## [YYYY-MM-DD] – [Categorie]

**Problemă:** [descriere concisă]
**Cauză:** [de ce s-a întâmplat]
**Regulă:** [ce să faci diferit]
**Aplicabil în:** [contexte/fișiere]
```

Categorii: TypeScript | SQLite | React Native | UX | Security | Architecture | Testing

### 3. Verifică dacă regula trebuie adăugată și în CLAUDE.md
Dacă e o regulă generală aplicabilă la orice task, adaug-o și în `.claude/rules/` (secțiunea potrivită).

### 4. Confirmă
Afișează ce a fost adăugat și unde.
