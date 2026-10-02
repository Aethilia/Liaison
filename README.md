# Liaison — Main courante du tronc principal

Application de bureau (Windows) qui remplace la saisie dans le classeur Excel
« main courante » et facilite la **liaison entre les services** matin (5H-13H),
après-midi (13H-20H) et nuit (20H-4H).

Elle reprend exactement la structure de l'onglet « Modèle » du classeur
(agents absents, entrées, sorties, état des boxs, N.B.) et sait **exporter vers
un classeur Excel identique** (un onglet `JJ-MM` par jour, mise en forme,
listes déroulantes, barres de remplissage et sauts de page compris).

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

## Utilisation

1. Au premier lancement, renseigner le **nom du poste** (ex. « Pont-bascule »)
   et le **dossier des données**. Pour partager entre plusieurs PC, choisir le
   même dossier réseau sur chaque poste (ex. `\\serveur\partage\Liaison`).
2. Choisir la date (flèches ou clic sur la date) et l'onglet du service.
3. Saisir : tout est enregistré automatiquement (Ctrl+S force l'enregistrement).
4. En fin de service : remplir les **consignes pour la relève** puis
   **Clôturer le service**.
5. **Exporter la journée / le mois** produit un classeur au format habituel
   (nommé par défaut `OCTOBRE_2026.xlsx` pour un mois).

Les données sont stockées en JSON lisible : `AAAA/MM/AAAA-MM-JJ_service.json`.

## Développement

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm start        # lance l'application
npm test         # tests du modèle, du stockage et de l'export/import Excel
npm run dist     # construit l'installateur et la version portable Windows (dossier dist/)
```

Le workflow GitHub Actions `Build Windows` (lancé à la main, sur un tag `v*` ou
sur une pull request) produit les exécutables Windows en artefact téléchargeable.

### Organisation du code

| Fichier | Rôle |
| --- | --- |
| `src/core/model.js` | Structure d'un service, totaux, ordre de relève (partagé avec l'interface) |
| `src/core/store.js` | Lecture/écriture des fichiers, détection des conflits entre postes |
| `src/core/excel.js` | Export/import au format du classeur à partir de `assets/modele.xlsx` |
| `src/main.js`, `src/preload.js` | Processus Electron, dialogues fichiers, configuration |
| `src/renderer/` | Interface (HTML/CSS/JS sans framework) |
| `assets/modele.xlsx` | Onglets « Légende » et « Modèle » du classeur d'origine |

Pour modifier les matières, bennes, plateaux ou motifs d'absence, mettre à jour
`src/core/model.js` **et** l'onglet « Modèle » de `assets/modele.xlsx`.
