# What's New — 3.15.0

## Varianta scurtă (pentru App Store)

```
• Securitate: cheia serviciului AI inclus nu mai este livrată în aplicație.
  Cererile trec printr-un server propriu, găzduit în Uniunea Europeană, care nu
  stochează documentele și nu păstrează jurnale ale conținutului.

• Completare automată mai rapidă și mai economică: când textul documentului este
  deja recunoscut pe telefon, nu îi mai cerem asistentului AI să îl transcrie a
  doua oară. Analiza durează mai puțin și consumă mult mai puțin din cota zilnică.

• Imaginile trimise spre analiză sunt redimensionate înainte de trimitere.

• Politica de confidențialitate a fost actualizată cu detalii despre procesarea AI.
```

## Varianta lungă (pentru site / changelog)

**Securitate**

Până acum, cheia serviciului AI inclus („Dosar AI") era livrată în interiorul
aplicației. Din 3.15.0 cheia rămâne pe un server operat de noi, în Uniunea
Europeană (Falkenstein, Germania). Serverul doar transmite cererea mai departe:
nu stochează documentele, textul sau răspunsurile și nu păstrează jurnale ale
conținutului.

Modelul local și cheia API proprie funcționează exact ca înainte — cererile lor
merg direct la furnizorul ales de tine, fără să treacă prin serverul nostru.

**Completare automată**

Când telefonul a recunoscut deja textul unui document, aplicația nu mai cere
asistentului AI să îl transcrie încă o dată. Textul recunoscut pe device este
trimis ca referință, iar imaginea rămâne doar pentru dezambiguizare vizuală
(scris de mână, formulare tipizate). Rezultatul: răspuns mai rapid și un consum
de câteva ori mai mic din cota zilnică.

Imaginile sunt redimensionate înainte de a fi trimise — o poză la rezoluție
maximă costa de câteva ori mai mult fără să îmbunătățească recunoașterea.

**Confidențialitate**

Secțiunea despre procesarea AI din politica de confidențialitate a fost
rescrisă: descrie serverul intermediar și clarifică faptul că, în funcție de
document, se trimite fie textul recunoscut, fie imaginea documentului.

---

## De discutat înainte de trimiterea la review

Cota gratuită Mistral e epuizată la data pregătirii release-ului, deci „Dosar AI"
returnează „limită atinsă la provider" pentru toți utilizatorii până la resetul
lunar. Aplicația îi îndrumă corect spre model local sau cheie proprie.

Dacă starea persistă la momentul publicării, ia în calcul un rând suplimentar în
notele din App Store, ca să nu pară defecțiune:

```
• Serviciul AI inclus are cota lunară epuizată. Până la reînnoire, folosește
  modelul local (offline, nelimitat) sau o cheie API proprie — ambele din
  Setări → Asistent AI.
```
