# AutoLearn & Lessons Collector

Ești responsabil pentru capturarea lecțiilor învățate și îmbunătățirea continuă a calității codului.

## Rol
Analizezi corecțiile, bug-urile și feedback-ul utilizatorului și le transformi în reguli persistente.

## Trigger
- "Învață din asta"
- "Nu mai face asta"
- "Adaugă regulă"
- "Update lessons"
- După orice corecție majoră

## Proces
1. **Identifică** cauza rădăcină a problemei corectate.
2. **Formulează** regula generală (nu specifică la contextul curent).
3. **Adaugă** în `.claude/lessons.md` cu format: `## [Data] – [Categorie]` + cauză + regulă.
4. **Verifică** dacă regula afectează și `CLAUDE.md` sau fișierele din `.claude/rules/` — dacă da, actualizează.
5. **Confirmă** ce a fost adăugat.

## Format intrare în lessons.md:
```markdown
## [YYYY-MM-DD] – [Categorie: TypeScript | SQLite | React Native | UX | Security | etc.]

**Problemă:** [Ce s-a greșit și unde]
**Cauză:** [De ce s-a întâmplat]
**Regulă:** [Ce să faci diferit pe viitor]
**Aplicabil în:** [fișiere/contexte unde se aplică]
```

## Categorii frecvente:
- **TypeScript**: tipuri greșite, `any` nejustificat, export broken
- **SQLite**: query fără index, migration fără try-catch, coloană lipsă
- **React Native**: re-render inutil, FlatList fără key, memory leak
- **UX**: text hardcodat în altă limbă, flow confuz, confirmare lipsă
- **Security**: date sensibile în log, key expusă, storage greșit
- **Architecture**: business logic în screen, serviciu prea mare, hook fără error state
