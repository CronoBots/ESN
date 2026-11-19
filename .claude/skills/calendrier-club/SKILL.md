---
name: calendrier-club
description: Met à jour le calendrier des compétitions du club ESN affiché dans l'application ESN Compétition (accueil « Prochaine compétition », onglet Compétitions « À venir ») à partir du calendrier communiqué par les entraîneurs (PDF, photo, tableur ou texte). À utiliser quand l'utilisateur envoie un nouveau calendrier, la deuxième partie de la saison, ou signale une compétition ajoutée, déplacée ou supprimée.
---

# Calendrier des compétitions du club

Le calendrier annonce les compétitions **avant** que les organisateurs publient leurs listes de départ. Dès qu'une compétition est publiée en ligne (programme des nageurs), l'application affiche celle-ci à la place de l'annonce (mêmes dates, même ville ou même nom). Fichier : `public/data/club-calendar.json` (public, non chiffré).

## Règles

- Le dépôt est **public** : aucun nom de nageur. Les groupes s'écrivent par leur lettre (`A`, `B`, `C`) ; le **prénom** de l'entraîneur de chaque groupe va dans `groupNames`, comme sur le calendrier du club (décision de l'utilisateur), jamais son nom de famille.
- Recopie fidèlement le document : n'invente ni date, ni lieu, ni groupe, ni condition. Une case illisible ou ambiguë : demande à l'utilisateur.
- Garde les compétitions déjà passées de la saison (l'application ne montre que celles à venir) ; une compétition supprimée par le club est retirée du fichier.

## Format

```json
{
  "title": "Calendrier des compétitions de l’ESN",
  "season": "2026-2027",
  "version": "AAAA-MM-JJ (date de version du document)",
  "until": "AAAA-MM-JJ (dernier jour couvert par le document)",
  "groupNames": { "A": "Prénom de l'entraîneur du groupe A", "B": "…", "C": "…" },
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
      "note": "Conditions : temps limites, sélection, limite de séries…",
      "live": "https://resultats.glprod.be/CB-bastogne26/ (facultatif : livetiming hors live.swimrankings.net)"
    }
  ]
}
```

- `groupNames` : recopie l'en-tête « Groupes concernés » du document (« A Guillaume B Emilie C Synclair »). L'application affiche « Groupes de Guillaume et d’Emilie » et, dans les badges, « Guillaume, Emilie ».
- Dates au format `AAAA-MM-JJ` ; `end` absent pour une compétition d'un jour.
- Nom en clair et en français (« Championnats FFBN 25 m Jeunes », « Dernière Chance »), sans abréviation obscure (« Champ » → « Championnats »).
- Espace insécable ` ` entre un nombre et son unité (`25 m`, `15 ans`), pour éviter une coupure à l'écran.
- Pas de filtre par âge : toutes les compétitions du club s'affichent pour tout le monde (décision de l'utilisateur). Une condition d'âge (« 11-16 ans ») s'écrit dans le nom ou dans `note`.
- `live` (facultatif) : adresse du livetiming quand l'organisateur ne publie pas sur live.swimrankings.net (championnats de la fédération et district LNL : resultats.glprod.be ; lien « Livetiming » de la page de l'événement sur belswim.be). Le déploiement en copie la page et les feuilles PDF dans le site toutes les 5 minutes, de 2 jours avant à 14 jours après la compétition (scripts/mirror-live.mjs) ; l'application les lit comme live.swimrankings.net. Une page Splash Meet Manager (liens `StartList_N.pdf`, `ResultList_N.pdf`) est nécessaire.
- Deuxième partie de saison : ajoute les compétitions à la suite, mets à jour `version`, `until` et `note`.

## Étapes

1. Lis le document envoyé et écris le fichier au format ci-dessus.
2. `npx vitest run tests/clubCalendar.test.ts` puis `npm test` et `npm run build`.
3. Contrôle à l'écran (accueil et onglet Compétitions) : les prochaines compétitions apparaissent dans l'ordre, avec les groupes et les conditions.
4. Commit « Calendrier du club (version du JJ/MM/AAAA) », push sur `main`. Chacun reçoit le calendrier à l'ouverture suivante de l'application.
