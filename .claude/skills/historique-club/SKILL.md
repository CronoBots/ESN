---
name: historique-club
description: Récupère sur swimrankings.net l'historique complet (toutes les compétitions depuis la première) des nageurs de la liste du club ESN, en lisant les pages dans le navigateur de l'utilisateur (navigateur intégré de l'app Claude ou Claude in Chrome), puis le publie chiffré dans l'application ESN Compétition pour tous les membres. À utiliser quand l'utilisateur demande l'historique, les anciens résultats ou les stats des nageurs du club « depuis qu'ils font des compétitions ».
---

# Historique swimrankings des nageurs du club

swimrankings.net a tout l'historique des nageurs, mais refuse les lectures automatiques (vérification anti-robot). On lit donc les pages **dans le navigateur de l'utilisateur**, à son rythme, puis on publie l'historique **chiffré** avec le code du club : chaque membre le reçoit automatiquement dans l'application.

## Règles

- Ne demande, ne saisis et n'utilise jamais d'identifiant ou de mot de passe swimrankings : les pages des nageurs sont publiques.
- Vérification anti-robot (« Just a moment », « Vérifiez que vous êtes humain ») : demande à l'utilisateur de la valider lui-même dans le navigateur, attends, puis continue. Ne tente jamais de la contourner (pas de changement d'agent utilisateur, pas d'outil de scraping, pas de requête directe au serveur avec curl, pas de proxy).
- Une page à la fois, à un rythme normal de lecture. Seulement les nageurs de la liste du club.
- Le dépôt GitHub est **public** : aucun nom ni temps en clair n'y est ajouté. Le dossier `historique/` est ignoré par git ; seul `public/data/club-history.json` (chiffré) est publié. N'écris jamais le code du club dans un fichier du dépôt.
- N'invente jamais un temps : une ligne illisible est signalée, pas devinée.

## Étapes

1. **Préparer.** Tu travailles dans le dossier du dépôt ESN, sur l'ordinateur de l'utilisateur. Lis la skill du navigateur disponible (`built-in-browser` ou `chrome-browser`). Si `node_modules` manque : `npm install`.
2. **Code du club.** Demande-le à l'utilisateur (format `ESN-XXXX-XXXX`). Garde-le seulement en mémoire pour les commandes.
3. **Liste des membres.** `node scripts/roster.mjs lire CODE` affiche les nageurs (groupe ; nom ; prénom ; année ; sexe).
4. **Pour chaque nageur :**
   1. Recherche : `https://www.swimrankings.net/index.php?page=athleteSelect&nationId=0&athleteLastName=NOM` (nom en majuscules, sans accents si besoin). Choisis la ligne avec le même prénom, la même année de naissance et le club de Seraing (« Ecole Seraing Natation », « ESN »). Doute ou homonyme : demande à l'utilisateur. Introuvable : note-le et passe au suivant.
   2. Meilleurs temps : `https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=ID&athletePage=PBEST`, lis la page en texte (en-tête : NOM, Prénom, année, sexe si indiqué, club).
   3. Historique : pour chaque épreuve de la page, ouvre la liste de **tous** ses temps (lien de l'épreuve, ou menu « Tous les résultats » / « All results » puis chaque nage), en petit bassin (25 m) **et** en grand bassin (50 m). Relève chaque ligne : épreuve, bassin, temps, points, date, ville, compétition (nom complet : infobulle ou texte du lien si tronqué). Ignore les relais.
   4. Écris `historique/NOM_Prenom.txt` au format ci-dessous.
5. **Chiffrer.** `node scripts/roster.mjs historique historique CODE` : affiche le nombre de temps par nageur (⚠ pour un fichier qui ne correspond à aucun nageur de la liste) et écrit `public/data/club-history.json`.
6. **Vérifier.** `git status` ne doit montrer que `public/data/club-history.json` ; `grep -c "NOM_D_UN_NAGEUR" public/data/club-history.json` doit renvoyer 0.
7. **Publier.** `git add public/data/club-history.json`, commit « Historique du club (N nageurs) », `git push origin main`. La publication GitHub Pages met l'application à jour ; chaque membre reçoit l'historique à la prochaine ouverture (une seule fois par version publiée, sans doublon avec les résultats déjà présents).
8. **Résumé** pour l'utilisateur : nombre de nageurs, de temps, période couverte, nageurs introuvables ou lignes illisibles.

Pour une mise à jour plus tard, garde les fichiers de `historique/`, complète-les et refais les étapes 5 à 7.

## Format d'un fichier `historique/NOM_Prenom.txt`

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=<ID>
@@GENDER:F
NOM, Prénom (AAAA)
BEL - Ecole Seraing Natation
<Épreuve>	<Bassin>	<Temps>	<Points>	<Date>	<Ville>	<Compétition>
```

- `@@GENDER:` : `F` ou `M`.
- Épreuve : `50m Libre`, `100m Dos`, `200m Brasse`, `100m Papillon`, `200m 4 nages`…
- Bassin : `25m` ou `50m`. Temps : `m:ss.cc` ou `ss.cc`. Points : nombre, ou vide. Date : `11 oct 2025`.
- Colonnes séparées par une **tabulation**, une course par ligne, sans ligne d'en-tête de tableau.

Exemple (fictif) :

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
@@GENDER:F
DUPONT, Emma (2014)
BEL - Ecole Seraing Natation
100m Libre	25m	1:31.08	171	11 oct 2025	Liège	Meeting d'automne
100m Libre	25m	1:35.40	148	14 déc 2024	Seraing	Coupe de Noël
50m Dos	50m	45.12	180	14 juin 2025	Namur	Meeting de Namur
```
