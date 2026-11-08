# ProcureFlow — documentation complète du projet de A à Z

## 1. Présentation du projet

ProcureFlow est une application pédagogique de gestion et de validation des
commandes d'achat. Elle a été construite avec des technologies utilisées dans
l'écosystème SAP :

- **SAP Cloud Application Programming Model (CAP)** pour le backend ;
- **CDS** pour décrire les données et les services ;
- **OData V4** pour exposer et consommer les données ;
- **SAPUI5** pour l'interface utilisateur ;
- **SQLite** pour le stockage local ;
- l'API officielle **SAP S/4HANA Purchase Order** comme contrat externe ;
- le runner de tests natif de Node.js pour les tests automatisés.

L'application permet de consulter des commandes d'achat, rechercher et filtrer
les commandes, consulter leurs détails, les approuver ou les rejeter, puis
administrer les décisions selon le rôle de l'utilisateur.

Le projet fonctionne de deux manières :

1. **Mode local** : commandes pédagogiques stockées dans SQLite ;
2. **Mode S/4 simulé** : commandes lues depuis une API externe locale qui
   reproduit le contrat de l'API SAP S/4HANA.

Une future connexion à un véritable tenant S/4HANA est déjà préparée.

---

## 2. Objectifs pédagogiques

Ce projet permet de comprendre :

- la séparation frontend, backend et base de données ;
- la modélisation d'entités et de relations avec CDS ;
- la génération automatique d'une API OData avec CAP ;
- les opérations CRUD ;
- l'authentification et les autorisations par rôles ;
- les règles métier côté serveur ;
- la consommation d'une API SAP distante ;
- l'adaptation entre un modèle SAP complexe et un modèle d'interface simple ;
- le stockage local de données liées à des objets distants ;
- les tests unitaires et les tests d'intégration ;
- la protection des mots de passe et autres secrets.

---

## 3. Architecture générale

```text
┌─────────────────────────────────────────────────────────────┐
│                    Navigateur utilisateur                   │
│                       SAPUI5 / Fiori                         │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP + JSON + OData V4
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend SAP CAP                           │
│                                                             │
│  ProcurementService                                        │
│  ├── authentification                                      │
│  ├── autorisations                                         │
│  ├── règles métier                                         │
│  ├── adaptation des données S/4                            │
│  └── API /procurement                                      │
└──────────────────┬───────────────────────┬──────────────────┘
                   │                       │
                   ▼                       ▼
        ┌──────────────────┐    ┌──────────────────────────┐
        │ SQLite           │    │ API Purchase Order       │
        │ commandes locales│    │ simulée ou vraie         │
        │ et décisions     │    │ SAP S/4HANA OData V4     │
        └──────────────────┘    └──────────────────────────┘
```

En mode distant, les commandes restent dans S/4HANA. ProcureFlow ne copie pas
ces commandes dans SQLite : seules les décisions propres à l'application sont
enregistrées localement et reliées au numéro de commande SAP.

---

## 4. Organisation des fichiers

```text
project/
├── app/                              Interface SAPUI5
│   ├── assets/                       Logo ProcureFlow
│   ├── controller/App.controller.js  Logique de l'interface
│   ├── view/App.view.xml             Structure visuelle
│   ├── Component.js                  Composant UI5
│   ├── manifest.json                 Configuration UI5
│   ├── index.html                    Page de démarrage
│   └── styles.css                    Design personnalisé
├── db/
│   ├── schema.cds                    Modèle métier
│   └── data/                         Données pédagogiques CSV
├── imports/
│   └── CE_PURCHASEORDER_0001.edmx    Contrat officiel SAP téléchargé
├── mock/s4/                          Données du simulateur S/4
│   ├── purchase-orders.json
│   └── purchase-order-items.json
├── scripts/
│   ├── migrate-sample-data.js        Migration SQLite
│   ├── s4-mock-server.js             API SAP simulée
│   └── start-with-s4-mock.js         Démarrage des deux serveurs
├── srv/
│   ├── external/                     Modèle externe généré depuis l'EDMX
│   ├── lib/review-validation.js      Règles de validation
│   ├── lib/s4-purchase-order-mapper.js Adaptateur S/4
│   ├── procurement-service.cds       Contrat de l'API ProcureFlow
│   └── procurement-service.js        Implémentation du service
├── test/                             Tests automatiques
├── .env.example                      Exemple de configuration S/4
├── .gitignore                        Fichiers privés ou générés ignorés
├── package.json                      Dépendances et scripts npm
├── COMMENT_UTILISER.md               Guide d'utilisation rapide
└── GUIDE_COMPLET.md                  Explications complémentaires
```

