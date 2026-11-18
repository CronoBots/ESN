---
name: historique-club
description: Récupère sur swimrankings.net l'historique complet (toutes les compétitions depuis la première) des nageurs de la liste du club ESN, en lisant les pages dans le navigateur de l'utilisateur (navigateur intégré de l'app Claude ou Claude in Chrome), puis le publie chiffré dans l'application ESN Compétition pour tous les membres. À utiliser quand l'utilisateur demande l'historique, les anciens résultats ou les stats des nageurs du club « depuis qu'ils font des compétitions ».
---

# Historique swimrankings des nageurs du club

swimrankings.net a tout l'historique des nageurs, mais refuse les lectures automatiques (vérification anti-robot). On lit donc les pages **dans le navigateur de l'utilisateur**, à son rythme, puis on publie l'historique **chiffré** avec la clé du club : chacun le reçoit automatiquement dans l'application.

## Règles

- Ne demande, ne saisis et n'utilise jamais d'identifiant ou de mot de passe swimrankings : les pages des nageurs sont publiques.
- Vérification anti-robot (« Just a moment », « Vérifiez que vous êtes humain ») : demande à l'utilisateur de la valider lui-même dans le navigateur, attends, puis continue. Ne tente jamais de la contourner (pas de changement d'agent utilisateur, pas d'outil de scraping, pas de requête directe au serveur avec curl, pas de proxy).
- Une page à la fois, à un rythme normal de lecture. Seulement les nageurs de la liste du club.
- Le dépôt GitHub est **public** : aucun nom ni temps en clair n'y est ajouté, **ni dans les fichiers, ni dans les messages de commit** (écris « Historique du club (N nageurs) », jamais un nom de nageur ; dans le code et les tests, seulement des noms fictifs). Le dossier `historique/` est ignoré par git ; seul `public/data/club-history.json` (chiffré) est publié. La clé du club est publique (`src/club.ts`, `CLUB.accessKey`) : l'application est ouverte à tous, sans connexion ; le chiffrement évite seulement que les noms soient lisibles en clair dans le dépôt.
- N'invente jamais un temps : une ligne illisible est signalée, pas devinée.

## Étapes

1. **Préparer.** Tu travailles dans le dossier du dépôt ESN, sur l'ordinateur de l'utilisateur. Lis la skill du navigateur disponible (`built-in-browser` ou `chrome-browser`). Si `node_modules` manque : `npm install`.
2. **Clé du club.** Rien à demander : les commandes utilisent la clé de `src/club.ts` quand `CODE` est omis.
3. **Qui relever.** `node scripts/roster.mjs manquants` affiche deux listes :
   - les membres **actifs** dont l'historique n'est pas encore publié ;
   - les membres actifs dont l'historique est publié **sans le club de chaque course** (relevé avant cette règle) : on refait leur historique avec la colonne Club, pour retirer les courses nagées pour un autre club.

   Les anciens membres (statut « ancien ») ne sont relevés que si l'utilisateur le demande. Pour tout refaire, `node scripts/roster.mjs lire` affiche toute la liste (groupe ; nom ; prénom ; année ; sexe ; statut).
4. **Pour chaque nageur :**
   1. Recherche : `https://www.swimrankings.net/index.php?page=athleteSelect&nationId=0&athleteLastName=NOM` (nom en majuscules, sans accents si besoin). Choisis la ligne avec le même prénom, la même année de naissance et le club de Seraing (« Ecole Seraing Natation », « ESN »). Doute ou homonyme : demande à l'utilisateur. Introuvable : note-le et passe au suivant.
   2. Meilleurs temps : `https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=ID&athletePage=PBEST`, lis la page en texte (en-tête : NOM, Prénom, année, sexe si indiqué, club).
   3. Historique : pour chaque épreuve de la page, ouvre la liste de **tous** ses temps (lien de l'épreuve, ou menu « Tous les résultats » / « All results » puis chaque nage), en petit bassin (25 m) **et** en grand bassin (50 m). Relève chaque ligne : épreuve, bassin, temps, points, date, ville, compétition (nom complet : infobulle ou texte du lien si tronqué), **club**, et quand swimrankings les affiche : **place** (rang dans la compétition), **tour** (séries, demi-finale, finale) et **temps de passage**. Ignore les relais.
   4. **Club de chaque course** (règle du club : un nageur qui a changé de club n'a dans l'application que ses résultats nagés pour l'ESN). Relève pour chaque course le club sous lequel il a nagé, tel que swimrankings l'affiche : colonne « Club » de la liste des temps, sinon la liste des compétitions du nageur (onglet « Compétitions » / « Meets » de sa fiche, une ligne par compétition avec son club), sinon la page de la compétition (ligne du nageur). Une seule page par compétition suffit : toutes les courses d'une même compétition ont le même club. Sur la page d'une compétition, la ligne du nageur donne aussi sa place, le tour et souvent ses temps de passage : relève-les en même temps (aucune page de plus). Club introuvable pour une course : laisse la colonne vide et signale-le dans le résumé (la course est gardée, mais l'historique n'est pas marqué vérifié). Ne devine jamais un club.
   5. Écris `historique/NOM_Prenom.txt` au format ci-dessous.
5. **Chiffrer.** `node scripts/roster.mjs historique historique` : affiche le nombre de temps par nageur (⚠ pour un fichier qui ne correspond à aucun nageur de la liste, ⚠ « club des courses non relevé » pour un fichier sans colonne Club), retire les courses nagées pour un autre club (« N nagés pour un autre club, retirés ») et écrit `public/data/club-history.json`. Dans l'application, les courses retirées disparaissent aussi chez chacun à l'ouverture suivante. L'historique déjà publié est fusionné : un nageur absent du dossier `historique/` garde ses temps publiés, un fichier présent les remplace.
6. **Vérifier.** `git status` ne doit montrer que `public/data/club-history.json` ; `grep -c "NOM_D_UN_NAGEUR" public/data/club-history.json` doit renvoyer 0.
7. **Publier.** `git add public/data/club-history.json`, commit « Historique du club (N nageurs) », `git push origin main`. La publication GitHub Pages met l'application à jour ; chaque membre reçoit l'historique à la prochaine ouverture (une seule fois par version publiée, sans doublon avec les résultats déjà présents).
8. **Résumé** pour l'utilisateur : nombre de nageurs, de temps, période couverte, courses retirées car nagées pour un autre club (par nageur), nageurs introuvables, lignes illisibles ou sans club.

Pour une mise à jour plus tard (nouveaux membres, nouvelle saison) : `node scripts/roster.mjs manquants`, relève ces nageurs, puis refais les étapes 5 à 7. Avant de publier, récupère la dernière version (`git pull --rebase`) : l'application évolue aussi depuis d'autres sessions.

**Même nageur deux fois dans la liste** (autre orthographe ou autre année de naissance sur swimrankings), quand l'utilisateur confirme que c'est la même personne :
1. Garde la fiche qui a le plus de points au total.
2. Ajoute à son fichier `historique/` les temps de l'autre fiche, sans répéter une course déjà là, puis retire l'autre fichier.
3. Dans la liste (`lire`, puis `chiffrer`), supprime la ligne de l'autre fiche. Écris son nom dans la 7e colonne « autres noms » de la fiche gardée : `NOM, Prénom (AAAA)`, plusieurs séparés par « | ».
4. Refais les étapes 5 à 7. `historique` retire alors l'ancienne fiche de l'historique publié. Dans l'application, la fiche en double (temps, objectifs, suivi) est réunie avec celle gardée à la prochaine ouverture.

## Format d'un fichier `historique/NOM_Prenom.txt`

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=<ID>
@@GENDER:F
NOM, Prénom (AAAA)
BEL - Ecole Seraing Natation
<Épreuve>	<Bassin>	<Temps>	<Points>	<Date>	<Ville>	<Compétition>	<Club>	<Place>	<Tour>	<Passages>
```

- `@@GENDER:` : `F` ou `M`.
- `@@PARTIEL` (ligne facultative) : historique provisoire, avec seulement les meilleurs temps ESN relevés dans les classements « Meilleurs à vie » du club. Ces pages de classement ne comptent pas dans la limite de pages de swimrankings. `manquants` liste encore ce nageur ; son historique complet remplacera ce fichier.
- Épreuve : `50m Libre`, `100m Dos`, `200m Brasse`, `100m Papillon`, `200m 4 nages`…
- Bassin : `25m` ou `50m`. Temps : `m:ss.cc` ou `ss.cc`, suivi de `M` pour un temps masters, tel qu'écrit sur swimrankings (`2:21.62M`) : l'application garde la marque et affiche « Masters ». Les lignes « Lap » (temps de passage) ne sont pas des courses : ne les relève pas. Points : nombre, ou vide. Date : `11 oct 2025`.
- Club : tel qu'écrit sur swimrankings (`BEL - Ecole Seraing Natation`, `Ecole Seraing Natation`, `ESN`, ou le nom d'un autre club). Seules les courses de l'ESN sont publiées ; la colonne est retirée à la publication (l'application lit 7 colonnes) et l'en-tête reçoit `@@CLUBS` (historique vérifié).
- Place : le rang du nageur dans l'épreuve (`1`, `2`, `14`…), vide s'il n'est pas affiché. Tour : `Séries`, `Demi-finale`, `Finale` (`Finale B` accepté), vide pour une épreuve en une seule course ou inconnue. Passages : temps cumulés séparés par des espaces (`35.10 1:13.20 1:51.80` pour un 200 m), vide s'ils ne sont pas affichés. Une colonne vide n'est jamais devinée. Dans l'application : places, podiums et médailles, finales, temps de passage de chaque course.
- Colonnes séparées par une **tabulation**, une course par ligne, sans ligne d'en-tête de tableau.

Exemple (fictif) :

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
@@GENDER:F
DUPONT, Emma (2014)
BEL - Ecole Seraing Natation
100m Libre	25m	1:31.08	171	11 oct 2025	Liège	Meeting d'automne	BEL - Ecole Seraing Natation	3	Finale	43.90
100m Libre	25m	1:35.40	148	14 déc 2024	Seraing	Coupe de Noël	BEL - Ecole Seraing Natation	12
50m Dos	50m	45.12	180	14 juin 2023	Namur	Meeting de Namur	BEL - Club Exemple Natation
```

(La dernière course, nagée pour un autre club avant l'arrivée à l'ESN, est retirée à la publication.)
