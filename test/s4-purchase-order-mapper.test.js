'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapPurchaseOrders, stableUuid } = require('../srv/lib/s4-purchase-order-mapper');

test('le mapping S/4 additionne les postes et conserve la devise', () => {
  const result = mapPurchaseOrders([{
    PurchaseOrder: '4500001234', PurchaseOrderDate: '2026-10-18',
    Supplier: '1000001', DocumentCurrency: 'MAD', CreatedByUser: 'ACHRAF'
  }], [
    { PurchaseOrder: '4500001234', NetAmount: '120.50', MaterialGroup: 'IT', PurchaseOrderItemText: 'Écran' },
    { PurchaseOrder: '4500001234', NetAmount: '79.50' }
  ]);
  assert.equal(result[0].amount, 200);
  assert.equal(result[0].currency, 'MAD');
  assert.equal(result[0].category, 'IT');
  assert.equal(result[0].sourceSystem, 'S4HANA');
});

test('un numéro SAP produit toujours le même UUID CAP', () => {
  assert.equal(stableUuid('S4HANA:4500001234'), stableUuid('S4HANA:4500001234'));
  assert.match(stableUuid('S4HANA:4500001234'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
