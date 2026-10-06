# Liaison — Main courante du tronc principal

Application de bureau (Windows) qui remplace la saisie dans le classeur Excel
« main courante » et facilite la **liaison entre les services** matin (5H-13H),
après-midi (13H-20H) et nuit (20H-4H).

Elle reprend exactement la structure de l'onglet « Modèle » du classeur
(agents absents, entrées, sorties, état des boxs, N.B.) et sait **exporter vers
un classeur Excel au même format** (un onglet `JJ-MM` par jour, mise en forme
du modèle, listes déroulantes, remplissage coloré du vert au rouge, une page A4
par service). Les sections s'allongent selon le contenu (absents, sorties
ponctuelles, déchets non conformes, tâches, observations). Un onglet masqué
garde toutes les données pour que le réimport soit fidèle ; les classeurs
remplis à la main à l'ancien format restent importables. Un onglet **Synthèse**
reprend les chiffres clés de la période avec de **vrais graphiques Excel**
(modifiables) : tonnage par matière et entrées par service (camemberts),
tonnage par jour et nombre de sorties par matière (histogrammes), absences par
motif, et le tableau des déchets non conformes.

## Parcours

1. **Qui prend le poste ?** — choix du responsable parmi la liste (partagée entre
   tous les postes, modifiable dans les paramètres ou avec « Ajouter »). Un
   **superviseur** saisit son code PIN.
2. **Quel site ?** — toujours demandé, pour tout le monde : on peut changer de
   site d'un jour à l'autre. Le dernier site choisi est mis en avant ; la carte
   **+ Ajouter un site** ajoute le dossier d'un autre site. Un responsable qui
   choisit un site où il n'est pas encore inscrit y est ajouté automatiquement.
3. **Quel service ?** — les trois services du jour en cartes : état (clôturé, en
   cours…), responsable, nombre d'observations et d'alertes. « Voir le détail »
   ouvre la fiche du service sans entrer en saisie.
4. **Main courante** — la saisie du service choisi. Le responsable choisi à
   l'étape 1 est inscrit automatiquement s'il n'y en a pas encore. Le bouton en
   haut à droite (nom + service) ramène au choix du service ou du responsable.

## Jour non travaillé, saisie par erreur

Ouvrir un service sans rien saisir ne l'enregistre pas : la case reste vide
dans le récap. Le bouton **Vider** (en haut de la saisie) efface toute la saisie
d'un service, comme si rien n'avait été fait (un service clôturé doit d'abord
être rouvert).

## Observations

Les observations sont en tête de la saisie, avec une ligne de saisie rapide
(heure préremplie, texte, Entrée). Chaque observation garde le nom de son auteur
et peut être marquée **importante** (drapeau) : elle ressort alors en rouge dans
la relève, la fiche et le journal, et est précédée de « ⚠ » dans l'export Excel.

- Bouton **+ Observation** (ou **Ctrl+O**) accessible depuis tous les écrans.
- Onglet **Observations** : journal de toutes les observations et consignes,
  sur la journée, 7 jours ou le mois, avec recherche, filtre par service et
  filtre « importantes ».

## Plusieurs sites, superviseur

- **Site** = un dossier de données, avec son nom (Paramètres → *Nom du site*).
  Deux sites indépendants n'ont qu'à utiliser deux dossiers différents : aucune
  donnée partagée. Chaque poste peut connaître plusieurs sites (carte
  *+ Ajouter un site* ou Paramètres) : on choisit le site après son nom.
- **Superviseur** : ajouté dans les paramètres de chaque site avec un code PIN
  (4 à 8 chiffres ; seule une empreinte du code est enregistrée). Il accède à
  tous les sites du poste et dispose d'un **tableau de bord** : services du jour,
  tâches en attente, services saisis non clôturés, observations importantes,
  boxs en alerte et déchets non conformes des 7 derniers jours, pour chaque site.
  Le code PIN est une protection légère : la vraie confidentialité dépend des
  droits Windows sur le dossier partagé.

## Inventaire

Onglet **Inventaire**, indépendant de la main courante, **un par site** (rangé
dans le sous-dossier `inventaire` du dossier du site).

