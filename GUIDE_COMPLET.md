# Guide complet — construire ProcureFlow avec SAP CAP et Fiori

Ce guide explique le projet de A à Z avec un vocabulaire accessible. Il ne faut pas seulement recopier les fichiers : l'objectif est de comprendre le trajet des données et la responsabilité de chaque couche.

## 1. Résultat final

ProcureFlow permet à un responsable achats de :

1. consulter les commandes d'achat ;
2. rechercher et filtrer les demandes ;
3. ouvrir le détail d'une commande ;
4. l'approuver ou la rejeter ;
5. conserver le responsable, le commentaire et la date de la décision.

Le projet fonctionne gratuitement en local. Les commandes sont simulées pour que l'application reste démontrable sans système S/4HANA payant.

## 2. Architecture générale

```text
┌─────────────────────────────────────────────┐
│ Navigateur                                  │
│ SAPUI5 + design Fiori                       │
│ Recherche, filtres, détail et décision      │
└──────────────────────┬──────────────────────┘
                       │ HTTP + JSON
                       │ OData V4
┌──────────────────────▼──────────────────────┐
│ SAP CAP / Node.js                           │
│ Service ProcurementService                 │
│ Règles : commentaire, responsable, doublon │
└──────────────────────┬──────────────────────┘
                       │ CQN / SQL
┌──────────────────────▼──────────────────────┐
│ SQLite                                      │
│ PurchaseOrders + Reviews                    │
└─────────────────────────────────────────────┘
```

Dans une future version connectée :

```text
S/4HANA ──OData──► CAP ──OData──► Fiori
                     │
                     └──► SQLite/HANA : décisions locales
```

S/4HANA reste alors la source officielle des commandes. Notre extension possède seulement les décisions qui lui appartiennent : c'est le principe **side-by-side** et **clean core**.

## 3. Les technologies

### SAP CAP

CAP signifie *Cloud Application Programming Model*. C'est le framework backend. Il lit les modèles CDS, crée les services OData et applique les gestionnaires JavaScript.

Une comparaison approximative :

```text
CAP ≈ Spring Boot + génération d'API + intégration SAP
```

### CDS

CDS signifie *Core Data Services*. Le fichier `db/schema.cds` décrit les données. Le fichier `srv/procurement-service.cds` décide lesquelles sont exposées.

### OData

OData est un protocole HTTP standardisé très utilisé par SAP. Exemples :

```http
GET /procurement/PurchaseOrders
GET /procurement/PurchaseOrders?$filter=currency eq 'MAD'
GET /procurement/PurchaseOrders?$orderby=amount desc
```

### SAPUI5 et Fiori

SAPUI5 fournit les composants d'interface : tableau, dialogue, statut, champ de recherche, bouton, etc. Fiori désigne les principes d'expérience utilisateur SAP. Cette application est une interface SAPUI5 personnalisée respectant le langage visuel Fiori Horizon.

### SQLite

SQLite stocke les données dans le fichier `db.sqlite`. Il est parfait pour apprendre et tester. Dans un déploiement d'entreprise, on peut le remplacer par SAP HANA Cloud.

## 4. Structure du dépôt

```text
project/
├── app/
│   ├── controller/App.controller.js  Logique de l'interface
│   ├── view/App.view.xml             Structure de la page
│   ├── Component.js                  Démarrage de l'application UI5
│   ├── index.html                    Point d'entrée web
│   ├── manifest.json                 Configuration UI5
│   └── styles.css                    Identité visuelle responsive
├── db/
│   ├── data/                         Données initiales CSV
│   └── schema.cds                    Modèle métier
├── srv/
│   ├── lib/review-validation.js      Règles testables
│   ├── procurement-service.cds       API publique
│   └── procurement-service.js        Logique CAP
├── test/
│   ├── requests.http                 Exemples d'appels OData
│   └── review-validation.test.js     Tests automatiques
├── .github/workflows/ci.yml          Intégration continue
├── COMMENT_UTILISER.md               Mode d'emploi
├── GUIDE_COMPLET.md                  Ce cours
└── package.json                      Dépendances et commandes
```

## 5. Initialisation du projet

