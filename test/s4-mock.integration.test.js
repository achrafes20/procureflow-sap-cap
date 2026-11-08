'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { app, servicePath } = require('../scripts/s4-mock-server');

test('le mock S/4 crée une commande profonde et rend l’appel idempotent', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}${servicePath}`;
  const payload = {
    PurchaseOrderType: 'NB', CompanyCode: '1710', PurchasingOrganization: '1710',
    PurchasingGroup: '001', Supplier: '10000001', DocumentCurrency: 'MAD',
    CorrespncExternalReference: 'DA-S4-00001',
    _PurchaseOrderItem: [{ Plant: '1710', PurchaseOrderItemText: 'Article', OrderQuantity: 2, NetPriceAmount: 50 }]
  };
  const first = await fetch(`${base}/PurchaseOrder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.match(created.PurchaseOrder, /^\d{10}$/);

  const second = await fetch(`${base}/PurchaseOrder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal((await second.json()).PurchaseOrder, created.PurchaseOrder);

  const items = await fetch(`${base}/PurchaseOrderItem?$filter=PurchaseOrder%20eq%20'${created.PurchaseOrder}'`).then(response => response.json());
  assert.equal(items.value.length, 1);
  assert.equal(items.value[0].NetAmount, 100);
});

test('le connecteur CAP OData lit le mode S/4 simulé', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const remote = await cds.connect.to('CE_PURCHASEORDER_0001', {
    kind: 'odata', model: 'srv/external/CE_PURCHASEORDER_0001',
    credentials: { url: `http://127.0.0.1:${server.address().port}${servicePath}` }
  });
  const rows = await remote.run(cds.ql.SELECT.from(remote.entities.PurchaseOrder).columns('PurchaseOrder').limit(2));
  assert.equal(rows.length, 2);
  assert.match(rows[0].PurchaseOrder, /^\d{10}$/);

  const created = await remote.run(cds.ql.INSERT.into(remote.entities.PurchaseOrder).entries({
    PurchaseOrderType: 'NB', CompanyCode: '1710', PurchasingOrganization: '1710',
    PurchasingGroup: '001', Supplier: '10000001', DocumentCurrency: 'MAD',
    CorrespncExternalReference: 'DA-CAP-S4001',
    _PurchaseOrderItem: [{ Plant: '1710', PurchaseOrderItemText: 'Créé via CAP', OrderQuantity: 1, PurchaseOrderQuantityUnit: 'EA', NetPriceAmount: 75, NetPriceQuantity: 1, DocumentCurrency: 'MAD' }]
  }));
  assert.match(created.PurchaseOrder, /^\d{10}$/);
});
