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
- **+ Noter un passage** : elle choisit le patient, tape ou dicte les soins avec le micro du clavier (« pansement d'escarre + insuline + glycémie »), appuie sur **Reconnaître**, vérifie les actes et la date, puis **Enregistrer**. Le passage compte pour ce jour-là seulement. Le formulaire se vide ensuite pour le patient suivant. Ça marche sans réseau.
- **Mes soins** : la tournée du jour. **Créer la tournée** : choisis le cabinet, puis touche les patients dans l'ordre de passage (« ‹ Cabinets » pour en ajouter d'un autre cabinet). Sur chaque ligne : **+ Soins**, **Absent** (avec ou sans facturation, pour ton estimation seulement). En fin de journée : **Bilan pour la note**, puis **Copier**, et colle-le dans la note partagée. Plus bas : ta part, le revenu par soin et les passages, par jour, semaine ou mois.
- **Transmissions** (semaine du mardi au lundi) : **📥 Reçues** le lundi de la collègue, **📤 À donner** à la fin de sa semaine. Choisis le cabinet, cherche le patient, puis **RAS ✅** ou **Info**. Les transmissions s'affichent ensuite en jaune (reçues) ou en vert (à donner) dans la tournée et sur la fiche patient.
- **Ordonnance** (📄 sur la fiche patient ou l'écran du passage) : photo de l'ordonnance, lue **sur le téléphone** (rien n'est envoyé). Elle vérifie les soins, la fréquence et les dates, puis Enregistrer. Ensuite, sur l'écran du passage, **Appliquer** remplit les actes en une touche. Si l'ordonnance n'est pas lue (souvent manuscrite) et qu'une clé API est enregistrée, l'appli propose de l'envoyer à l'IA, **seulement après confirmation** (la photo part alors chez Anthropic avec les infos du patient). La toute première lecture a besoin du réseau pour charger le lecteur, ensuite ça marche hors ligne.
- **Photos du soin** (📷 sur l'écran du passage) : rattachées au passage. Sur la fiche patient, 📷 montre toutes les photos avec J1, J7… pour suivre la plaie. Elles restent sur le téléphone.
- **Réglages** : la roue ⚙︎ en haut de l'accueil.
- **Refaire** : sur la fiche d'un patient, ce bouton recopie un passage au jour choisi (hier, aujourd'hui, demain ou autre date).
- **Nom dans la note** : dans la fiche patient, à remplir seulement si le nom de famille déduit automatiquement ne convient pas.
- **Répéter** (facultatif) : pour un remplacement long, un soin peut être répété tous les jours, tous les 2 jours ou certains jours.
- **Patients** : choisis un cabinet pour voir ses patients, avec **+ Nouveau patient** en haut. La recherche de la première page cherche dans tous les cabinets.
- **Cabinets** : nom et téléphone de la titulaire (bouton Appeler), montants du mois et virements.
- **Noter un virement reçu** dans chaque cabinet. L'accueil affiche alors ce qui manque.
- **Détail du mois (PDF)** : bouton **Exporter en PDF**, puis dans la fenêtre d'impression, **Partager** pour l'enregistrer en PDF.

## 5. Facultatif : l'assistant IA

Dans **Réglages**, puis **Assistant IA**, colle une clé API Anthropic (console.anthropic.com) et appuie sur **Tester**. Le bouton **Demander à l'IA** apparaît alors dans l'ajout de soin. Seul le texte des soins est envoyé, jamais le nom du patient. Le coût est de quelques centimes par mois.

## 6. Sauvegarde

Dans **Réglages**, puis **Sauvegarder** : ça crée un fichier chiffré par un mot de passe, avec ou sans les photos (case à cocher) (à ranger dans Fichiers ou iCloud Drive). Pour récupérer les données sur un nouveau téléphone : **Restaurer**. Pense à le faire régulièrement.

## 7. Mise à jour de l'appli

Sur GitHub, dans le dépôt : **Add file**, puis **Upload files**, glisse les nouveaux fichiers (ils remplacent les anciens), puis **Commit changes**. Sur l'iPhone, ouvre Soeuringue avec du réseau, ferme-la complètement, puis rouvre-la : la nouvelle version s'affiche. Dans `sw.js`, change le numéro de version (`soeuringue-v1.7.0` devient `v1.7.1`, etc.). L'appli se mettra à jour toute seule à la prochaine ouverture avec du réseau. Les données ne sont pas touchées.

---
Les montants sont des **estimations** calculées selon la NGAP (avenant 11), la brochure Idelstory et le guide CBA. Les tarifs et les règles sont modifiables dans Réglages. Pour un cas particulier, il y a **Ajouter un acte à la main**, puis **Acte manuel**.
