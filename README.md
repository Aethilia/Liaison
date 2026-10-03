# Liaison — Main courante du tronc principal

Application de bureau (Windows) qui remplace la saisie dans le classeur Excel
« main courante » et facilite la **liaison entre les services** matin (5H-13H),
après-midi (13H-20H) et nuit (20H-4H).

Elle reprend exactement la structure de l'onglet « Modèle » du classeur
(agents absents, entrées, sorties, état des boxs, N.B.) et sait **exporter vers
un classeur Excel identique** (un onglet `JJ-MM` par jour, mise en forme,
listes déroulantes, barres de remplissage et sauts de page compris).

## Parcours

1. **Qui prend le poste ?** — choix du responsable parmi la liste (partagée entre
   tous les postes, modifiable dans les paramètres ou avec « Ajouter »).
2. **Quel service ?** — les trois services du jour en cartes : état (clôturé, en
   cours…), responsable, nombre d'observations et d'alertes. « Voir le détail »
   ouvre la fiche du service sans entrer en saisie.
3. **Main courante** — la saisie du service choisi. Le responsable choisi à
   l'étape 1 est inscrit automatiquement s'il n'y en a pas encore. Le bouton en
   haut à droite (nom + service) ramène au choix du service ou du responsable.

## Observations

Les observations sont en tête de la saisie, avec une ligne de saisie rapide
(heure préremplie, texte, Entrée). Chaque observation garde le nom de son auteur
et peut être marquée **importante** (drapeau) : elle ressort alors en rouge dans
la relève, la fiche et le journal, et est précédée de « ⚠ » dans l'export Excel.

- Bouton **+ Observation** (ou **Ctrl+O**) accessible depuis tous les écrans.
- Onglet **Observations** : journal de toutes les observations et consignes,
  sur la journée, 7 jours ou le mois, avec recherche, filtre par service et
  filtre « importantes ».

## Agents absents

Quatre lignes comme sur la feuille, et **« Ajouter un agent »** pour en mettre
davantage (à partir du 5e, ils sont reportés dans les N.B. de l'export Excel).
Les noms déjà saisis sont **mémorisés** et proposés au fil de la frappe (liste
commune, modifiable dans les paramètres). « Reprendre les absents du service
précédent » recopie les absences en cours (CP, maladie…).

## Fiche détaillée d'un service

L'icône « œil » (onglets de service, cartes de l'étape 2, panneau de relève,
journal) et les pastilles du récap mensuel ouvrent la **fiche du service** :
observations, consignes, responsable, absents, activité, sorties par matière et
état des boxs, avec navigation vers le service précédent / suivant.

## Ce que l'application apporte en plus du classeur

- **Passation de la relève** : à l'ouverture d'un service, le panneau de droite
  affiche ce que le service précédent a transmis : responsable, consignes,
  boxs à 80 % ou plus, observations, activité, absents. Un bouton permet de
  reprendre l'état des boxs pour ne mettre à jour que ce qui a changé.
- **Consignes pour la relève** : un champ dédié, affiché en priorité au service
  suivant (et recopié dans les lignes N.B. à l'export Excel).
- **Clôture du service** : le chef de service clôture son service (avec rappel
  des oublis éventuels : responsable, boxs, observations). On voit d'un coup
  d'œil, sur les onglets, quels services sont clôturés, non clôturés ou en cours.
- **Ouverture sur le service en cours** selon l'heure (entre minuit et 5H, on est
  toujours sur la nuit de la veille).
- **Plusieurs postes** : les données sont des fichiers dans un dossier qui peut
  être un **partage réseau**. Chaque service a son propre fichier, les écrans se
  mettent à jour seuls toutes les quelques secondes, et si deux postes modifient
  le même service en même temps, l'application le signale au lieu d'écraser.
- **Récap du mois** : entrées, sorties et tonnage par jour et par matière,
  absences par motif, services clôturés.
- **Saisie rapide** : enregistrement automatique, totaux calculés, tonnage saisi
  en `5,54` ou en notation terrain `5T540`, Entrée pour passer à l'observation
  suivante (l'heure est préremplie).
- **Import** d'un classeur existant (ex. `OCTOBRE_2026.xlsx`) et **impression**
  de la journée (une page A4 par service, comme le classeur).

## Installation et partage avec les collègues

Voir [PARTAGE.md](PARTAGE.md) : téléchargement, dossier commun, configuration des postes.

## Utilisation

1. Au premier lancement, renseigner le **nom du poste** (ex. « Pont-bascule »),
   le **dossier des données** et les **responsables**. Pour partager entre plusieurs PC, choisir le
   même dossier réseau sur chaque poste (ex. `\\serveur\partage\Liaison`).
2. Choisir son nom, puis le service (la date se change aux deux étapes).
3. Saisir : tout est enregistré automatiquement (Ctrl+S force l'enregistrement).
4. En fin de service : remplir les **consignes pour la relève** puis
   **Clôturer le service**.
5. **Exporter la journée / le mois** produit un classeur au format habituel
   (nommé par défaut `OCTOBRE_2026.xlsx` pour un mois).

Les données sont stockées en JSON lisible : `AAAA/MM/AAAA-MM-JJ_service.json`,
et la liste des responsables dans `responsables.json`.

## Développement

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm start        # lance l'application
npm test         # tests du modèle, du stockage et de l'export/import Excel
npm run dist     # construit l'installateur et la version portable Windows (dossier dist/)
```

Pour publier une version : augmenter `version` dans `package.json`, puis lancer
le workflow GitHub Actions `Build Windows` (à la main). Il crée la Release `vX.Y.Z`
avec l'installateur et la version portable, à déposer ensuite dans le dossier
`mises-a-jour` du dossier commun (voir [PARTAGE.md](PARTAGE.md)).

### Organisation du code

| Fichier | Rôle |
| --- | --- |
| `src/core/model.js` | Structure d'un service, totaux, ordre de relève (partagé avec l'interface) |
| `src/core/store.js` | Lecture/écriture des fichiers, détection des conflits entre postes |
| `src/core/update.js` | Détection d'une nouvelle version dans `<dossier des données>/mises-a-jour` |
| `src/core/excel.js` | Export/import au format du classeur à partir de `assets/modele.xlsx` |
| `src/main.js`, `src/preload.js` | Processus Electron, dialogues fichiers, configuration |
| `src/renderer/` | Interface (HTML/CSS/JS sans framework, pictogrammes dans `icons.js`) |
| `assets/modele.xlsx` | Onglets « Légende » et « Modèle » du classeur d'origine |

Pour modifier les matières, bennes, plateaux ou motifs d'absence, mettre à jour
`src/core/model.js` **et** l'onglet « Modèle » de `assets/modele.xlsx`.