---

## 5. Installation technique

### 5.1 Prérequis

- Node.js 20 ou supérieur ;
- npm ;
- un navigateur moderne ;
- Visual Studio Code recommandé ;
- aucune licence SAP nécessaire pour le mode local ou simulé.

Vérification :

```powershell
node --version
npm --version
```

### 5.2 Installation des dépendances

Depuis le dossier du projet :

```powershell
npm install
```

Les dépendances principales sont :

- `@sap/cds` : moteur CAP ;
- `@cap-js/sqlite` : adaptateur SQLite ;
- `express` : serveur HTTP utilisé notamment par le simulateur ;
- SAP Cloud SDK : connexion aux services externes ;
- `@sap/cds-dk` : outils de développement CAP ;
- `@cap-js/cds-test` : outils de test CAP.

---

## 6. Modèle métier CDS

Le modèle se trouve dans `db/schema.cds` et utilise le namespace
`procurement`.

### 6.1 Entité PurchaseOrders

Cette entité contient notamment :

- `ID` : UUID technique généré par CAP ;
- `orderNumber` : numéro métier de la commande ;
- `supplier` : fournisseur ;
- `orderDate` : date de commande ;
- `amount` et `currency` : montant et devise ;
- `category` : catégorie d'achat ;
- `buyer` : acheteur ;
- `description` : description du besoin ;
- `requestingDepartment` : département demandeur ;
- `costCenter` : centre de coûts ;
- `priority` : basse, normale, haute ou critique ;
- `requestedBy` : demandeur ;
- `requiredDeliveryDate` : date de livraison souhaitée ;
- `businessJustification` : justification métier.

Elle contient une composition vers les décisions :

```cds
reviews : Composition of many Reviews
  on reviews.purchaseOrder = $self;
```

Une composition signifie qu'une décision appartient fonctionnellement à une
commande.

### 6.2 Entité Reviews

Cette entité contient :

- l'association locale `purchaseOrder` ;
- `purchaseOrderNumber`, utilisable avec une commande S/4 distante ;
- le statut `pending`, `approved` ou `rejected` ;
- le commentaire ;
- le responsable de la décision ;
- la date et l'heure de la décision ;
- les champs d'audit CAP `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy`.

L'association locale est facultative, car une commande distante n'existe pas
dans la table locale `PurchaseOrders`. Le numéro SAP est alors la référence
métier durable.

---

## 7. Stockage des données

### 7.1 SQLite

Le fichier `db.sqlite` contient les données persistantes locales. CAP crée les
tables à partir du modèle CDS.

Initialisation :

```powershell
npm run init-db
```

Cette commande :

1. déploie le modèle CDS dans SQLite ;
2. charge les données CSV initiales ;
3. exécute le script de migration ;
4. complète les nouvelles colonnes sans demander une manipulation SQL manuelle.

### 7.2 Données pédagogiques

Les commandes initiales se trouvent dans :

```text
db/data/procurement-PurchaseOrders.csv
```

Les décisions initiales se trouvent dans :

```text
db/data/procurement-Reviews.csv
```

Les UUID sont fixes pour que les tests et les relations restent reproductibles.

### 7.3 Données en mode S/4

En mode distant :

- les commandes sont lues depuis l'API S/4 ;
- les postes sont lus depuis `PurchaseOrderItem` ;
- le montant est calculé en additionnant `NetAmount` ;
- les décisions restent dans SQLite ;
- `purchaseOrderNumber` relie la décision à la commande distante.

---

## 8. Service OData ProcureFlow

Le contrat du service est défini dans `srv/procurement-service.cds`.

Son chemin est :

