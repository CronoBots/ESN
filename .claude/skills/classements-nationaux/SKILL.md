---
name: classements-nationaux
description: Relève sur swimrankings.net les classements nationaux (Belgique, par âge ou année de naissance, par saison, bassin et épreuve) des nageurs actifs du club ESN, dans le navigateur de l'utilisateur, puis les publie chiffrés dans l'application ESN Compétition (fiche d'une épreuve « Classements nationaux », onglet Records « 12e en Belgique »). À utiliser quand l'utilisateur demande les classements belges, nationaux ou par âge de ses nageurs.
---

# Classements nationaux des nageurs du club

swimrankings.net publie les classements de la Belgique (et des autres pays) par saison, bassin, sexe, épreuve et âge (année de naissance ou catégorie). Le site refuse les lectures automatiques : on lit les pages **dans le navigateur de l'utilisateur**, puis on publie les rangs des nageurs du club **chiffrés** avec la clé du club.

## Règles

- Mêmes règles que la skill `historique-club` : jamais d'identifiant ni de mot de passe ; vérification anti-robot validée par l'utilisateur lui-même, jamais contournée (pas de curl, pas de changement d'agent utilisateur, pas de proxy, pas d'outil de scraping) ; une page à la fois, à un rythme normal ; seulement les nageurs **actifs** de la liste du club.
- Dépôt **public** : aucun nom ni rang en clair dans les fichiers suivis, les tests ou les commits. Le dossier `classements/` reste local (ignoré par git) ; seul `public/data/club-rankings.json` (chiffré) est publié.
- On ne garde que la ligne du nageur du club (son rang), jamais les autres nageurs du classement. N'invente jamais un rang.

## Étapes

1. **Préparer.** `git pull origin main`, `npm install`. Lis la skill du navigateur disponible. `node scripts/roster.mjs lire` donne la liste (nom, prénom, année, sexe, statut) : seuls les nageurs sans statut « ancien » sont concernés.
2. **Repérage (une fois).** Sur un nageur, trouve le chemin le moins coûteux en pages :
   - sa fiche affiche-t-elle déjà son rang national pour chaque meilleur temps ?
   - sinon, la page de classement (menu « Rankings » / « Classements ») filtrée par pays Belgique, saison, bassin, sexe, épreuve et âge (année de naissance) : **une seule page couvre tous les nageurs du club de la même année et du même sexe**, regroupe-les.
   Dis à l'utilisateur, en 3 lignes, le chemin retenu et le nombre de pages estimé, puis continue.
3. **Saisons.** La saison en cours et la précédente (une saison va de septembre à août : `2026-2027`). Seulement les épreuves que le nageur a nagées dans la saison.
4. **Pour chaque nageur :** `classements/NOM_Prenom.txt` (une ligne par classement, colonnes séparées par une tabulation) :

   ```
   @@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=<ID>
   NOM, Prénom (AAAA)
   <Saison>	<Bassin>	<Épreuve>	<Classement>	<Rang>	<Sur>	<Temps>
   ```

   - Saison `2026-2027` ; bassin `25m` ou `50m` ; épreuve `100m Libre`, `200m 4 nages`… (comme dans l'historique).
   - Classement : le classement tel qu'affiché, en clair : `Belgique · filles nées en 2015`, `Belgique · 11 ans`, `Belgique · toutes catégories`.
   - Rang : le rang du nageur (`12`). Sur : nombre de nageurs classés s'il est affiché (sinon vide). Temps : le temps classé.
   - Un nageur classé dans plusieurs classements (année de naissance **et** toutes catégories) : une ligne par classement.
   Enregistre le fichier dès qu'un nageur est fini ; tiens `classements/_suivi.txt` à jour (fait / reste / problèmes).
5. **Chiffrer.** D'abord `git pull --rebase origin main` : la commande fusionne avec le fichier publié présent sur le disque, qui doit être à jour (une autre session a pu publier pendant le relevé). Puis `node scripts/roster.mjs classements classements` : affiche le nombre de classements par nageur (⚠ ligne illisible, ⚠ nageur absent de la liste) et écrit `public/data/club-rankings.json`, fusionné ligne par ligne avec les classements déjà publiés : une ligne du fichier remplace celle de même saison, bassin, épreuve et classement ; les autres classements publiés du nageur (saison précédente…) sont gardés. `--remplacer` : le fichier remplace tous les classements publiés de ce nageur (pour retirer une ligne fausse, si l'utilisateur le confirme). Deux fichiers du même nageur dans le dossier : la commande s'arrête ; garde le plus complet.
6. **Vérifier.** `npm test` ; `git status` ne doit montrer que `public/data/club-rankings.json` ; `grep -c "NOM_D_UN_NAGEUR" public/data/club-rankings.json` doit renvoyer 0.
7. **Publier.** `git add public/data/club-rankings.json`, commit « Classements nationaux (N nageurs) », `git push origin main`. Push refusé (une autre session a publié entre-temps) : `git pull --rebase origin main`. En cas de conflit sur le fichier chiffré (une seule ligne, impossible à fusionner à la main), ne garde aucun des deux côtés : `git checkout origin/main -- public/data/club-rankings.json` (la version distante), relance la commande de l'étape 5 (elle refusionne le dossier `classements/` avec cette version), puis `git add public/data/club-rankings.json`, `git rebase --continue` et `git push origin main`. Chacun les reçoit à l'ouverture suivante : fiche d'une épreuve (« Classements nationaux ») et onglet Records (« 12e en Belgique (2026-2027) » sous le meilleur temps).
8. **Résumé** : nageurs faits, classements publiés, meilleurs rangs, nageurs non classés, pages illisibles.

Mise à jour en cours de saison : refais l'étape 4 pour la saison en cours (le fichier d'un nageur peut ne contenir que cette saison : les classements publiés des saisons précédentes sont gardés à l'étape 5), puis 5 à 7.
