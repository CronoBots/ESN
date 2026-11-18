---
name: calendrier-club
description: Met à jour le calendrier des compétitions du club ESN affiché dans l'application ESN Compétition (accueil « Prochaine compétition », onglet Compétitions « À venir ») à partir du calendrier communiqué par les entraîneurs (PDF, photo, tableur ou texte). À utiliser quand l'utilisateur envoie un nouveau calendrier, la deuxième partie de la saison, ou signale une compétition ajoutée, déplacée ou supprimée.
---

# Calendrier des compétitions du club

Le calendrier annonce les compétitions **avant** que les organisateurs publient leurs listes de départ. Dès qu'une compétition est publiée en ligne (programme des nageurs), l'application affiche celle-ci à la place de l'annonce (mêmes dates, même ville ou même nom). Fichier : `public/data/club-calendar.json` (public, non chiffré).

## Règles

- Le dépôt est **public** : aucun nom de personne. Les groupes s'écrivent seulement par leur lettre (`A`, `B`, `C`), jamais avec le prénom de l'entraîneur ; aucun nom de nageur.
- Recopie fidèlement le document : n'invente ni date, ni lieu, ni groupe, ni condition. Une case illisible ou ambiguë : demande à l'utilisateur.
- Garde les compétitions déjà passées de la saison (l'application ne montre que celles à venir) ; une compétition supprimée par le club est retirée du fichier.

## Format

```json
{
  "title": "Calendrier des compétitions de l’ESN",
  "season": "2026-2027",
  "version": "AAAA-MM-JJ (date de version du document)",
  "until": "AAAA-MM-JJ (dernier jour couvert par le document)",
  "note": "Avertissement du document (le calendrier peut évoluer…)",
  "events": [
    {
      "start": "2026-11-20",
      "end": "2026-11-22",
      "dates": "précision facultative : « 13-14 ou 14-15 novembre », « samedi et dimanche »",
      "city": "Bastogne",
      "name": "Championnats de Belgique 25 m 11-16 ans",
      "course": "SCM (25 m) ou LCM (50 m), seulement s'il est indiqué",
      "groups": ["A", "B"],
      "minAge": 11,
      "maxAge": 16,
      "note": "Conditions : temps limites, sélection, limite de séries…"
    }
  ]
}
```

- Dates au format `AAAA-MM-JJ` ; `end` absent pour une compétition d'un jour.
- Nom en clair et en français (« Championnats FFBN 25 m Jeunes », « Dernière Chance »), sans abréviation obscure (« Champ » → « Championnats »).
- Espace insécable ` ` entre un nombre et son unité (`25 m`, `15 ans`), pour éviter une coupure à l'écran.
- `minAge` / `maxAge` seulement si le document les donne (« 11-16 ans », « 15 ans et plus ») : l'accueil ne propose pas à un nageur une compétition hors de son âge.
- Deuxième partie de saison : ajoute les compétitions à la suite, mets à jour `version`, `until` et `note`.

## Étapes

1. Lis le document envoyé et écris le fichier au format ci-dessus.
2. `npx vitest run tests/clubCalendar.test.ts` puis `npm test` et `npm run build`.
3. Contrôle à l'écran (accueil et onglet Compétitions) : les prochaines compétitions apparaissent dans l'ordre, avec les groupes et les conditions.
4. Commit « Calendrier du club (version du JJ/MM/AAAA) », push sur `main`. Chacun reçoit le calendrier à l'ouverture suivante de l'application.
