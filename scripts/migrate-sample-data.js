'use strict';

// Cette petite migration préserve les décisions déjà saisies tout en
// enrichissant les cinq commandes pédagogiques créées avant la version 2.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, '..', 'db.sqlite'));
const updates = [
  ['Commercial', 'CC-COM-100', 'high', 'Omar Tazi', '2026-11-15', 'Équiper les nouveaux commerciaux pour la campagne annuelle', '4500000001'],
  ['IT', 'CC-IT-210', 'medium', 'Imane Alaoui', '2026-11-01', 'Renouveler les licences arrivant à expiration', '4500000002'],
  ['Ressources humaines', 'CC-RH-120', 'low', 'Salma Idrissi', '2026-12-01', 'Aménager les postes des nouveaux collaborateurs', '4500000003'],
  ['Opérations', 'CC-OPS-310', 'critical', 'Karim Mansouri', '2026-12-20', 'Réduire la consommation énergétique du site pilote', '4500000004'],
  ['IT', 'CC-IT-220', 'high', 'Nadia Benali', '2026-11-30', 'Sécuriser la future migration des applications métier', '4500000005']
];

const statement = db.prepare(`
  UPDATE procurement_PurchaseOrders
  SET requestingDepartment = ?, costCenter = ?, priority = ?, requestedBy = ?,
      requiredDeliveryDate = ?, businessJustification = ?
  WHERE orderNumber = ?
`);

for (const values of updates) statement.run(...values);
db.exec(`
  UPDATE procurement_Reviews
  SET purchaseOrderNumber = (
    SELECT orderNumber FROM procurement_PurchaseOrders
    WHERE procurement_PurchaseOrders.ID = procurement_Reviews.purchaseOrder_ID
  )
  WHERE purchaseOrderNumber IS NULL OR purchaseOrderNumber = ''
`);
db.close();
console.log('Données pédagogiques enrichies sans supprimer les décisions existantes.');