- **Catégories** entièrement personnalisables (ajouter, renommer, supprimer ;
  les articles d'une catégorie supprimée passent « Sans catégorie »).
- **Articles** créés par les utilisateurs : nom, catégorie, unité, seuil
  d'alerte, note. Cliquer sur le nom pour modifier ou supprimer.
- **Suivi en continu** : *+ Entrée*, *− Sortie*, *= Comptage* (le stock devient
  la quantité comptée). Chaque mouvement garde sa date, son auteur et un
  commentaire ; l'horloge ouvre l'historique (un mouvement saisi par erreur
  peut y être annulé).
- **Seuil d'alerte** par article : sous le seuil, la ligne passe en rouge, un
  petit badge apparaît sur l'onglet et le tableau de bord du superviseur le
  signale.
- Recherche et filtres par catégorie / stock bas.

## Versions différentes sur les postes

Chaque service enregistré note la version de l'application. Un poste plus
ancien **ne peut pas écraser** un service enregistré par une version plus
récente (il l'affiche en lecture seule) et conserve les informations qu'il ne
connaît pas. Chaque poste inscrit sa version dans `postes/` : si un autre poste
est plus à jour, un bandeau invite à installer la nouvelle version.

## Agents absents

Quatre lignes comme sur la feuille, et **« Ajouter un agent »** pour en mettre
davantage (à partir du 5e, ils sont reportés dans les N.B. de l'export Excel).
Les noms déjà saisis sont **mémorisés** et proposés au fil de la frappe (liste
commune, modifiable dans les paramètres). « Reprendre les absents du service
précédent » recopie les absences en cours (CP, maladie…).

## Tâches pour la relève

Les anciennes « consignes » sont devenues des **tâches à cocher**. Une tâche non
faite reste affichée aux services suivants (et dans le panneau de relève)
jusqu'à ce qu'un responsable la valide ; on voit qui l'a créée, qui l'a faite et
quand. Les autres postes reçoivent une alerte discrète à chaque ajout ou
validation, et le nombre de tâches en attente s'affiche à côté de « Saisie ».

## État des boxs

Les lignes de bennes et de plateaux se règlent pour le site : **+ Benne** /
**+ Plateau** sous chaque liste, et la petite croix (au survol) pour retirer une
ligne. Le changement vaut pour tous les services suivants ; les services déjà
saisis gardent leurs chiffres (y compris dans l'export Excel).

## Stockage et commandes

- **Stockage** (dans la saisie) : une ligne par lot de bennes stockées sur site,
  avec le type (ex. « Benne Fer »), le nombre et l'état **Vide / Pleine / En
  cours**. Ajout et suppression libres ; *Reprendre le service précédent* recopie
  les lignes du service d'avant. Un total par état s'affiche sous la liste.
- **Commandes** : remplies par le **matin** (quoi, quantité, fournisseur, date
  prévue, case *Reçue*). L'après-midi et la nuit les voient en haut de leur
  saisie, en information.

Les deux figurent dans la fiche, l'impression, la recherche et l'export Excel.

## Sorties

- **Plusieurs bennes** : taper `5,54+4,74` dans la case tonnage, ou indiquer le
  nombre de sorties (2 ou plus) pour faire apparaître une case par pesée. Le
  total se calcule seul ; dans Excel la cellule contient la formule `=5.54+4.74`.
- **Sorties ponctuelles** (ex. sapins en hiver) : « + Sortie ponctuelle »,
  supprimables, comptées dans les totaux et le récap.
- **Couleurs** : la pastille devant chaque matière choisit sa couleur (nom seul
  ou ligne entière) ; les sorties externes sont en vert par défaut. Les couleurs
  sont communes au site (`site.json`) et reprises dans l'export Excel.

## Déchets non conformes et photos

Sous l'état des boxs : type, quantité (pièces, kg ou T), provenance,
commentaire et photos. Les types déjà saisis sont proposés avec leur unité.
Les **photos** s'ajoutent aux observations et aux déchets non conformes (bouton
appareil photo, glisser-déposer ou Ctrl+V) ; elles sont réduites et rangées dans
`photos/` du dossier commun, et reprises en miniature dans l'onglet « Photos »
de l'export Excel. Dans les listes de suggestions (agents, déchets), la croix
retire une entrée mémorisée par erreur.

## Récap du mois : graphiques et recherche

Le récap affiche le **tonnage sorti par jour** (survoler une barre pour le
détail) et la répartition des **entrées par service**.

La **recherche** par mots-clés (sans tenir compte des accents) porte dans les observations,
tâches, absents, déchets non conformes, sorties ponctuelles et responsables,
sur le mois affiché ou une période au choix. Un clic ouvre la fiche du service.

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

Les données sont stockées en JSON lisible dans le dossier commun :
`AAAA/MM/AAAA-MM-JJ_service.json` (un fichier par service), `taches/` (un fichier
par tâche), `photos/`, `responsables.json`, `agents.json`,
`types-non-conformes.json`, `site.json` (nom du site, couleurs) et `postes/`
(version de chaque poste). Les superviseurs sont dans `responsables.json`.

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
| `src/core/dashboard.js` | Résumé d'un site pour le tableau de bord du superviseur |
| `src/core/excel-synthese.js`, `excel-charts.js` | Onglet Synthèse et graphiques Excel natifs (DrawingML) |
| `src/core/excel-sheet.js` | Construction d'un onglet jour à hauteur variable (styles repris du modèle) |
| `src/core/excel.js` | Export/import au format du classeur à partir de `assets/modele.xlsx` |
| `src/main.js`, `src/preload.js` | Processus Electron, dialogues fichiers, configuration |
| `src/renderer/` | Interface (HTML/CSS/JS sans framework) : `app.js`, `taches.js`, `photos.js`, `suggest.js`, `icons.js` |
| `assets/modele.xlsx` | Onglets « Légende » et « Modèle » du classeur d'origine |

Pour modifier les matières, bennes, plateaux ou motifs d'absence, mettre à jour
`src/core/model.js` **et** l'onglet « Modèle » de `assets/modele.xlsx`.