```text
/procurement
```

Principales routes :

```http
GET  /procurement/PurchaseOrders
GET  /procurement/Reviews
POST /procurement/Reviews
PATCH /procurement/Reviews(ID)
DELETE /procurement/Reviews(ID)
GET  /procurement/me()
```

Exemple de filtre OData :

```http
GET /procurement/PurchaseOrders?$filter=currency eq 'MAD'
```

Exemple de tri :

```http
GET /procurement/PurchaseOrders?$orderby=orderDate desc
```

Exemple de décision :

```json
{
  "purchaseOrder_ID": "22222222-2222-2222-2222-222222222222",
  "purchaseOrderNumber": "4500000002",
  "status": "approved",
  "comment": "Budget vérifié et besoin confirmé."
}
```

Le serveur ne fait pas confiance au nom envoyé par le navigateur : il remplace
le responsable par l'identité de l'utilisateur authentifié.

---

## 9. Authentification et rôles

Le projet utilise l'authentification Basic de CAP en développement.

Comptes pédagogiques :

| Utilisateur | Mot de passe | Capacités |
|---|---|---|
| `viewer` | `viewer123` | consultation |
| `approver` | `approver123` | responsable de département |
| `finance` | `finance123` | contrôle financier |
| `director` | `director123` | direction des achats |
| `admin` | `admin123` | consultation, décision, modification et suppression |

Les autorisations sont déclarées avec `@requires` et `@restrict` dans le
service CDS :

- une personne non connectée reçoit HTTP 401 ;
- `Viewer` peut lire ;
- `Approver` peut créer une décision ;
- `Admin` peut aussi modifier et supprimer une décision.

Ces comptes ne sont adaptés qu'au développement. En production, ils devront
être remplacés par XSUAA ou SAP Identity Authentication Service.

---

## 10. Règles métier

Les règles sont exécutées côté serveur afin qu'elles s'appliquent même si une
personne appelle directement l'API sans passer par l'interface.

Règles réalisées :

1. une commande inexistante ne peut pas recevoir de décision ;
2. une commande ne peut avoir qu'une décision ;
3. un rejet exige un commentaire ;
4. une approbation de 20 000 ou plus exige une justification ;
5. une commande critique exige une justification pour être approuvée ;
6. l'identité du responsable est imposée par le serveur ;
7. la date de décision est créée par le serveur.

La validation réutilisable se trouve dans
`srv/lib/review-validation.js`. Le handler CAP dans
`srv/procurement-service.js` charge la commande, appelle la validation, puis
autorise ou refuse l'écriture.

Codes HTTP importants :

- `200` : lecture ou modification réussie ;
- `201` : décision créée ;
- `204` : suppression réussie ;
- `400` : règle métier non respectée ;
- `401` : utilisateur non authentifié ;
- `403` : rôle insuffisant ;
- `404` : commande inconnue ;
- `409` : décision déjà existante ;
- `502` ou `503` : problème de connexion au service S/4.

---

## 11. Interface SAPUI5

L'interface conserve une seule application cohérente. Elle comprend :

- une page de connexion intégrée ;
- un en-tête avec le logo ProcureFlow et l'utilisateur ;
- un bandeau de présentation ;
- des indicateurs de commandes, décisions et valeur totale ;
- une recherche ;
- un filtre par statut ;
- une table des commandes ;
- une fenêtre de détail ;
- les actions approuver et rejeter ;
- une zone d'administration pour modifier ou supprimer les décisions.

Le contrôleur `App.controller.js` :

1. authentifie l'utilisateur ;
2. appelle `/procurement/me()` ;
3. charge les commandes et les décisions en parallèle ;
4. rapproche les décisions par UUID local ou numéro SAP ;
5. prépare les textes, couleurs, dates et montants ;
6. applique les filtres ;
7. envoie les décisions au backend.

Le logo fourni a été conservé dans `app/assets/` et intégré à l'identité
visuelle du projet.

---

## 12. Intégration de l'API officielle S/4HANA

### 12.1 Contrat EDMX

Le fichier officiel téléchargé depuis SAP Business Accelerator Hub est :

