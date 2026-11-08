# ProcureFlow — SAP CAP + Fiori

ProcureFlow est une application pédagogique de validation des commandes d'achat. Elle combine un backend **SAP CAP**, une API **OData V4**, une base **SQLite**, une authentification par rôles et une interface **SAPUI5 au design Fiori**.

## Démarrage rapide

```powershell
npm install
npm run dev
```

Ouvrir ensuite <http://localhost:4004/index.html>.

## Comptes de test

Après avoir ouvert l'application, utiliser l'un des comptes suivants dans le formulaire de connexion :

| Utilisateur | Mot de passe | Profil testé | Autorisations principales |
| --- | --- | --- | --- |
| `viewer` | `viewer123` | Lecture | Consulter les demandes autorisées |
| `approver` | `approver123` | Responsable département | Effectuer l'approbation du responsable |
| `finance` | `finance123` | Contrôle financier | Effectuer l'approbation financière |
| `director` | `director123` | Direction achats | Effectuer l'approbation finale |
| `admin` | `admin123` | Administration | Accéder à tous les rôles et fonctions de démonstration |

Ces identifiants sont disponibles uniquement avec les profils **développement** et **test**. Ils ne doivent jamais être utilisés en production, où l'authentification est assurée par SAP XSUAA.

## Documentation

- [Guide complet du projet](GUIDE_COMPLET.md) : architecture, code, concepts SAP, tests et évolution S/4HANA.
- [Comment utiliser l'application](COMMENT_UTILISER.md) : installation et utilisation quotidienne.
- [Déploiement de production](PRODUCTION.md) : SAP HANA Cloud, XSUAA, approuter et destination S/4HANA.

## Commandes utiles

```powershell
npm run dev       # initialise la base et démarre en mode développement
npm run start:local # initialise SQLite puis démarre sans watch
npm test          # lance les tests métier
npm run test:unit # lance seulement les tests unitaires
npm run test:integration # lance les tests HTTP avec une base isolée
npm run check     # compile CDS et lance les tests
npm run init-db   # crée ou met à jour la base SQLite
```

> L'application fonctionne immédiatement avec des données pédagogiques. Aucun abonnement SAP payant n'est nécessaire.
# Démonstration S/4HANA gratuite

## Cycle Source-to-Pay complet

ProcureFlow gère désormais deux flux complémentaires :

- le contrôle des commandes reçues depuis S/4HANA ;
- la création d'une demande d'achat jusqu'à sa conversion en commande.

Le menu **Demandes & Workflow** donne accès aux budgets, fournisseurs, risques
et circuits d'approbation multi-niveaux. Une demande passe par le contrôle du
budget, le scoring du risque, une à trois validations, puis la création d'un
numéro de commande simulé.

Pour démarrer simultanément l’API Purchase Order simulée et ProcureFlow :

```powershell
npm run start:s4-mock
```

Puis ouvrir `http://localhost:4004`. Ce mode utilise le véritable contrat OData
V4 importé depuis l’EDMX SAP, avec des données locales réalistes placées dans
`mock/s4/`. Voir `COMMENT_UTILISER.md` pour les détails.