Les dépendances principales déclarées dans `package.json` sont :

```json
{
  "dependencies": {
    "@cap-js/hana": "3.1.2",
    "@cap-js/sqlite": "3.1.2",
    "@sap/cds": "10.1.1",
    "express": "5.3.0"
  },
  "devDependencies": {
    "@sap/cds-dk": "10.1.0"
  }
}
```

- `@sap/cds` est le moteur CAP ;
- `@sap/cds-dk` apporte les commandes de développement ;
- `@cap-js/sqlite` connecte CAP à SQLite ;
- `express` sert l'application web.

Le toolkit CAP est local au projet. Ainsi, `npm run dev` fonctionne sans installation globale de `cds`.

## 6. Modélisation des données

Dans `db/schema.cds`, le namespace évite les collisions de noms :

```cds
namespace procurement;
```

Les aspects communs sont importés :

```cds
using { cuid, managed } from '@sap/cds/common';
```

- `cuid` ajoute un identifiant UUID nommé `ID` ;
- `managed` ajoute `createdAt`, `createdBy`, `modifiedAt` et `modifiedBy`.

Le statut utilise une énumération :

```cds
type ReviewStatus : String(20) enum {
  pending;
  approved;
  rejected;
}
```

Cela documente les valeurs autorisées : en attente, approuvée ou rejetée.

### Commandes et décisions

Une commande possède plusieurs informations métier. Sa composition `reviews` exprime le lien avec les décisions :

```cds
reviews : Composition of many Reviews
  on reviews.purchaseOrder = $self;
```

La décision contient une association inverse :

```cds
purchaseOrder : Association to PurchaseOrders not null;
```

Dans la base, CAP matérialise cette association avec la colonne `purchaseOrder_ID`.

La version 2 enrichit chaque commande avec le département demandeur, le centre de coûts, la priorité, le demandeur, la date de livraison souhaitée et la justification métier. Ces informations permettent au valideur de prendre une décision contextualisée.

## 7. Données CSV

CAP reconnaît les fichiers selon cette convention :

```text
<namespace>-<Entity>.csv
```

Ainsi :

```text
procurement-PurchaseOrders.csv
```

alimente `procurement.PurchaseOrders`. Les UUID sont fixes pour que les relations restent reproductibles.

## 8. Création du service OData

Le service est défini ainsi :

```cds
@path: '/procurement'
service ProcurementService {
  @readonly
  entity PurchaseOrders as projection on db.PurchaseOrders;

  entity Reviews as projection on db.Reviews;
}
```

Une **projection** expose une entité du domaine à travers un service. `@readonly` interdit de modifier les commandes via l'API. Les décisions restent modifiables.

CAP crée notamment :

```text
GET  /procurement/PurchaseOrders
GET  /procurement/Reviews
POST /procurement/Reviews
GET  /procurement/$metadata
```

## 9. Règles métier

Les règles pures vivent dans `srv/lib/review-validation.js`. Cette séparation rend les tests rapides et simples.

La fonction renvoie une erreur si :

- le statut est inconnu ;
- le responsable est vide ;
- une décision de rejet n'a pas de commentaire.

Dans le handler CAP :

```javascript
this.before(['CREATE', 'UPDATE'], Reviews, async (req) => {
  const error = validateReview(req.data);
  if (error) req.reject(error.code, error.message);
});
```

`before` signifie : exécuter ce code avant l'écriture générique de CAP. `req.reject(400, ...)` arrête la requête et renvoie une erreur HTTP claire.

Le handler recherche également une décision existante :

```javascript
const existing = await SELECT.one.from(Reviews).where({
  purchaseOrder_ID: req.data.purchaseOrder_ID
});
```

S'il en trouve une, il renvoie HTTP 409 Conflict. Cette règle est placée dans le backend, car une vérification uniquement visuelle pourrait être contournée par un appel direct à l'API.

## 10. Construction de l'interface

`index.html` charge SAPUI5 et le thème `sap_horizon`. Le `manifest.json` indique la vue de départ. `Component.js` crée un `JSONModel` nommé `app`.

Le modèle de l'interface contient :

