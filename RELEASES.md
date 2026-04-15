# Release et mises a jour

## Ce que fait le projet maintenant

- `npm run desktop:deliver`
  Cree l installateur simple a partager en local.

- `npm run desktop:release:deliver`
  Cree l installateur signe pour les mises a jour et prepare un dossier `release/windows` avec :
  - `Budget PC Installer.exe`
  - `Budget PC Installer.exe.sig`
  - `latest.json`

L application verifie ensuite les mises a jour depuis `Parametres` et aussi automatiquement au demarrage.

## 1. Generer la cle updater une seule fois

Commande officielle Tauri :

```powershell
npm run tauri signer generate -- -w "$HOME\\.tauri\\budget-pc.key"
```

Garde bien :

- la cle privee en lieu sur
- la cle publique pour les builds de release

La cle privee ne doit jamais etre commit.

## 2. Variables a definir avant une release

Dans PowerShell :

```powershell
$env:TAURI_UPDATER_PUBKEY="-----BEGIN PUBLIC KEY-----`nCOLLE_ICI_TA_CLE_PUBLIQUE`n-----END PUBLIC KEY-----"
$env:TAURI_UPDATER_ENDPOINTS="https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
$env:TAURI_RELEASE_DOWNLOAD_BASE_URL="https://github.com/<owner>/<repo>/releases/latest/download"
$env:TAURI_SIGNING_PRIVATE_KEY="$HOME\\.tauri\\budget-pc.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

Notes :

- `TAURI_UPDATER_ENDPOINTS` est l URL lue par l app installee.
- `TAURI_RELEASE_DOWNLOAD_BASE_URL` sert a fabriquer le `latest.json`.
- `TAURI_SIGNING_PRIVATE_KEY` est obligatoire pour signer l installateur et sa mise a jour.

La doc officielle Tauri precise bien que la signature se fait avec les variables d environnement au moment du build, pas via un fichier `.env` :
https://v2.tauri.app/plugin/updater/

## 3. Sortir une nouvelle version

1. Monte la version dans :
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Lance :

```powershell
npm run desktop:release:deliver
```

3. Recupere les fichiers dans :
   - [release/windows](c:/Users/jean-/Desktop/APP_test/budget-pc/release/windows)

## 4. Publier sur GitHub Releases

Le projet contient deja un workflow GitHub :

- [.github/workflows/release.yml](c:/Users/jean-/Desktop/APP_test/budget-pc/.github/workflows/release.yml)

Donc apres la configuration initiale, tu n auras plus besoin d uploader a la main.

Le workflow :

- build la version Windows NSIS
- signe les artefacts updater
- cree ou met a jour la GitHub Release du tag
- publie les fichiers necessaires a l updater

L endpoint vise ensuite :

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

## 5. Premiere mise en place GitHub

1. Cree un repo GitHub pour le projet.
2. Push le code dessus.
3. Dans `Settings > Secrets and variables > Actions`, ajoute :

Secrets :

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBKEY`

4. Commit le workflow.
5. Quand tu veux sortir une version, cree un tag :

```powershell
git tag v0.1.20
git push origin v0.1.20
```

6. GitHub Actions fera la release automatiquement.



## 7. Patch notes 0.1.21

- Correction et amélioration de l'affichage des cartes Courses et Essence sur le dashboard
- Amélioration du menu Admin (ergonomie, gestion des rôles, accès, à améliorer)
- Modification du système de tickets (ajout, édition, suivi)
- Ajout de la création de ticket (fonctionnelle mais à améliorer)
- Divers correctifs et ajustements visuels


## Patch notes précédentes

### v0.1.19 (14/04/2026)
Correction de l'affichage Invalid Date sur l'écran de mise à jour


### v0.1.18 (14/04/2026)
Correction de l'ordre des derniers tickets sur le dashboard (les plus récents en premier)

### v0.1.17 (14/04/2026)
Mise à jour obligatoire : overlay bloquant si une MAJ est disponible
Vérification automatique des mises à jour toutes les 5 minutes
Redémarrage automatique après installation de la mise à jour
Nouvelle page Version avec patch notes et sélecteur de version
Suppression du bandeau de mise à jour optionnel

### v0.1.16 (01/06/2025)
Ajout de la page Version avec patch notes
Synchronisation des abonnements entre utilisateurs
Correction du curseur collaboratif avec le scroll
Historique séparé App / Google Sheets en deux colonnes
Validation du formulaire d'ajout d'abonnement
Effets hover/active sur les boutons modaux

### v0.1.15 (25/05/2025)
Système d'abonnements dynamiques avec ajout/suppression
Modale d'ajout et de suppression d'abonnement
Toast et historique pour les actions abonnements
Signaux collaboratifs (ping, assist, celebrate, focus)

### v0.1.14 (18/05/2025)
Vue collaboration multi-utilisateurs en temps réel
Curseurs distants avec couleur personnalisée
Note partagée synchronisée entre pairs
Badges de présence et liste des collaborateurs

### v0.1.13 (10/05/2025)
Page Paramètres avec profil et identité
Sauvegarde du profil dans Supabase
Choix de la couleur de curseur
Déconnexion et gestion de session

### v0.1.12 (02/05/2025)
Système de remboursements avec historique
Undo/Redo pour les remboursements
Export des tickets en CSV
Améliorations du dashboard

## 7. Patch notes 0.1.20

- Ajout du panel Admin (acces restreint aux admins)
- Liste des comptes avec email, prenom, nom, pseudo, couleur et role
- Promotion / retrait du role admin pour les co-gerants
- Blocage d acces aux actions admin sans autorisation
- Compteur utilisateurs en ligne cliquable avec popup des noms
- Refonte visuelle des cartes Courses / Essence sur le dashboard
- Backend comptes et securite: role admin/user + sessionToken + actions admin

## 6. Cote utilisateur

Quand toi ou ta copine ouvrez l app :

- l app verifie la presence d une nouvelle version
- une banniere apparait si une MAJ existe
- clic sur `Installer la MAJ`
- Tauri telecharge puis installe la nouvelle version

## References officielles

- Plugin updater Tauri : https://v2.tauri.app/plugin/updater/
- Tauri Action GitHub Releases : https://github.com/tauri-apps/tauri-action
