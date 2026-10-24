# Soeuringue — installation

Soeuringue est une appli web installable. Tu la mets en ligne une fois (gratuit). Ta femme l'installe ensuite sur son iPhone depuis Safari. **Les données des patients restent uniquement sur son téléphone** : le site ne contient que le code de l'appli, jamais de données.

## 1. Mettre l'appli en ligne (GitHub Pages, gratuit)

1. Crée un compte sur github.com (ou connecte-toi).
2. En haut à droite, clique sur **+**, puis **New repository**. Nom : `soeuringue`, choisis **Public**, puis **Create repository**.
3. Clique sur **uploading an existing file**. Glisse **tous les fichiers** de ce dossier (pas le dossier lui-même), puis **Commit changes**.
4. Va dans **Settings**, puis **Pages**. Dans **Branch**, choisis `main` et `/ (root)`, puis **Save**.
5. Attends 1 à 2 minutes. L'adresse apparaît en haut de la page, sous la forme `https://TON-PSEUDO.github.io/soeuringue/`.

## 2. L'installer sur l'iPhone

1. Ouvre l'adresse dans **Safari** (pas Chrome).
2. Appuie sur le bouton **Partager**, puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. À partir de là, elle utilise **toujours l'icône Soeuringue**. Sur iPhone, l'appli installée garde ses propres données, séparées de l'onglet Safari.

## 3. Importer le répertoire patients (Google Sheets)

1. Dans Google Sheets, ouvre le tableau des patients. Sur ordinateur : **Fichier**, puis **Télécharger**, puis **Valeurs séparées par des virgules (.csv)**. Sur iPhone, dans l'appli Sheets : **⋯**, puis **Partager et exporter**, puis **Enregistrer sous**, puis **CSV**.
2. S'il y a un onglet par cabinet, exporte chaque onglet séparément.
3. Dans Soeuringue : **Réglages**, puis **Choisir un fichier CSV**.
4. Indique quelle colonne est le **nom** (et le **prénom** s'il est à part), puis le **cabinet** : soit pris dans une colonne, soit « tous dans » un cabinet existant ou nouveau. Les colonnes adresse, étage, numéro de porte, téléphone, soin (gardé en note) et code d'accès sont reconnues automatiquement. Les colonnes BSI (BSA/BSB/BSC, A/B/C ou légère/intermédiaire/lourde), diabète et km sont facultatives.
5. Vérifie l'aperçu, puis **Importer**. Les patients déjà présents ne sont pas importés en double : leur fiche est seulement complétée avec les infos qui manquaient (rien n'est écrasé). Les cabinets créés automatiquement ont une rétrocession de 10 %, modifiable ensuite.

## 4. Premiers pas

- **Créer les cabinets** : un par titulaire, avec la rétrocession (10 % par défaut).
- **+ Ajouter un soin** : elle tape ou dicte avec le micro du clavier (« pansement d'escarre + insuline + glycémie »), appuie sur **Reconnaître**, vérifie les actes, choisit le patient dans la liste, la fréquence, puis **Enregistrer**. Ça marche sans réseau.
- **Noter un virement reçu** dans chaque cabinet. L'accueil affiche alors ce qui manque.
- **Détail du mois (PDF)** : bouton **Exporter en PDF**, puis dans la fenêtre d'impression, **Partager** pour l'enregistrer en PDF.

## 5. Facultatif : l'assistant IA

Dans **Réglages**, puis **Assistant IA**, colle une clé API Anthropic (console.anthropic.com) et appuie sur **Tester**. Le bouton **Demander à l'IA** apparaît alors dans l'ajout de soin. Seul le texte des soins est envoyé, jamais le nom du patient. Le coût est de quelques centimes par mois.

## 6. Sauvegarde

Dans **Réglages**, puis **Sauvegarder** : ça crée un fichier chiffré par un mot de passe (à ranger dans Fichiers ou iCloud Drive). Pour récupérer les données sur un nouveau téléphone : **Restaurer**. Pense à le faire régulièrement.

## 7. Mise à jour de l'appli

Sur GitHub, dans le dépôt : **Add file**, puis **Upload files**, glisse les nouveaux fichiers (ils remplacent les anciens), puis **Commit changes**. Sur l'iPhone, ouvre Soeuringue avec du réseau, ferme-la complètement, puis rouvre-la : la nouvelle version s'affiche. Dans `sw.js`, change le numéro de version (`soeuringue-v1.2.1` devient `v1.2.2`, etc.). L'appli se mettra à jour toute seule à la prochaine ouverture avec du réseau. Les données ne sont pas touchées.

---
Les montants sont des **estimations** calculées selon la NGAP (avenant 11), la brochure Idelstory et le guide CBA. Les tarifs et les règles sont modifiables dans Réglages. Pour un cas particulier, il y a **Ajouter un acte à la main**, puis **Acte manuel**.
