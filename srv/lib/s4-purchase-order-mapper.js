'use strict';

const crypto = require('node:crypto');

function stableUuid(value) {
  const hex = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function mapPurchaseOrders(headers = [], items = []) {
  const itemsByOrder = new Map();
  for (const item of items) {
    const bucket = itemsByOrder.get(item.PurchaseOrder) || [];
    bucket.push(item);
    itemsByOrder.set(item.PurchaseOrder, bucket);
  }
  return headers.map(header => {
    const orderItems = itemsByOrder.get(header.PurchaseOrder) || [];
    const amount = orderItems.reduce((sum, item) => sum + Number(item.NetAmount || 0), 0);
    const firstItem = orderItems[0] || {};
    return {
      ID: stableUuid(`S4HANA:${header.PurchaseOrder}`),
      orderNumber: header.PurchaseOrder,
      supplier: header.SupplierRespSalesPersonName || header.Supplier || 'Fournisseur SAP',
      orderDate: header.PurchaseOrderDate || header.CreationDate,
      amount,
      currency: header.DocumentCurrency || firstItem.DocumentCurrency || '',
      category: firstItem.MaterialGroup || header.PurchaseOrderType || 'Achat',
      buyer: header.CreatedByUser || header.PurchasingGroup || 'Utilisateur SAP',
      description: firstItem.PurchaseOrderItemText || `Commande SAP ${header.PurchaseOrder}`,
      requestingDepartment: header.PurchasingOrganization || '',
      costCenter: header.CompanyCode || '',
      priority: header.ReleaseIsNotCompleted || amount >= 50000 ? 'critical' : amount >= 20000 ? 'high' : 'medium',
      requestedBy: firstItem.RequisitionerName || header.CreatedByUser || '',
      requiredDeliveryDate: null,
      businessJustification: `Importée de SAP S/4HANA (${orderItems.length} poste(s)).`,
      sourceSystem: 'S4HANA'
    };
  });
}

module.exports = { mapPurchaseOrders, stableUuid };
