---
name: swimrankings-esn
description: Récupère les temps d'un nageur sur swimrankings.net (meilleurs temps et, si demandé, tout l'historique d'une nage) en ouvrant sa page dans le navigateur de l'utilisateur (navigateur intégré de l'app Claude ou Claude in Chrome), puis prépare l'import dans l'application ESN Natation (lien d'import + texte à coller). À utiliser quand l'utilisateur demande de récupérer, mettre à jour ou importer les temps, records ou statistiques d'un nageur depuis swimrankings, ou partage un lien swimrankings.net « athleteDetail ».
---

# swimrankings.net → ESN Natation

ESN Natation (https://cronobots.github.io/ESN/) est l'application des parents de l'Ecole Seraing Natation pour suivre les temps de leurs enfants. Cette skill lit la page publique d'un nageur sur swimrankings.net **dans le navigateur de l'utilisateur** et produit un import prêt à l'emploi.

## Prérequis

- Un navigateur que tu pilotes dans la session de l'utilisateur : le navigateur intégré de l'app Claude (bureau) ou Claude in Chrome. Lis d'abord la skill du navigateur concerné (`built-in-browser` ou `chrome-browser`) et suis ses règles.
- Si aucun navigateur n'est disponible (session dans le cloud, app mobile…) : dis-le en une phrase et propose l'import par capture d'écran dans ESN Natation (Réglages › Importer › onglet « Capture »). N'invente jamais de temps.

## Règles

- Pages publiques uniquement. Ne demande, ne saisis et n'utilise jamais d'identifiant ou de mot de passe swimrankings : aucune connexion n'est nécessaire.
- Si une vérification anti-robot (Cloudflare, « Vérifiez que vous êtes humain ») s'affiche : demande à l'utilisateur de la valider lui-même dans le navigateur, attends, puis continue. Ne tente jamais de la contourner (pas de changement d'agent utilisateur, pas d'outil de scraping, pas de requête directe au serveur, pas de proxy).
- Seulement les nageurs demandés par l'utilisateur (ses enfants, quelques nageurs suivis). Pas de collecte en masse ; une page à la fois, à un rythme normal de lecture.

## Étapes

1. **Identifier l'athlète.** Prends le numéro `athleteId` du lien fourni (`…page=athleteDetail&athleteId=1234567…`). Sans lien : demande-le, ou cherche le nom avec l'utilisateur via le menu du site « Nageurs › Recherche ».
2. **Ouvrir les meilleurs temps :** `https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=<ID>&athletePage=PBEST`, puis lis la page en texte.
3. **Relever :**
   - en-tête : NOM, Prénom, année de naissance (et le sexe si une icône/indication l'affiche), nation et club ;
   - tableau « Meilleurs temps » : épreuve, bassin, temps, points, date, ville, compétition. Si le nom de la compétition est tronqué (« … »), récupère le nom complet (infobulle ou texte du lien).
4. **Historique complet (si demandé) :** sur la page du nageur, menu « Tous les résultats » → choisis chaque nage proposée, une par une, et relève toutes les lignes (bassin, temps, points, date, ville, compétition).
5. **Construire le texte d'import** (format ci-dessous), puis le **lien d'import**.
6. **Répondre** avec : un résumé (nombre de temps, période couverte), le lien « Ouvrir dans ESN Natation », et le texte dans un bloc de code à copier. Signale toute ligne illisible plutôt que de la deviner.

## Format d'import ESN Natation

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=<ID>
@@GENDER:F
NOM, Prénom (AAAA)
BEL - Nom du club
<Épreuve>	<Bassin>	<Temps>	<Points>	<Date>	<Ville>	<Compétition>
```

- `@@GENDER:` : `F` ou `M`, seulement si l'information est affichée ; sinon omets la ligne.
- Épreuve : `50m Libre`, `100m Dos`, `200m Brasse`, `100m Papillon`, `200m 4 nages`… (ignore les relais).
- Bassin : `25m` ou `50m`. Temps : `m:ss.cc` ou `ss.cc`. Points : nombre, ou vide. Date : `11 oct 2026`.
- Colonnes séparées par une **tabulation**, une course par ligne, sans en-tête de tableau.

Exemple (fictif) :

```
@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567
DUPONT, Emma (2014)
BEL - Club Exemple Natation
100m Libre	25m	1:31.08	171	11 oct 2026	Liège	Meeting d'automne
50m Dos	25m	45.12	180	14 nov 2026	Namur	Meeting de Namur
```

## Lien d'import

`https://cronobots.github.io/ESN/#/import?data=` suivi du texte d'import encodé avec `encodeURIComponent` (tabulations → `%09`, retours à la ligne → `%0A`, espaces → `%20`). Si tu ne peux pas encoder le texte de façon fiable, ne donne pas de lien : le texte suffit.

Ouvert sur le téléphone ou l'ordinateur, ESN Natation affiche les temps à vérifier, puis l'utilisateur touche « Importer » (les doublons sont ignorés).

Rappelle à l'utilisateur : si ESN Natation est installée sur l'écran d'accueil d'un iPhone, le lien s'ouvre dans le navigateur et non dans l'app installée ; dans ce cas, qu'il copie le texte puis, dans ESN Natation : Réglages › Importer des temps › onglet « Copier » › « Coller ».