```javascript
{
  orders: [],
  filteredOrders: [],
  reviews: [],
  busy: true,
  query: '',
  statusFilter: 'all',
  stats: {}
}
```

La vue XML lie les composants à ce modèle. Exemple :

```xml
<ObjectNumber number="{app>/stats/total}"/>
```

Lorsque JavaScript modifie `/stats/total`, UI5 met automatiquement l'écran à jour.

### Chargement parallèle

Le contrôleur charge les commandes et les décisions simultanément :

```javascript
const [ordersResponse, reviewsResponse] = await Promise.all([
  fetch('/procurement/PurchaseOrders'),
  fetch('/procurement/Reviews')
]);
```

Chaque commande est ensuite enrichie avec sa décision et des valeurs prêtes à afficher : date formatée, montant, libellé et couleur de statut.

### Recherche et filtre

La recherche ne modifie jamais la liste d'origine. Elle produit `filteredOrders`, qui alimente le tableau. On peut donc combiner texte et statut sans perdre de données.

### Enregistrement

Le contrôleur envoie :

```http
POST /procurement/Reviews
Content-Type: application/json

{
  "purchaseOrder_ID": "...",
  "status": "approved",
  "reviewer": "Achraf",
  "comment": "Budget vérifié."
}
```

Après succès, il recharge les données. Les compteurs et la ligne changent automatiquement.

## 11. Design et accessibilité

Le design utilise :

- le thème officiel Horizon ;
- une hiérarchie visuelle nette ;
- des statuts accompagnés de texte, pas seulement de couleurs ;
- des composants SAPUI5 accessibles au clavier ;
- un affichage responsive pour ordinateur, tablette et téléphone ;
- des messages d'erreur compréhensibles.

Le montant total transforme approximativement les EUR en MAD avec un coefficient pédagogique fixe de 10,8. Ce n'est pas un taux financier en temps réel et l'interface le présente comme une valeur indicative.

## 12. Tests

Les tests utilisent le module `node:test`, inclus dans Node.js. Exemple :

```javascript
test('un rejet sans commentaire est refusé', () => {
  const error = validateReview({
    status: 'rejected',
    reviewer: 'Amine'
  });
  assert.equal(error.code, 400);
});
```

Lance :

```powershell
npm test
```

`npm run check` effectue deux contrôles :

1. compilation complète du modèle CDS ;
2. exécution des tests unitaires et d'intégration, puis des scénarios UI Playwright ;

### Tests d'intégration HTTP

Le fichier `test/api.integration.test.js` utilise `cds.test()` conformément à l'outillage CAP. Il démarre un véritable serveur sur un port aléatoire et déploie les données CSV dans une base SQLite en mémoire.

Les scénarios vérifiés sont :

- accès anonyme refusé avec HTTP 401 ;
- lecture autorisée et écriture refusée pour `Viewer` ;
- création autorisée pour `Approver` avec identité imposée par le serveur ;
- modification et suppression refusées à `Approver` ;
- modification et suppression autorisées à `Admin` ;
- contenu de l'endpoint `me()` selon le rôle ;
- rejet sans commentaire refusé ;
- approbation critique sans justification refusée ;
- deuxième décision refusée avec HTTP 409 ;
- commande inexistante refusée avec HTTP 404.

`beforeEach(data.reset)` redéploie les données avant chaque scénario. Les tests sont donc indépendants, reproductibles et sans effet sur la base locale de développement.

Le workflow GitHub Actions répète ces contrôles à chaque push et pull request.

## 13. Persistance et cycle de vie

La commande de développement est :

```json
"dev": "cds deploy --to sqlite:db.sqlite && cds watch"
```

`cds deploy` crée les tables et charge les CSV si nécessaire. `cds watch` démarre ensuite le serveur et le redémarre lorsque le code change.

Le fichier `db.sqlite` est ignoré par Git : chaque développeur possède sa base locale.

## 14. Sécurité déjà appliquée

- `.env` et `db.sqlite` sont ignorés par Git ;
- aucune clé API n'est placée dans le code ;
- les commandes sont en lecture seule ;
- les données reçues sont validées côté serveur ;
- les erreurs utilisent des statuts HTTP appropriés ;
- `.env.example` documente les futures variables sans secret réel.

