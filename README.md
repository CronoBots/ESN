# ESN Compétition 🏊

**L'application compétition gratuite des nageurs de l'[Ecole Seraing Natation](https://www.esn-seraing.be/)** : résultats officiels, records, progression et programme des compétitions.
Application web progressive (PWA) : s'installe sur iPhone et Android, fonctionne aussi dans un navigateur d'ordinateur, et marche hors-ligne au bord du bassin.

Gratuit, sans publicité, sans compte : les données restent sur l'appareil du parent.

## Fonctionnalités

| | |
|---|---|
| 📈 **Progression nage par nage** | Courbe par épreuve et par bassin (la courbe descend quand le temps s'améliore), escalier des records, comparaison avec d'autres nageurs. |
| 📊 **Statistiques** | Progression totale, sur 12 mois, tendance par mois, régularité, allure aux 100 m, points World Aquatics, tableau saison par saison, plus belles progressions. |
| 🏆 **Records** | Meilleurs temps à vie ou de la saison, en petit et grand bassin, comme sur swimrankings.net. |
| 🥇 **Classements** | Classement par épreuve entre vos enfants et les nageurs suivis (coéquipiers, amis), par sexe et par année de naissance. |
| 📅 **Compétitions** | Programme de chaque compétition dès la publication des listes de départ : n° d'épreuve, heure estimée de la série, série, ligne, temps d'engagement, record personnel. Série complète (autres nageurs, clubs, engagements) et classement de la catégorie en direct. Export vers le calendrier du téléphone avec rappel 30 min avant chaque course. |
| ⏱️ **Séries et classements** | Toutes les séries d’une épreuve (lignes, clubs, temps d’engagement, heures estimées) et le **classement final**, général ou par catégorie. |
| 🎖️ **Trophées** | 19 badges à débloquer (premier record, coup du chapeau, polyvalence, 300 points…). |
| ⏲️ **Temps de passage** | Tronçons, allure aux 50 m, détection du « split négatif ». |
| ❤️ **Nageurs suivis** | Pas de saisie : on choisit dans la liste du club les nageurs à suivre (cœur) — ses enfants, leurs coéquipiers. Ils s'affichent sur l'accueil et dans les sélecteurs. |
| 👥 **Nageurs du club** | Liste des membres par année de naissance (ou par groupe A, B, C), ouverte à tous sans connexion : chaque parent y choisit les nageurs qu'il suit, résultats de tout le club, classements du club. |
| ⚡ **Tout automatique** | Aucune saisie ni import : résultats officiels (LENEX et feuilles PDF de live.swimrankings.net), programme des compétitions, historique des saisons passées relevé par le club, nouveaux nageurs de l'ESN ajoutés à la liste. |
| 💾 **Export** | Export CSV des résultats pour Excel. Sur un autre téléphone, il suffit d'ouvrir l'application : tout revient automatiquement. |
| 🌗 **Design** | Logo officiel du club décliné en « ESN Compétition », couleurs du club (vert ESN et bleu du « S »), style iOS natif, mode sombre et clair, onglets sur mobile et barre latérale sur ordinateur. |

## Résultats en direct des compétitions (LENEX)

Les organisateurs utilisent Splash Meet Manager, qui publie les résultats de chaque compétition sur **live.swimrankings.net** (les mêmes feuilles que celles affichées à la piscine, et le fichier officiel `results.lxf` au format **LENEX**). Ce site autorise la lecture par d'autres applications (CORS) et son `robots.txt` permet l'accès aux pages de compétitions et aux fichiers `.lxf`.

L'application lit la liste des compétitions belges (`?nation=BEL`), télécharge le fichier LENEX de chacune (~50 Ko) et y retrouve vos nageurs (nom + année de naissance) : temps, place dans la catégorie d'âge, points, série et ligne, temps d'engagement, temps de passage, disqualification avec sa raison. Recherche **dès qu'un nageur est ajouté** (ou renommé), puis à chaque ouverture et toutes les 15 min pendant une compétition. Aucune action du parent n'est nécessaire. Code : `src/lib/lenex.ts`, `src/lib/liveResults.ts`.

## Liste des membres du club (groupes A, B, C)

L'application est **ouverte à tous**, sans lien, code ni connexion (décision du club) : elle s'ouvre directement sur les nageurs de l'ESN. La liste reste publiée **chiffrée** (`public/data/club-roster.json`, AES-GCM 256 bits, clé dérivée par PBKDF2-SHA-256, 310 000 itérations), avec une clé **publique** intégrée à l'application (`src/club.ts`, `CLUB.accessKey`) : le chiffrement sert seulement à ce que les noms ne soient pas lisibles en clair dans le dépôt ni indexés par les moteurs de recherche.

Préparer ou mettre à jour la liste :

1. Un fichier `membres.csv` **hors du dépôt** (ou à la racine : il est ignoré par git), une ligne par nageur : `groupe;nom;prénom;année de naissance;sexe;statut;autres noms`, par exemple `A;DUPONT;Emma;2012;F` ou `;MARTIN;Lucas;2009;M;ancien;MARTINS, Lucas (2009)`. Sexe : F ou M. Le groupe est facultatif : sans groupe, les nageurs sont classés par année de naissance. Statut : `ancien` pour un ancien membre, sinon vide. Autres noms (facultatif) : le même nageur écrit autrement sur swimrankings, `NOM, Prénom (AAAA)`, plusieurs séparés par `|`. Pour modifier la liste, partez toujours de la liste publiée : `node scripts/roster.mjs lire > membres.csv` (les 7 colonnes) ; `chiffrer` remplace toute la liste, et un tableur sans les colonnes statut et autres noms ferait redevenir actifs les anciens membres et perdre les autres noms.
2. La clé est celle de `src/club.ts` (`CLUB.accessKey`), utilisée quand aucun code n'est donné ; pour en changer, `npm run roster -- code` en propose une nouvelle, à passer à `chiffrer` avec `--nouveau-code` et à reporter dans `src/club.ts` dans le même commit.
3. `npm run roster -- chiffrer membres.csv` écrit le fichier chiffré ; `npm run roster -- verifier` le relit.
4. Seul `public/data/club-roster.json` est ajouté au dépôt.

Les nageurs ne sont jamais ajoutés à la main. La liste du club se charge toute seule au premier lancement ; les parents touchent le cœur des nageurs à suivre. Une nouvelle liste publiée est appliquée automatiquement (nouveaux nageurs, changements de groupe). Les résultats de compétition de tous les membres sont ensuite ajoutés automatiquement.

### Historique des nageurs (swimrankings.net)

Le site des résultats en direct ne garde que les dernières semaines. L'historique complet est sur swimrankings.net, qui refuse les lectures automatiques : il se relève **dans le navigateur de l'utilisateur**, avec Claude sur son ordinateur (skill du projet `.claude/skills/historique-club`, app Claude avec navigateur intégré ou Claude in Chrome). Un fichier texte par nageur dans `historique/` (ignoré par git), puis `npm run roster -- historique historique` écrit `public/data/club-history.json`, **chiffré** avec la clé du club. Chaque membre le reçoit automatiquement à l'ouverture suivante (une fois par version, sans doublon). Seules les courses nagées **pour l'ESN** sont publiées : le club de chaque course est relevé sur swimrankings (8e colonne) et les courses d'un autre club (avant l'arrivée, après le départ) sont retirées, à la publication comme sur les téléphones déjà à jour. La recherche automatique des résultats (fichiers LENEX, feuilles PDF) ne retient de même que les lignes où le nageur nage pour l'ESN.

## Points World Aquatics

`points = 1000 × (temps de base / temps)³`. Les points officiels publiés avec les résultats sont conservés ; à défaut, ils sont calculés avec les temps de base de `src/lib/points.ts`, recoupés avec les points « FINA 2026 » de swimrankings.net. Ils restent indicatifs : à mettre à jour chaque saison.

## Compatibilité

- **iPhone et iPad** : iOS 15 et plus récent (Safari, ou Chrome, Firefox, Edge sur iPhone). Installation par Partager → « Sur l’écran d’accueil ».
- **Android** : Chrome, Samsung Internet, Firefox, Edge. Installation en un toucher (« Installer l’application »).
- **Ordinateur** : Chrome et Edge (installables), Safari sur Mac (« Ajouter au Dock », macOS 14+), Firefox (dans un onglet).
- Toutes tailles d’écran, en portrait comme en paysage ; le bouton retour (Android, navigateur) ferme d’abord la fenêtre ouverte.
- Garde-fous dans `tests/compat.test.ts` : pas de « lookbehind » dans les expressions régulières (iOS < 16.4), pas de `DecompressionStream`, repli pour `dvh` et `color-mix`, pas de `:has()` pour la mise en page. Le lecteur PDF ajoute les quelques fonctions récentes qui manquent (iOS < 17.4) et travaille alors dans la page (`src/lib/pdfText.ts`).

## Développement

```bash
npm install
npm run dev       # serveur de développement
npm test          # tests unitaires (temps, points, résultats, liste du club)
npm run build     # build de production dans dist/
npm run icons     # régénère le logo « ESN Compétition » et les icônes depuis brand/ (Playwright requis)
```

Identité du club : logo officiel d'origine dans `brand/` (versions claire et sombre, avec ou sans « NATATION »), logo « ESN Compétition » et icônes générés dans `public/brand/` et `public/icons/` par `npm run icons`, couleurs `--brand-green` / `--brand-blue` dans `src/styles/global.css`. Club par défaut, fiche « Le club » (Réglages › À propos) et pays des compétitions suivies : `src/club.ts`.

Stack : React 19, TypeScript, Vite. Aucune dépendance d'exécution en dehors de React. Le service worker (`src/sw-template.js`) est généré au build avec la liste des fichiers à précharger.

```
src/
  lib/          logique métier (temps, épreuves, points, statistiques, résultats en direct, liste du club, calendrier)
  store/        données (IndexedDB, repli localStorage), actions, exemple de démonstration
  components/   design system (barres, listes, feuilles, graphiques, séries en direct)
  screens/      écrans de l'application
tests/          tests Vitest
```

## Mise en ligne (GitHub Pages)

Le workflow `.github/workflows/deploy.yml` construit et publie l'application à chaque push sur `main`.
Activation, une seule fois : dépôt GitHub › **Settings › Pages › Build and deployment › Source : « GitHub Actions »** (et non « Deploy from a branch », qui publierait les fichiers sources sans les compiler).
L'application est alors disponible sur `https://<organisation>.github.io/<dépôt>/`.

Le dossier `dist/` peut aussi être déposé tel quel sur n'importe quel hébergement statique (Netlify, Vercel, OVH…). HTTPS est requis pour l'installation et le mode hors-ligne.
