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

Une nouvelle version sera publiée sur la même page de téléchargement : il suffit
de réinstaller par-dessus. Les données (dans le dossier commun) ne sont pas
touchées.
