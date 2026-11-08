# Déploiement de production

Le profil `production` n'utilise ni SQLite ni Basic Auth. Il active SAP HANA,
XSUAA et la destination BTP `S4HANA_PURCHASE_ORDER`. Le fichier `mta.yaml`
déploie le service CAP, le HDI deployer, XSUAA, Destination Service et
l'Application Router.

## Prérequis

- Cloud Foundry CLI avec le plugin MultiApps ;
- droits de création de services sur SAP BTP ;
- instance SAP HANA Cloud disponible ;
- arrangement de communication S/4HANA pour l'API Purchase Order ;
- Node.js 22 et MBT pour construire l'archive MTA.

## Destination S/4HANA

Créer dans le sous-compte une destination nommée `S4HANA_PURCHASE_ORDER` :

- URL : racine du service OData Purchase Order V4 ;
- authentification : OAuth2ClientCredentials, BasicAuthentication ou méthode
  imposée par le tenant ;
- `HTML5.DynamicDestination=true` si nécessaire ;
- ne placer aucun secret dans le dépôt.

Configurer également les variables du module `procureflow-srv` :

```text
S4_MODE=remote
S4_COMPANY_CODE=<code société>
S4_PURCHASING_ORG=<organisation d'achat>
S4_PURCHASING_GROUP=<groupe d'acheteurs>
S4_PLANT=<division>
S4_ORDER_TYPE=NB
S4_DEFAULT_MATERIAL_GROUP=<groupe de marchandises>
```

## Construction et déploiement

```powershell
mbt build
cf deploy mta_archives/procureflow_1.0.0.mtar
```

Après le déploiement, attribuer les collections de rôles XSUAA correspondant à
`Viewer`, `DepartmentManager`, `FinanceController`, `PurchasingDirector` ou
`Admin`. Le navigateur s'authentifie via l'Application Router ; l'écran Basic
local est automatiquement ignoré lorsqu'une session XSUAA existe.

## Garanties métier

- les statuts et montants calculés ne sont modifiables que par les actions CAP ;
- chaque niveau vérifie le rôle XSUAA exact ;
- les engagements budgétaires sont individualisés et mis à jour par
  comparaison atomique ;
- la création S/4 utilise `requestNumber` comme référence externe afin de
  retrouver une commande après une répétition de requête ;
- les contraintes uniques sont matérialisées par des index HANA.

Avant chaque livraison, exécuter `npm ci`, `npm run check` et
`npm audit --omit=dev`.