```text
imports/CE_PURCHASEORDER_0001.edmx
```

Il a été importé avec :

```powershell
npx cds import imports\CE_PURCHASEORDER_0001.edmx --as cds
```

CAP a généré :

```text
srv/external/CE_PURCHASEORDER_0001.cds
```

Ce modèle contient les véritables entités, propriétés, clés, types et
associations de l'API OData V4 SAP.

### 12.2 Entités utilisées

ProcureFlow utilise principalement :

- `PurchaseOrder` pour les en-têtes ;
- `PurchaseOrderItem` pour les postes.

Correspondances principales :

| Champ SAP | Champ ProcureFlow |
|---|---|
| `PurchaseOrder` | `orderNumber` |
| `PurchaseOrderDate` | `orderDate` |
| `Supplier` ou contact fournisseur | `supplier` |
| `DocumentCurrency` | `currency` |
| somme des `NetAmount` | `amount` |
| `MaterialGroup` | `category` |
| `CreatedByUser` | `buyer` |
| `PurchaseOrderItemText` | `description` |
| `PurchasingOrganization` | `requestingDepartment` |
| `CompanyCode` | `costCenter` |

### 12.3 Adaptateur

Le fichier `s4-purchase-order-mapper.js` transforme les objets SAP complexes
en objets simples compris par l'interface.

Il génère également un UUID déterministe à partir du numéro SAP. La même
commande produit donc toujours le même UUID pendant les lectures, sans être
enregistrée localement.

### 12.4 Limite sur le fournisseur

L'API Purchase Order fournit toujours le code fournisseur, mais pas forcément
sa raison sociale complète. ProcureFlow affiche le nom du contact fournisseur
s'il existe, sinon son code. Une future intégration de l'API Business Partner
permettrait d'obtenir systématiquement le nom complet.

---

## 13. Simulateur S/4HANA gratuit

L'API SAP indique **No Sandbox**. Une clé du Business Accelerator Hub ne donne
donc pas accès à des commandes de démonstration. Pour permettre un projet
gratuit, un simulateur a été ajouté.

### 13.1 Fonctionnement

`scripts/s4-mock-server.js` démarre un serveur Express qui expose :

```text
GET /odata4/purchase-order/PurchaseOrder
GET /odata4/purchase-order/PurchaseOrderItem
GET /health
```

Il comprend les options utilisées par CAP :

- `$select` ;
- `$filter` sur le numéro de commande ;
- `$top`.

Les données sont dans les deux fichiers JSON du dossier `mock/s4/`.

### 13.2 Démarrage complet

```powershell
npm run start:s4-mock
```

Cette commande démarre :

- le simulateur sur `http://localhost:4005` ;
- ProcureFlow sur `http://localhost:4004` ;
- `S4_MODE=remote` automatiquement ;
- l'URL distante locale automatiquement.

Arrêt :

```text
Ctrl+C
```

Le parcours a été vérifié de bout en bout. Les trois commandes simulées sont
lues via le connecteur distant et portent `sourceSystem = S4HANA`.

---

## 14. Modes d'exécution

### 14.1 Mode local simple

```powershell
npm start
```

Ou, avec rechargement automatique :

```powershell
npm run dev
```

Les commandes proviennent de SQLite.

### 14.2 Mode S/4 simulé

```powershell
npm run start:s4-mock
```

Les commandes proviennent de l'API simulée ; les décisions restent dans
SQLite.

### 14.3 Mode S/4 réel

Créer un fichier `.env` à partir de `.env.example` :

```powershell
Copy-Item .env.example .env
```

Puis configurer :

```env
S4_MODE=remote
S4_API_URL=https://votre-systeme/.../purchaseorder/0001
S4_USERNAME=utilisateur-technique
S4_PASSWORD=mot-de-passe-technique
S4_MAX_ORDERS=100
```

Enfin :

```powershell
npm start
```

Le vrai système doit posséder un arrangement de communication correspondant
au scénario `SAP_COM_0053`. Le fichier `.env` est ignoré par Git afin d'éviter
la publication des secrets.

---

## 15. Tests automatisés

Lancement complet :

```powershell
npm test
```