### Comptes et rôles locaux

Trois comptes Basic fictifs sont déclarés uniquement dans le profil de développement :

```text
viewer / viewer123       → Viewer
approver / approver123   → Viewer + Approver + DepartmentManager
finance / finance123     → Viewer + Approver + FinanceController
director / director123   → Viewer + Approver + PurchasingDirector
admin / admin123         → Viewer + Approver + Admin
```

Les restrictions CDS appliquées par CAP sont :

```text
PurchaseOrders READ      → Viewer, Approver ou Admin
Reviews READ             → Viewer, Approver ou Admin
Reviews CREATE           → Approver ou Admin
Reviews UPDATE et DELETE → Admin uniquement
```

L'utilisateur anonyme reçoit HTTP 401. Un lecteur qui tente d'écrire reçoit HTTP 403. Lors d'une création, le backend remplace toujours `reviewer` par `req.user.id` et renseigne `decisionAt` : le client ne peut donc pas signer une décision au nom d'une autre personne.

Les règles métier supplémentaires exigent un commentaire pour tout rejet, ainsi que pour l'approbation d'une commande critique ou d'un montant supérieur ou égal à 20 000.

### Interfaces adaptées aux rôles

L'écran de connexion local envoie l'en-tête Basic uniquement en mémoire. Aucun mot de passe n'est stocké dans `localStorage` ou `sessionStorage`. La déconnexion efface la référence en rechargeant l'application.

- `Viewer` accède au tableau et aux détails en lecture seule ;
- `Approver` obtient en plus le formulaire de décision ;
- `Admin` voit une navigation Administration avec historique, recherche, modification et suppression.

Le masquage des boutons améliore l'expérience utilisateur, mais ne constitue pas la sécurité. Les annotations CDS restent la protection réelle côté serveur.

Pour la production, l'authentification Basic locale devra être remplacée par XSUAA ou IAS. Les mêmes annotations `@requires` et `@restrict` continueront d'utiliser les rôles issus du jeton de l'utilisateur.

## 15. Connexion future à une API S/4HANA

Cette étape nécessite de choisir une API réellement disponible dans ton compte ou dans une sandbox SAP.

### Étape A — récupérer l'EDMX

Dans SAP Business Accelerator Hub, recherche l'API des commandes d'achat compatible avec ton système. Télécharge sa spécification OData EDMX.

### Étape B — importer le contrat

```powershell
npx cds import C:\chemin\API_PURCHASEORDER_PROCESS_SRV.edmx --as cds
```

CAP créera un modèle externe sous `srv/external` et complétera la configuration du service distant.

### Étape C — configurer la connexion

En local, les paramètres doivent venir de variables d'environnement ou d'une configuration privée. Sur BTP, utilise une **Destination**. Ne place jamais la clé dans Git.

### Étape D — exposer une projection

Le principe sera similaire à :

```cds
using { API_PURCHASEORDER_PROCESS_SRV as s4 }
  from './external/API_PURCHASEORDER_PROCESS_SRV';

@readonly entity PurchaseOrders as projection on s4.A_PurchaseOrder;
```

Les noms exacts dépendent obligatoirement de l'EDMX téléchargé.

### Étape E — déléguer les lectures

```javascript
const s4 = await cds.connect.to('API_PURCHASEORDER_PROCESS_SRV');

this.on('READ', 'PurchaseOrders', req => {
  return s4.run(req.query);
});
```

Les décisions restent dans SQLite ou HANA. Il ne faut pas supposer qu'une jointure SQL entre le service distant et la base locale fonctionnera automatiquement. L'interface associe donc les deux ensembles par le numéro ou l'identifiant de commande.

## 16. Déploiement SAP BTP

Le projet local est terminé et fonctionnel sans BTP. Pour un déploiement réel, les grandes étapes sont :

1. créer un compte BTP Trial ou utiliser un compte d'entreprise ;
2. activer Cloud Foundry ;
3. ajouter les configurations `hana`, `xsuaa` et éventuellement `mta` ;
4. remplacer SQLite par SAP HANA Cloud ;
5. créer la Destination S/4HANA ;
6. construire puis déployer l'archive MTA ;
7. attribuer les rôles aux utilisateurs.

