# Installer et partager Liaison

## 1. Télécharger l'application

Page de téléchargement : <https://github.com/Aethilia/Liaison/releases/latest>

| Fichier | Pour qui |
| --- | --- |
| `Liaison-Installation-1.0.0.exe` | **Recommandé.** Installe l'appli et crée un raccourci sur le bureau. |
| `Liaison-Portable-1.0.0.exe` | Sans installation (poste sans droits administrateur, clé USB). Double-clic pour lancer. |

Comme l'application n'est pas signée numériquement, Windows peut afficher
« Windows a protégé votre ordinateur » : cliquer sur **Informations
complémentaires** puis **Exécuter quand même**. Si l'antivirus de l'entreprise
bloque l'exécutable, le service informatique devra l'autoriser.

## 2. Créer le dossier commun (une seule fois)

Les données ne sont pas dans l'application mais dans un **dossier** : pour que
tout le monde voie la même main courante, ce dossier doit être **partagé**.

1. Créer un dossier sur un lecteur réseau accessible aux 3 responsables, par
   exemple `\\serveur\partage\Liaison` ou `S:\Exploitation\Liaison`.
2. Vérifier que chacun peut **lire et écrire** dedans.

À défaut de lecteur réseau, un dossier OneDrive / SharePoint synchronisé
fonctionne aussi, à condition que les postes soient connectés : évitez alors
que deux personnes modifient le **même service** au même moment.

## 3. Configurer chaque poste (au premier lancement)

La fenêtre **Paramètres** s'ouvre automatiquement :

1. **Nom du poste** : ex. « Pont-bascule », « Bureau chef ».
2. **Dossier des données** : *Choisir…* puis sélectionner **le dossier commun**
   (le même sur tous les postes).
3. **Responsables** : sur le premier poste seulement, ajouter les 3 noms. Les
   autres postes récupèrent la liste automatiquement depuis le dossier commun.
4. **Enregistrer**.

Les paramètres restent modifiables avec l'icône ⚙ (écran d'accueil ou en haut
à droite).

## 3 bis. Un autre site, un superviseur

- **Autre site indépendant** : il crée son propre dossier (ex.
  `S:\Liaison-SiteNord`) et le choisit dans ses paramètres, avec le nom du site.
  Ses données restent séparées des vôtres.
- **Superviseur** : dans ⚙ Paramètres de chaque site, rubrique *Superviseurs*,
  saisir son nom et un code PIN. Sur son poste, ajouter chaque site avec
  *Ajouter un autre site…* : il choisira son nom, tapera son code, puis le site.

## 4. Utilisation au quotidien

1. Cliquer sur son nom → choisir son service → saisir.
2. Les observations s'ajoutent en tête de page (Entrée pour valider) ou
   n'importe où avec **Ctrl+O**.
3. En fin de service : remplir les **consignes pour la relève** puis
   **Clôturer le service**. Le service suivant les voit en arrivant.

Tout est enregistré automatiquement et les autres postes se mettent à jour
seuls au bout de quelques secondes.

## 5. Sauvegarde

Le dossier commun contient toutes les données (fichiers `.json` par jour et par
service). Il suffit qu'il soit inclus dans les sauvegardes du serveur. Un export
Excel mensuel (**Exporter le mois**) en garde aussi une copie au format habituel.

## 6. Mettre à jour l'application

À partir de la version 1.1.0, la mise à jour se fait depuis le dossier commun :

1. Télécharger le nouvel installateur `Liaison-Installation-x.y.z.exe` sur la
   page de téléchargement (<https://github.com/Aethilia/Liaison/releases/latest>).
2. Le déposer dans le sous-dossier **`mises-a-jour`** du dossier commun (créé
   automatiquement ; bouton *Dossier des mises à jour* dans les paramètres).
   Pour les postes en version portable, y déposer aussi `Liaison-Portable-x.y.z.exe`.
3. Chaque poste affiche « **Nouvelle version disponible** » au démarrage (et
   toutes les 30 minutes) : cliquer sur **Installer**. L'application enregistre
   les saisies, se ferme, s'installe et se relance seule.

Les données ne sont jamais touchées par une mise à jour. Les postes encore en
1.0.0 doivent installer la 1.1.0 une fois à la main (elle apporte cette
fonction) ; ensuite tout passe par le dossier commun.
