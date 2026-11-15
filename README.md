# ESN Compétition 🏊

**L'application compétition gratuite des nageurs de l'[Ecole Seraing Natation](https://www.esn-seraing.be/)** : résultats officiels, records, progression et programme des compétitions.
Application web progressive (PWA) : s'installe sur iPhone et Android, fonctionne aussi dans un navigateur d'ordinateur, et marche hors-ligne au bord du bassin.

Gratuit, sans publicité, sans compte : les données restent sur l'appareil du parent.

## Fonctionnalités

| | |
|---|---|
| 📈 **Progression nage par nage** | Courbe par épreuve et par bassin (la courbe descend quand le temps s'améliore), escalier des records, ligne d'objectif, comparaison avec d'autres nageurs. |
| 📊 **Statistiques** | Progression totale, sur 12 mois, tendance par mois, régularité, allure aux 100 m, points World Aquatics, tableau saison par saison, plus belles progressions. |
| 🏆 **Records** | Meilleurs temps à vie ou de la saison, en petit et grand bassin, comme sur swimrankings.net. |
| 🥇 **Classements** | Classement par épreuve entre vos enfants et les nageurs suivis (coéquipiers, amis), par sexe et par année de naissance. |
| 📅 **Compétitions** | Programme de chaque compétition : n° d'épreuve, heure, série, ligne, temps d'engagement, PB actuel. Saisie des résultats en direct. Export vers le calendrier du téléphone avec rappel 30 min avant chaque course. |
| 🎯 **Objectifs** | Temps limites ou chronos à battre, jauge de progression, **estimation de la date d'atteinte** au rythme actuel. |
| 🎖️ **Trophées** | 19 badges à débloquer (premier record, coup du chapeau, polyvalence, 300 points…). |
| ⏲️ **Temps de passage** | Tronçons, allure aux 50 m, détection du « split négatif ». |
| 🏊 **Entraînements** | Chronos d'entraînement séparés (inclus ou non dans les records). |
| 👨‍👩‍👧 **Plusieurs nageurs** | Frères et sœurs, nageurs suivis, favoris. |
| ⚡ **Résultats automatiques** | Dès qu'un enfant est ajouté, ses résultats officiels de compétition (LENEX, live.swimrankings.net) arrivent tout seuls. |
| 📸 **Photos des résultats affichés** | Les feuilles affichées à la piscine, photographiées, sont lues sur le téléphone. |
| 🔄 **Import swimrankings.net** | Capture d'écran lue sur le téléphone, copier-coller ou bouton-favori (ordinateur). |
| 💾 **Sauvegarde** | Export / restauration JSON (transfert vers un autre téléphone, partage avec l'autre parent), export CSV pour Excel. |
| 🌗 **Design** | Logo officiel du club décliné en « ESN Compétition », couleurs du club (vert ESN et bleu du « S »), style iOS natif, mode sombre et clair, onglets sur mobile et barre latérale sur ordinateur. |

## Résultats en direct des compétitions (LENEX)

Les organisateurs utilisent Splash Meet Manager, qui publie les résultats de chaque compétition sur **live.swimrankings.net** (les mêmes feuilles que celles affichées à la piscine, et le fichier officiel `results.lxf` au format **LENEX**). Ce site autorise la lecture par d'autres applications (CORS) et son `robots.txt` permet l'accès aux pages de compétitions et aux fichiers `.lxf`.

L'application lit la liste des compétitions belges (`?nation=BEL`), télécharge le fichier LENEX de chacune (~50 Ko) et y retrouve vos nageurs (nom + année de naissance) : temps, place dans la catégorie d'âge, points, série et ligne, temps d'engagement, temps de passage, disqualification avec sa raison. Recherche **dès qu'un nageur est ajouté** (ou renommé), puis à chaque ouverture et toutes les 15 min pendant une compétition. Aucune action du parent n'est nécessaire. Code : `src/lib/lenex.ts`, `src/lib/liveResults.ts`.

## Import depuis swimrankings.net

swimrankings.net est protégé contre les accès automatisés et n'autorise pas les autres sites à lire ses pages. L'application ne contourne pas cette protection : l'import se fait **depuis le navigateur du parent**, sur la page qu'il a lui-même ouverte.

1. **Bouton-favori** (recommandé) : depuis *Réglages › Importer*, on installe le favori « Envoyer vers ESN ». Sur la fiche du nageur, un clic ouvre l'application avec les temps prêts à importer (noms complets des compétitions, année de naissance, club, sexe, identifiant swimrankings).
2. **Copier-coller** : on copie la page « Meilleurs temps » (ou « Tous les résultats » d'une nage) et on la colle dans l'application.

Le nageur, les compétitions et les performances sont créés automatiquement, sans doublons. Aucun identifiant ni mot de passe swimrankings n'est nécessaire.

## Points World Aquatics

`points = 1000 × (temps de base / temps)³`. Les points officiels sont conservés pour les temps importés. Pour les temps saisis, ils sont calculés avec les temps de base de `src/lib/points.ts`, recoupés avec les points « FINA 2026 » de swimrankings.net. Ils restent indicatifs : à mettre à jour chaque saison.

## Développement

```bash
npm install
npm run dev       # serveur de développement
npm test          # tests unitaires (temps, points, import swimrankings)
npm run build     # build de production dans dist/
npm run icons     # régénère le logo « ESN Compétition » et les icônes depuis brand/ (Playwright requis)
```

Identité du club : logo officiel d'origine dans `brand/` (versions claire et sombre, avec ou sans « NATATION »), logo « ESN Compétition » et icônes générés dans `public/brand/` et `public/icons/` par `npm run icons`, couleurs `--brand-green` / `--brand-blue` dans `src/styles/global.css`. Club par défaut, fiche « Le club » (Réglages › À propos) et pays des compétitions suivies : `src/club.ts`.

Stack : React 19, TypeScript, Vite. Aucune dépendance d'exécution en dehors de React. Le service worker (`src/sw-template.js`) est généré au build avec la liste des fichiers à précharger.

```
src/
  lib/          logique métier (temps, épreuves, points, statistiques, import, calendrier)
  store/        données (localStorage), actions, exemple de démonstration
  components/   design system (barres, listes, feuilles, graphique, saisie de temps)
  screens/      écrans de l'application
tests/          tests Vitest
```

## Mise en ligne (GitHub Pages)

Le workflow `.github/workflows/deploy.yml` construit et publie l'application à chaque push sur `main`.
Activation, une seule fois : dépôt GitHub › **Settings › Pages › Build and deployment › Source : « GitHub Actions »** (et non « Deploy from a branch », qui publierait les fichiers sources sans les compiler).
L'application est alors disponible sur `https://<organisation>.github.io/<dépôt>/`.

Le dossier `dist/` peut aussi être déposé tel quel sur n'importe quel hébergement statique (Netlify, Vercel, OVH…). HTTPS est requis pour l'installation et le mode hors-ligne.

## Skill Claude « swimrankings-esn »

`claude-skill/swimrankings-esn.zip` : une skill pour Claude (app de bureau avec navigateur intégré, ou Claude in Chrome). Donnez à Claude le lien swimrankings d'un nageur : il ouvre la page **dans votre navigateur**, relève les temps et renvoie un lien d'import vers l'application ESN Compétition prêt à l'emploi (plus le texte à coller). Aucune connexion ni mot de passe swimrankings ; une vérification anti-robot éventuelle est validée par vous.
