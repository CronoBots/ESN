---
name: inscriptions-club
description: Publie dans l'application ESN Compétition les inscriptions du club à une compétition (PDF « inscription_ESN_pour_… » envoyé par le club) — programme de chaque nageur engagé (épreuves, jour, session, temps d'engagement) et records officiels de son âge, chiffrés pour les membres. À utiliser quand l'utilisateur envoie un fichier d'inscriptions du club, ou signale des engagements ajoutés ou retirés.
---

# Inscriptions du club

Le club envoie pour chaque compétition un PDF d'inscriptions (logiciel du club) : programme de la compétition
(épreuves par session), et pour chaque nageur engagé ses épreuves, son temps d'engagement, ses meilleurs temps
en 25 et 50 m, et les records de son âge (R-Club : club, R-ClubTC : club toutes catégories, R-Dis : district,
R-Fran : francophone, R-BEL : Belgique).

L'application en fait le **programme** de chaque nageur dès la publication (fiche, page de la compétition),
avant les listes de départ de l'organisateur (qui ajoutent ensuite série, couloir et heure, et déclenchent la
notification « au programme »), et affiche les **temps à viser**
(limite d'un championnat encore à atteindre, record du club de son âge) quand ils sont à portée (10 %).

## Règles

- Le PDF contient des noms d'enfants : **jamais** dans le dépôt, un commit ou un test. Seul
  `public/data/club-entries.json`, chiffré avec le code du club, est publié.
- Pas de vrai nom dans les messages de commit (« Inscriptions du club : <ville> (<dates>) »).

## Étapes

1. `git pull`, puis :
   `node scripts/roster.mjs inscriptions CHEMIN/inscription_ESN_pour_….pdf`
   (pdftotext est nécessaire ; à défaut, donner le texte obtenu avec `pdftotext -layout`).
2. Le script vérifie que le nombre de nageurs et de départs lus est celui annoncé en fin de fichier
   (« 19 nageurs - 137 départs ») ; sinon il s'arrête : signaler la page mal lue à l'utilisateur.
3. Prénom coupé par le fichier (colonne trop étroite) : complété d'après la liste du club. Un nageur
   « absent de la liste du club » : autre orthographe → ajouter l'autre nom à la liste du club (skill historique
   ou `roster.mjs chiffrer`, colonne « autres noms »), puis relancer.
4. La même compétition (même ville, même date de début) est remplacée : un fichier corrigé retire aussi les
   engagements supprimés. Les compétitions terminées depuis plus de 30 jours sont retirées du fichier.
5. `npx vitest run tests/clubEntries.test.ts`, puis commit de `public/data/club-entries.json` et push sur main.
   Chaque membre reçoit le programme à la prochaine ouverture de l'application.
6. Résumé pour l'utilisateur : compétition, nombre de nageurs et de départs, nageurs non reconnus.