Compilation et tests :

```powershell
npm run check
```

Commandes spécialisées :

```powershell
npm run test:unit
npm run test:integration
```

Les tests couvrent notamment :

- le refus d'un utilisateur anonyme ;
- les droits de `viewer`, `approver` et `admin` ;
- l'identité imposée par le serveur ;
- la création, modification et suppression des décisions ;
- le rejet sans commentaire ;
- l'approbation sensible sans justification ;
- la détection d'une décision en double ;
- une commande inexistante ;
- le calcul des montants des postes S/4 ;
- la stabilité de l'UUID généré pour une commande SAP.

État validé au moment de cette documentation : **26 tests réussis**.

---

## 16. Scénario fonctionnel de démonstration

1. Exécuter `npm run start:s4-mock`.
2. Ouvrir `http://localhost:4004`.
3. Se connecter avec `viewer` et vérifier que les actions de décision ne sont
   pas disponibles.
4. Se reconnecter avec `approver`.
5. Ouvrir la commande `4500001002` de 28 750 MAD.
6. Essayer de l'approuver sans commentaire : le serveur doit refuser.
7. Ajouter une justification et enregistrer la décision.
8. Actualiser : la décision reste enregistrée dans SQLite.
9. Se connecter avec `admin`.
10. Modifier la décision, puis éventuellement la supprimer.

Ce scénario démontre simultanément l'API externe, le mapping, la sécurité, les
règles métier, le stockage et l'interface.

---

## 17. Sécurité appliquée

- les autorisations sont contrôlées côté serveur ;
- le responsable d'une décision ne peut pas être falsifié par le client ;
- les secrets réels doivent rester dans `.env` ;
- `.env` et `.cdsrc-private.json` sont ignorés par Git ;
- aucune clé SAP n'est écrite dans le code ;
- les entrées métier sont validées avant l'écriture ;
- les rôles limitent les opérations OData.

Pour une production réelle, il faudra ajouter XSUAA/IAS, SAP Destination
Service, HTTPS géré par la plateforme et un gestionnaire de secrets.

---

## 18. Limites actuelles

- le simulateur ne reproduit que les opérations nécessaires à ProcureFlow ;
- aucune véritable connexion SAP ne peut être validée sans tenant S/4HANA ;
- SQLite convient au développement, pas à une production distribuée ;
- l'authentification Basic actuelle est pédagogique ;
- les taux de conversion des devises sont indicatifs dans le tableau de bord ;
- la pagination distante peut encore être améliorée ;
- l'API Business Partner n'est pas encore intégrée ;
- le simulateur ne permet pas de créer ou modifier une commande dans S/4.

---

## 19. Évolutions recommandées

### Priorité 1 — finition pédagogique

- ajouter un badge visible `LOCAL` ou `S/4HANA` dans l'en-tête ;
- ajouter un test automatique complet démarrant le simulateur ;
- produire des captures et un diagramme pour la soutenance ;
- documenter un scénario métier de validation interne.

### Priorité 2 — qualité professionnelle

- pagination et cache des commandes distantes ;
- temporisation et nouvelles tentatives en cas d'erreur réseau ;
- logs structurés ;
- API Business Partner pour les fournisseurs ;
- tests end-to-end de l'interface ;
- meilleure gestion des taux de change.

### Priorité 3 — déploiement SAP BTP

- remplacer SQLite par SAP HANA Cloud ou PostgreSQL ;
- remplacer Basic Auth par XSUAA ou IAS ;
- utiliser SAP Destination Service ;
- ajouter la configuration Cloud Foundry ou `mta.yaml` ;
- stocker les secrets dans les services de la plateforme ;
- connecter un tenant S/4HANA avec `SAP_COM_0053`.

---

## 20. Résumé des commandes

| Objectif | Commande |
|---|---|
| Installer | `npm install` |
| Initialiser SQLite | `npm run init-db` |
| Démarrer en local | `npm start` |
| Développer avec rechargement | `npm run dev` |
| Démarrer l'API S/4 simulée seule | `npm run s4:mock` |
| Démarrer toute la démonstration S/4 | `npm run start:s4-mock` |
| Lancer tous les tests | `npm test` |
| Tests unitaires | `npm run test:unit` |
| Tests d'intégration | `npm run test:integration` |
| Compiler et tester | `npm run check` |

