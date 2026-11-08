# Comment installer et utiliser ProcureFlow

Ce document est le mode d'emploi rapide. Pour comprendre comment le projet est construit, consulte `GUIDE_COMPLET.md`.

## 1. Prérequis

Il faut installer :

- Node.js 20 ou une version plus récente ;
- Git, uniquement si tu veux publier le code ;
- VS Code, recommandé mais non obligatoire ;
- une connexion Internet pour charger la bibliothèque graphique SAPUI5 depuis `ui5.sap.com`.

Vérifie Node.js dans PowerShell :

```powershell
node --version
npm --version
```

## 2. Installer le projet

Ouvre PowerShell dans le dossier du projet :

```powershell
cd C:\ENSA\Achraf\SAP\project
npm install
```

`npm install` lit `package.json` et télécharge CAP, SQLite et les outils nécessaires dans `node_modules`.

## 3. Démarrer l'application

```powershell
npm run dev
```

La commande effectue deux opérations :

1. elle crée ou met à jour `db.sqlite` ;
2. elle démarre CAP sur le port 4004.

Attends ce message :

```text
server listening on { url: 'http://localhost:4004' }
```

Ouvre ensuite dans ton navigateur :

```text
http://localhost:4004/index.html
```

L'application affiche son propre écran de connexion. Utilise l'un des comptes locaux :

| Compte | Mot de passe | Autorisations |
|---|---|---|
| `viewer` | `viewer123` | Consulter uniquement |
| `approver` | `approver123` | Responsable de département |
| `finance` | `finance123` | Contrôle financier |
| `director` | `director123` | Direction des achats et création de commande |
| `admin` | `admin123` | Tous les droits, dont modification et suppression |

Ces comptes sont fictifs et actifs uniquement avec le profil de développement. Les identifiants restent en mémoire pendant la session et ne sont pas enregistrés dans le navigateur. Utilise le bouton de déconnexion dans l'en-tête pour changer de compte.

Ne ferme pas le terminal pendant l'utilisation. Pour arrêter le serveur, retourne dans le terminal et appuie sur `Ctrl+C`.

## 4. Utiliser le tableau de bord

La page d'accueil contient :

- les indicateurs du nombre de commandes et des décisions ;
- la valeur totale indicative du portefeuille ;
- une recherche par commande, fournisseur, acheteur ou catégorie ;
- un filtre par statut ;
- le tableau des commandes.

### Approuver une commande

1. Clique sur une commande portant le statut **À traiter**.
2. Laisse **Approuver** sélectionné.
3. Le serveur utilise automatiquement l'identité connectée comme responsable.
4. Le commentaire est obligatoire si le montant atteint 20 000 ou si la priorité est critique.
5. Clique sur **Enregistrer la décision**.

La commande passe au statut **Approuvée** et les indicateurs sont recalculés.

### Rejeter une commande

1. Ouvre une commande **À traiter**.
2. Sélectionne **Rejeter**.
3. L'identité du responsable vient automatiquement de la connexion.
4. Saisis obligatoirement la raison du rejet.
5. Enregistre.

Un rejet sans commentaire est bloqué dans l'interface et par le backend CAP. Un utilisateur `viewer` voit la commande, mais aucun bouton d'enregistrement.

### Consulter une décision existante

Clique sur une commande déjà approuvée ou rejetée. La fenêtre montre le responsable et son commentaire. Une deuxième décision est interdite pour conserver une information cohérente.

### Utiliser l'administration

1. Connecte-toi avec `admin / admin123`.
2. Clique sur **Administration** dans la barre de navigation.
3. Recherche une décision par commande, responsable ou commentaire.
4. Utilise le crayon pour modifier le statut ou le commentaire.
5. Utilise la corbeille pour supprimer une décision après confirmation.

L'onglet Administration n'est pas visible pour `viewer` et `approver`. Même en appelant directement l'API, CAP refuse les modifications et suppressions sans le rôle `Admin`.

## 5. Consulter directement l'API

Les commandes :

```text
http://localhost:4004/procurement/PurchaseOrders
```

Les décisions :

```text
http://localhost:4004/procurement/Reviews
```

Métadonnées OData :

```text
http://localhost:4004/procurement/$metadata
```

Le fichier `test/requests.http` contient des exemples. Avec l'extension VS Code **REST Client**, clique sur `Send Request` au-dessus d'une requête.

## 6. Lancer les tests

```powershell
npm test
```

Résultat attendu : au moins trente-cinq tests réussis, couvrant notamment les autorisations, la concurrence budgétaire et le connecteur OData S/4. Pour exécuter uniquement une catégorie :

```powershell
npm run test:unit
npm run test:integration
```

Les tests d'intégration démarrent automatiquement CAP sur un port disponible et utilisent une base SQLite en mémoire. Ils ne modifient pas `db.sqlite` ni tes décisions. Pour compiler aussi le modèle CDS :

```powershell
npm run check
```

## 7. Revenir aux données initiales

Le fichier `db.sqlite` contient tes décisions. Pour repartir de zéro :

1. arrête le serveur avec `Ctrl+C` ;
2. supprime uniquement `db.sqlite` ;
3. relance `npm run dev`.