Ces opérations dépendent des services et quotas disponibles dans le compte. Elles ne sont volontairement pas activées dans le dépôt local afin que `npm run dev` reste gratuit et immédiatement fonctionnel.

## 17. Ce qu'il faut savoir expliquer en entretien

### Pourquoi CAP ?

Parce qu'il accélère la création de modèles, services OData, validations et intégrations dans l'écosystème SAP.

### Pourquoi ne pas stocker les commandes S/4HANA dans notre base ?

S/4HANA doit rester la source unique de vérité. Copier les commandes crée des risques de désynchronisation.

### Pourquoi valider dans le backend ?

Une règle placée uniquement dans l'interface peut être contournée. Le backend garantit la règle pour tous les consommateurs de l'API.

### Qu'est-ce que clean core ?

On évite de modifier le cœur de S/4HANA. On construit une extension séparée, connectée avec des API stables.

### Quelle différence entre CDS et OData ?

CDS décrit le modèle et les services. OData est le protocole HTTP généré et consommé par l'interface.

## 18. Améliorations possibles

Après avoir maîtrisé cette version :

- ajouter l'authentification et les rôles ;
- autoriser une nouvelle décision via un workflow contrôlé ;
- ajouter des pièces jointes ;
- intégrer un taux de change officiel ;
- produire des graphiques par fournisseur et catégorie ;
- envoyer une notification au demandeur ;
- migrer la base vers HANA Cloud ;
- connecter une véritable API S/4HANA ;
- ajouter des tests d'intégration complets de l'API.

## 19. Checklist de compréhension

Avant de déclarer le projet maîtrisé, vérifie que tu sais :

- expliquer chaque dossier ;
- créer une entité CDS ;
- expliquer une association ;
- retrouver une entité dans `$metadata` ;
- appeler l'API avec un filtre OData ;
- ajouter une règle `before` dans CAP ;
- expliquer HTTP 400 et HTTP 409 ;
- suivre une donnée depuis SQLite jusqu'au tableau UI5 ;
- écrire un test métier ;
- expliquer comment S/4HANA remplacera les commandes simulées.

Si tu peux faire tout cela sans lire le code mot à mot, le projet t'a réellement appris les fondations du développement SAP moderne.
# Extension réalisée : connexion S/4HANA Purchase Order OData V4

## Simulateur gratuit du service externe

`scripts/s4-mock-server.js` expose deux collections OData compatibles avec les
lectures du connecteur : `PurchaseOrder` et `PurchaseOrderItem`. Les données
sont séparées dans `mock/s4/purchase-orders.json` et
`mock/s4/purchase-order-items.json`, comme dans S/4HANA.

Le script `scripts/start-with-s4-mock.js` orchestre les deux processus et
injecte automatiquement `S4_MODE=remote` et l’URL locale du service. Cette
solution permet de tester la frontière d’intégration complète gratuitement ;
seuls l’hébergement SAP et son authentification technique sont simulés.

Le contrat EDMX officiel est conservé dans `imports/` et sa version CDS générée
dans `srv/external/`. CAP connaît ainsi les vrais noms et types SAP :
`PurchaseOrder`, `PurchaseOrderItem`, `NetAmount`, `DocumentCurrency`, etc.

Le handler `srv/procurement-service.js` applique un pattern d’adaptation :

1. lecture des en-têtes `PurchaseOrder` ;
2. lecture des postes `PurchaseOrderItem` ;
3. somme de `NetAmount` par commande ;
4. transformation vers le modèle stable de ProcureFlow ;
5. création d’un UUID déterministe à partir du numéro SAP ;
6. conservation locale des décisions, sans recopier les commandes SAP.

Cette séparation permet à l’interface Fiori de fonctionner de la même manière
avec SQLite ou S/4HANA. Le mode est choisi par `S4_MODE=local|remote`. Les
secrets sont fournis uniquement par les variables d’environnement décrites
dans `.env.example`.