---

## 21. Ce qui a été acquis grâce au projet

À la fin de ce projet, on sait expliquer et démontrer :

- comment créer un modèle métier CAP ;
- comment CAP transforme CDS en tables et en API OData ;
- comment une interface SAPUI5 consomme cette API ;
- comment protéger les routes avec des rôles ;
- où placer les règles métier ;
- comment stocker des décisions sans dupliquer les données S/4 ;
- comment importer un EDMX SAP réel ;
- comment adapter les champs de S/4HANA ;
- comment simuler gratuitement un système externe ;
- comment automatiser les contrôles avec des tests.

ProcureFlow est donc un projet fonctionnel complet pour apprendre les principes
fondamentaux de SAP CAP, SAPUI5, OData et de l'intégration S/4HANA. Pour devenir
une application de production, il lui manque surtout une infrastructure BTP,
une identité d'entreprise et l'accès à un véritable tenant SAP.

---

## 22. Extension Source-to-Pay avancée

Le projet ne se limite plus à approuver des commandes existantes. Un second
processus couvre la naissance du besoin jusqu'à la commande :

```text
Brouillon de demande
→ soumission
→ contrôle automatique du budget
→ évaluation du fournisseur et score de risque
→ workflow dynamique à plusieurs niveaux
→ approbation complète
→ conversion en commande S/4 simulée
```

### Référentiels ajoutés

- `CostCenters` : centres de coûts et responsables ;
- `Budgets` : allocation, engagement, consommation et disponible ;
- `Suppliers` : qualité, livraison, conformité, risque et blocage ;
- `WorkflowRules` : seuils et rôles attendus.

### Documents transactionnels ajoutés

- `PurchaseRequests` : demande d'achat et état du processus ;
- `RequestItems` : articles, quantités, prix unitaires et montants ;
- `ApprovalSteps` : étapes successives, échéances et décisions ;
- `Notifications` : tâches envoyées au prochain rôle ;
- `AuditEvents` : journal immuable des actions importantes.

### Workflow dynamique

- toute demande passe par le responsable du département ;
- à partir de 10 000 MAD, le contrôle financier est ajouté ;
- à partir de 50 000 MAD ou pour un risque élevé, la direction des achats est
  ajoutée ;
- une seule étape est active à la fois ;
- un rejet arrête le processus et libère le budget engagé ;
- une approbation active automatiquement l'étape suivante.

### Contrôle budgétaire

Le disponible est calculé ainsi :

```text
disponible = alloué - engagé - consommé
```

La soumission est refusée si aucun budget n'existe ou si le montant dépasse le
disponible. La soumission augmente l'engagé. Un rejet libère cet engagement.
La conversion en commande déplace le montant de l'engagé vers le consommé.

### Risque explicable

Le moteur dans `srv/lib/procurement-process.js` additionne des facteurs
explicables : montant élevé, priorité critique, fournisseur risqué ou bloqué,
qualité faible et conformité expirée. Il produit un score sur 100, un niveau
et une explication lisible. Un fournisseur bloqué empêche la soumission.

### Interface ajoutée

Le menu **Demandes & Workflow** présente :

- les KPI de demandes, tâches, risques et budget ;
- la table des demandes et leurs statuts ;
- un formulaire de création avec une première ligne d'achat ;
- le détail du workflow ;
- les boutons soumettre, approuver, rejeter et convertir ;
- le budget disponible par centre de coûts ;
- le risque et les performances des fournisseurs ;
- la source des données locale ou S/4HANA.

### API ajoutée

```http
GET  /procurement/dashboard()
GET  /procurement/systemInfo()
GET  /procurement/PurchaseRequests?$expand=items,approvalSteps,supplier
POST /procurement/submitRequest
POST /procurement/decideApproval
POST /procurement/convertRequest
```

Le projet possède maintenant **26 tests automatisés réussis**, dont des tests
du cycle Source-to-Pay et des fonctions pures de risque et de workflow.