CAP recréera la base à partir des fichiers CSV présents dans `db/data`.

## 8. Problèmes fréquents

### Le port 4004 est occupé

Ferme l'autre serveur CAP ou lance sur un autre port :

```powershell
$env:PORT=4005
npm run dev
```

L'adresse devient `http://localhost:4005/index.html`.

### La page reste blanche

- vérifie que le terminal affiche toujours le serveur CAP ;
- vérifie ta connexion Internet, car SAPUI5 est chargé depuis `ui5.sap.com` ;
- recharge avec `Ctrl+F5` ;
- vérifie que tu ouvres bien `/index.html`.

### Une commande ne peut plus être traitée

C'est normal si elle possède déjà une décision. Le backend renvoie HTTP 409 pour empêcher les doublons.

### Les données ne s'affichent pas

Teste d'abord l'URL `/procurement/PurchaseOrders`. Si elle fonctionne, ouvre les outils de développement du navigateur avec `F12` et consulte l'onglet Console.
# Connexion à une vraie API Purchase Order S/4HANA

## Utiliser le nouveau cycle Source-to-Pay

Après la connexion, ouvre **Demandes & Workflow** dans la barre de navigation.

1. Clique sur **Nouvelle demande**.
2. Choisis le centre de coûts et un fournisseur non bloqué.
3. Saisis l'article, la quantité, le prix et la justification.
4. Ouvre le brouillon créé puis clique sur **Soumettre**.
5. ProcureFlow contrôle le budget, calcule le risque et crée le workflow.
6. Traite chaque étape avec **Approuver l'étape** ou **Rejeter**.
7. Quand toutes les étapes sont approuvées, clique sur
   **Créer la commande S/4**.

Règles du circuit : responsable du département pour tous les achats, finance à
partir de 10 000 MAD, direction des achats à partir de 50 000 MAD ou lorsque le
risque est élevé. Le tableau inférieur affiche les budgets disponibles et le
risque des fournisseurs.

## Démonstration gratuite sans entreprise

Aucun tenant SAP n’est nécessaire pour ce mode. Dans le dossier du projet :

```powershell
npm run start:s4-mock
```

Cette commande lance :

- l’API S/4 simulée sur `http://localhost:4005/odata4/purchase-order` ;
- ProcureFlow sur `http://localhost:4004` ;
- le mode distant `S4_MODE=remote` automatiquement.

Connecte-toi avec `viewer`, `approver` ou `admin`. Les commandes `4500001001`,
`4500001002` et `4500001003` doivent apparaître. Arrête les deux serveurs avec
`Ctrl+C`.

Les données simulées sont dans `mock/s4/`. Tu peux modifier les deux fichiers
JSON pour créer tes propres commandes et postes. Si le port 4004 est déjà
occupé, arrête l’ancienne instance avec `Ctrl+C` avant de relancer.

Le simulateur reproduit uniquement les lectures utilisées par ProcureFlow. Il
ne prétend pas remplacer toutes les centaines d’opérations du véritable
service SAP.

Le fichier officiel `imports/CE_PURCHASEORDER_0001.edmx` a été importé dans
`srv/external/CE_PURCHASEORDER_0001.cds`. Il décrit l’API OData V4 active.
L’indication **No Sandbox** signifie que la clé de l’Accelerator Hub ne fournit
pas de données de démonstration : il faut un tenant S/4HANA Cloud réel.

## 1. Configuration nécessaire dans S/4HANA

Un administrateur S/4HANA doit créer un utilisateur de communication, un
système de communication, puis un arrangement de communication pour le
scénario `SAP_COM_0053` (Purchase Order Integration). Demande-lui ensuite :

- l’URL du service OData V4 ;
- le nom de l’utilisateur technique ;
- son mot de passe, ou la méthode OAuth configurée.

Le bouton **Show API Key** du Business Accelerator Hub ne remplace pas ces
identifiants lorsqu’une API affiche **No Sandbox**.

## 2. Configuration locale

Copie `.env.example` vers `.env`, puis renseigne les trois valeurs :

```env
S4_MODE=remote
S4_API_URL=https://.../sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001
S4_USERNAME=utilisateur-technique
S4_PASSWORD=mot-de-passe
```

Le fichier `.env` est ignoré par Git. Ne place jamais un vrai secret dans
`package.json`, un fichier Markdown ou une capture d’écran.

## 3. Démarrage et contrôle

```powershell
npm run init-db
npm start
```

Connecte-toi à ProcureFlow puis actualise. Les commandes viennent alors de
S/4HANA ; les décisions d’approbation restent dans SQLite et sont rattachées au
champ métier `purchaseOrderNumber`. Pour revenir aux données pédagogiques,
remets `S4_MODE=local`.

L’application lit au maximum 100 commandes par défaut. Modifie
`S4_MAX_ORDERS` si nécessaire. La récupération du libellé complet d’un
fournisseur demanderait une seconde API Business Partner ; avec cette seule
API, ProcureFlow affiche le nom du contact fournisseur quand il existe, sinon
le code fournisseur SAP.

