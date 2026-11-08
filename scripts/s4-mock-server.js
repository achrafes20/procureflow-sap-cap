'use strict';

const express = require('express');
const path = require('node:path');
const orders = require('../mock/s4/purchase-orders.json');
const items = require('../mock/s4/purchase-order-items.json');

const app = express();
const port = Number(process.env.S4_MOCK_PORT || 4005);
const servicePath = '/odata4/purchase-order';
app.use(express.json({ limit: '1mb' }));

function selectedRows(rows, select) {
  if (!select) return rows;
  const fields = select.split(',').map(field => field.trim()).filter(Boolean);
  return rows.map(row => Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]])));
}

function requestedOrderNumbers(filter = '') {
  const values = [];
  for (const match of filter.matchAll(/'([^']+)'/g)) values.push(match[1].replaceAll("''", "'"));
  const equality = filter.match(/PurchaseOrder\s+eq\s+'([^']+)'/i);
  if (equality && !values.length) values.push(equality[1]);
  return values;
}

function collection(req, res, source, entityName) {
  const wanted = requestedOrderNumbers(String(req.query.$filter || ''));
  const externalReference = String(req.query.$filter || '').match(/CorrespncExternalReference\s+eq\s+'([^']+)'/i)?.[1];
  let result = externalReference
    ? source.filter(row => row.CorrespncExternalReference === externalReference)
    : wanted.length ? source.filter(row => wanted.includes(row.PurchaseOrder)) : [...source];
  const top = Number(req.query.$top);
  if (Number.isFinite(top) && top >= 0) result = result.slice(0, top);
  result = selectedRows(result, req.query.$select);
  res.json({ '@odata.context': `${servicePath}/$metadata#${entityName}`, value: result });
}

app.get(`${servicePath}/`, (_req, res) => res.json({
  '@odata.context': `${servicePath}/$metadata`,
  value: [
    { name: 'PurchaseOrder', kind: 'EntitySet', url: 'PurchaseOrder' },
    { name: 'PurchaseOrderItem', kind: 'EntitySet', url: 'PurchaseOrderItem' }
  ]
}));
app.get(`${servicePath}/PurchaseOrder`, (req, res) => collection(req, res, orders, 'PurchaseOrder'));
app.get(`${servicePath}/PurchaseOrderItem`, (req, res) => collection(req, res, items, 'PurchaseOrderItem'));
app.post(`${servicePath}/PurchaseOrder`, (req, res) => {
  const payload = req.body || {};
  const required = ['PurchaseOrderType', 'CompanyCode', 'PurchasingOrganization', 'PurchasingGroup', 'Supplier', 'DocumentCurrency'];
  const missing = required.filter(field => !payload[field]);
  if (missing.length) return res.status(400).json({ error: { message: `Champs obligatoires absents : ${missing.join(', ')}` } });
  const existing = orders.find(order => payload.CorrespncExternalReference && order.CorrespncExternalReference === payload.CorrespncExternalReference);
  if (existing) return res.status(200).json(existing);
  const highest = orders.reduce((max, order) => Math.max(max, Number(order.PurchaseOrder) || 0), 4700000000);
  const orderNumber = String(highest + 1).padStart(10, '0');
  const created = {
    PurchaseOrder: orderNumber,
    PurchaseOrderType: payload.PurchaseOrderType,
    CompanyCode: payload.CompanyCode,
    PurchasingOrganization: payload.PurchasingOrganization,
    PurchasingGroup: payload.PurchasingGroup,
    Supplier: payload.Supplier,
    DocumentCurrency: payload.DocumentCurrency,
    PurchaseOrderDate: payload.PurchaseOrderDate || new Date().toISOString().slice(0, 10),
    CreationDate: new Date().toISOString().slice(0, 10),
    CreatedByUser: 'MOCK_API',
    CorrespncExternalReference: payload.CorrespncExternalReference || '',
    ReleaseIsNotCompleted: false
  };
  orders.push(created);
  for (const [index, item] of (payload._PurchaseOrderItem || []).entries()) {
    items.push({
      ...item,
      PurchaseOrder: orderNumber,
      PurchaseOrderItem: String((index + 1) * 10).padStart(5, '0'),
      NetAmount: Number(item.OrderQuantity || 0) * Number(item.NetPriceAmount || 0)
    });
  }
  return res.status(201).json(created);
});
app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'S/4HANA Purchase Order mock' }));

app.use((req, res) => res.status(404).json({ error: { message: `Ressource simulée inconnue : ${req.path}` } }));

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[s4-mock] API OData V4 simulée : http://localhost:${port}${servicePath}`);
  });
}

module.exports = { app, servicePath };
