# Nageo 🏊

**Le carnet de performances gratuit des parents de nageurs.**
Application web progressive (PWA) : s'installe sur iPhone et Android, fonctionne aussi dans un navigateur d'ordinateur, et marche hors-ligne au bord du bassin.

Gratuit, sans publicité, sans compte : les données restent sur l'appareil du parent.

## Fonctionnalités

| | |
|---|---|
| ⏱️ **Saisie éclair** | Clavier « chronomètre » : on tape `12462` → `1:24.62`. Le record est détecté pendant la saisie. Confettis à chaque nouveau record. |
| 📈 **Progression nage par nage** | Courbe par épreuve et par bassin (axe inversé : plus haut = plus rapide), escalier des records, ligne d'objectif, comparaison avec d'autres nageurs. |
| 📊 **Statistiques** | Progression totale, sur 12 mois, tendance par mois, régularité, allure aux 100 m, points World Aquatics, tableau saison par saison, plus belles progressions. |
| 🏆 **Records** | Meilleurs temps à vie ou de la saison, en petit et grand bassin, comme sur swimrankings.net. |
| 🥇 **Classements** | Classement par épreuve entre vos enfants et les nageurs suivis (coéquipiers, amis), par sexe et par année de naissance. |
| 📅 **Compétitions** | Programme de chaque compétition : n° d'épreuve, heure, série, ligne, temps d'engagement, PB actuel. Saisie des résultats en direct. Export vers le calendrier du téléphone avec rappel 30 min avant chaque course. |
| 🎯 **Objectifs** | Temps limites ou chronos à battre, jauge de progression, **estimation de la date d'atteinte** au rythme actuel. |
| 🎖️ **Trophées** | 19 badges à débloquer (premier record, coup du chapeau, polyvalence, 300 points…). |
| ⏲️ **Temps de passage** | Tronçons, allure aux 50 m, détection du « split négatif ». |
| 🏊 **Entraînements** | Chronos d'entraînement séparés (inclus ou non dans les records). |
| 👨‍👩‍👧 **Plusieurs nageurs** | Frères et sœurs, nageurs suivis, favoris. |
| 🔄 **Import swimrankings.net** | Bouton-favori « Envoyer vers Nageo » ou copier-coller de la page du nageur. |
| 💾 **Sauvegarde** | Export / restauration JSON (transfert vers un autre téléphone, partage avec l'autre parent), export CSV pour Excel. |
| 🌗 **Design** | Style iOS natif, mode sombre et clair, onglets sur mobile et barre latérale sur ordinateur. |

## Import depuis swimrankings.net

swimrankings.net est protégé contre les accès automatisés et n'autorise pas les autres sites à lire ses pages. L'application ne contourne pas cette protection : l'import se fait **depuis le navigateur du parent**, sur la page qu'il a lui-même ouverte.

1. **Bouton-favori** (recommandé) : depuis *Réglages › Importer*, on installe le favori « Envoyer vers Nageo ». Sur la fiche du nageur, un clic ouvre l'application avec les temps prêts à importer (noms complets des compétitions, année de naissance, club, sexe, identifiant swimrankings).
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
npm run icons     # régénère les icônes (Playwright requis)
```

Club par défaut et fiche « Club » (Réglages › À propos) : `src/club.ts`.

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
