---
name: temps-limites
description: Met à jour les temps limites des championnats (championnats de Belgique de la KBZB / FRBN, championnats francophones FFBN) affichés dans l'application ESN Compétition (accueil « Championnats », fiche d'une épreuve). À utiliser à chaque nouvelle saison, quand la fédération publie un nouveau règlement, quand un championnat de l'application est passé, ou quand l'utilisateur dit que des temps limites ont changé.
---

# Temps limites des championnats

Les temps limites sont dans `public/data/qualifying.json`, publié avec l'application. L'application relit ce fichier à chaque ouverture : une mise à jour ne demande pas de nouvelle version, seulement ce fichier.

Ce sont des données publiques des fédérations (pas de nom de nageur) : le fichier est en clair.

## Règles

- **N'invente jamais un temps.** Chaque temps vient du règlement officiel, recopié tel qu'imprimé (virgule → point). Une cellule illisible : demande à l'utilisateur, ne devine pas.
- Vérifie à quelle colonne (âge, A ou B) appartient chaque temps avec `--positions` : une ligne avec moins de valeurs que de colonnes (ex. 13 et 14 ans seulement) se décale facilement.
- Garde la source exacte (`source` : l'adresse du PDF) de chaque championnat.

## Où trouver les règlements

- **Championnats de Belgique (KBZB / FRBN)** : belswim.be (actualités, calendrier national), PDF sous `https://www.belswim.be/storage/files/file/NNNN.pdf`.
  - Open petit bassin (décembre) : limites A et B, publiées vers octobre.
  - Open grand bassin (mai) : limites A et B, vers février-mars.
  - 11-14 ans et 15 ans et plus en grand bassin (été) : une limite par âge, au printemps.
  - **Pas de temps limite** pour les championnats de Belgique petit bassin 11-16 ans (novembre) : sélection par classement. On additionne les points World Aquatics d'épreuves imposées : 100 papillon (50 ou 100 m à 11-12 ans), dos, brasse et libre, 200 4 nages, et 400 libre à partir de 13 ans. Les 80 (11-12 ans) ou 96 (13-14 et 15-16 ans) premiers de l'outil « CB-BK 11-16 25m » sont sélectionnés. Ne les ajoute pas à `qualifying.json`. Règlement 2026 : belswim, fichier 2464.
- **Championnats francophones (FFBN)** : ffbn.be → Disciplines → Natation → « Compétitions et résultats » (invitations).
  - Le site refuse la lecture automatique : ouvre-le dans le navigateur intégré de l'application.
  - Les PDF sont hébergés sur `clubee-websites-prod.s3…` : leur adresse est dans le code de la page.
  - Les championnats en petit bassin (novembre) n'ont pas de limite (nombre de séries limité). Ceux en grand bassin (février) ont des « minima » : à ajouter quand l'invitation est publiée.
- Lis un PDF avec WebFetch : il enregistre le fichier, sans en donner le texte. Puis :
  - `node scripts/limits.mjs texte FICHIER.pdf` donne le texte du règlement.
  - `node scripts/limits.mjs texte FICHIER.pdf PAGE --positions` ajoute la position de chaque cellule (« 1:07,88@363 »).

## Format de `public/data/qualifying.json`

```json
{
  "updated": "AAAA-MM-JJ",
  "championships": [
    {
      "id": "obk-25-2026",
      "name": "Championnats de Belgique Open",
      "course": "SCM",
      "place": "Sint-Niklaas",
      "start": "2026-12-18",
      "end": "2026-12-20",
      "until": "2026-12-20",
      "edition": 2026,
      "limitsEdition": 2026,
      "window": { "from": "2025-01-01", "to": "2026-11-29" },
      "accepts": ["SCM", "LCM"],
      "aOnlyUpTo": 16,
      "note": "Phrase courte sur les règles (A, B, bassins)…",
      "source": "https://…pdf",
      "limits": {
        "F": { "50-FREE": { "A": "27.59", "B": "28.22" } },
        "M": { "400-FREE": { "11": "5:50.01", "12": "5:29.37" } }
      }
    }
  ]
}
```

- **Le championnat :**
  - `course` est le bassin de la compétition (`SCM` = 25 m, `LCM` = 50 m).
  - `accepts` liste les bassins dont les temps comptent.
  - `until` est le dernier jour où l'application l'affiche : la fin de la compétition, ou la fin de saison si la date n'est pas connue.
- **L'âge :**
  - `edition` est l'année de la compétition, et l'âge pris en compte est celui atteint cette année-là.
  - `aOnlyUpTo` : jusqu'à cet âge, seule la limite A compte.
  - Les masters (25 ans et plus) n'ont pas de limites dans l'application.
- **Les limites :**
  - Épreuves : `distance-nage`, avec FREE, BACK, BREAST, FLY ou IM.
  - Clés : `A` et `B`, ou l'âge (`"13"`). `"18+"` vaut pour 18 ans et plus.
- **`limitsEdition` :** édition dont viennent les limites. Plus ancienne que `edition`, ce sont des limites provisoires : l'application les marque « limites 2026 » en attendant les nouvelles.

## Étapes

1. `node scripts/limits.mjs verifier` : il montre l'état de chaque championnat (passé, provisoire, officiel).
2. **Nouveau règlement publié :** remplace ses limites, puis mets à jour `limitsEdition`, `edition`, dates, `window`, `until`, `note` et `source`. Ajoute un championnat qui n'existe pas encore.
3. **Championnat passé, règlement suivant pas encore publié :** passe à l'édition suivante (`edition` + 1, dates et `window` décalées d'un an, `until`) en gardant les limites et `limitsEdition`. Il est alors affiché comme provisoire.
4. `node scripts/limits.mjs verifier` doit dire « Fichier valide ». Toute incohérence se revérifie sur le PDF. Par exemple : A plus lent que B, un âge plus lent qu'un plus jeune, un 200 m pas plus lent que le 100 m.
5. `npx vitest run tests/qualifying.test.ts` : les tests de calcul utilisent une copie figée (`tests/fixtures/qualifying-2026.json`) et ne changent pas.
6. **Publier :**
   - `git fetch` puis `git merge --ff-only origin/main`, car d'autres sessions publient aussi sur main.
   - `git add public/data/qualifying.json`, commit « Temps limites : … (saison AAAA-AAAA) », `git push origin main`.
   - GitHub Pages met l'application à jour ; chaque membre a les nouvelles limites à la prochaine ouverture.
7. **Résumé pour l'utilisateur :** championnats mis à jour, ceux encore provisoires, et ceux dont le règlement n'est pas encore publié.
