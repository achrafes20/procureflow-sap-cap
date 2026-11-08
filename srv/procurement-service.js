'use strict';

const cds = require('@sap/cds');
const crypto = require('node:crypto');
const { validateReview } = require('./lib/review-validation');
const { mapPurchaseOrders } = require('./lib/s4-purchase-order-mapper');
const { calculateRisk, buildApprovalSteps } = require('./lib/procurement-process');

const isRemoteMode = () => String(process.env.S4_MODE || 'local').toLowerCase() === 'remote';
const APPROVAL_ROLES = ['DepartmentManager', 'FinanceController', 'PurchasingDirector'];
const PROTECTED_REQUEST_FIELDS = new Set([
  'requester', 'status', 'totalAmount', 'riskScore', 'riskLevel', 'riskExplanation',
  'currentApprovalLevel', 'submittedAt', 'convertedOrderNumber'
]);

module.exports = cds.service.impl(function () {
  const { PurchaseOrders, Reviews } = this.entities;
  let s4;

  async function remoteService() {
    if (s4) return s4;
    const config = cds.env.requires.CE_PURCHASEORDER_0001;
    config.credentials = Object.assign({}, config.credentials, {
      url: process.env.S4_API_URL || config.credentials?.url,
      username: process.env.S4_USERNAME || config.credentials?.username,
      password: process.env.S4_PASSWORD || config.credentials?.password
    });
    if (!config.credentials.url) {
      throw Object.assign(new Error('S4_API_URL est absent. Consultez COMMENT_UTILISER.md.'), { statusCode: 503 });
    }
    s4 = await cds.connect.to('CE_PURCHASEORDER_0001');
    return s4;
  }

  async function loadRemoteOrders(orderNumber) {
    const remote = await remoteService();
    const Header = remote.entities.PurchaseOrder;
    const Item = remote.entities.PurchaseOrderItem;
    let headerQuery = SELECT.from(Header).columns(
      'PurchaseOrder', 'PurchaseOrderType', 'CreatedByUser', 'CreationDate',
      'PurchaseOrderDate', 'ReleaseIsNotCompleted', 'CompanyCode',
      'PurchasingOrganization', 'PurchasingGroup', 'Supplier',
      'SupplierRespSalesPersonName', 'DocumentCurrency'
    );
    if (orderNumber) headerQuery = headerQuery.where({ PurchaseOrder: orderNumber });
    else headerQuery = headerQuery.limit(Number(process.env.S4_MAX_ORDERS || 100));

    const headers = await remote.run(headerQuery);
    const numbers = headers.map(row => row.PurchaseOrder);
    if (!numbers.length) return [];
    const items = await remote.run(SELECT.from(Item).columns(
      'PurchaseOrder', 'PurchaseOrderItem', 'DocumentCurrency', 'MaterialGroup',
      'PurchaseOrderItemText', 'RequisitionerName', 'NetAmount'
    ).where({ PurchaseOrder: { in: numbers } }));
    return mapPurchaseOrders(headers, items);
  }

  async function createRemotePurchaseOrder(request, items, supplier) {
    const remote = await remoteService();
    const existing = await remote.run(SELECT.one.from(remote.entities.PurchaseOrder)
      .columns('PurchaseOrder')
      .where({ CorrespncExternalReference: request.requestNumber }));
    if (existing?.PurchaseOrder) return String(existing.PurchaseOrder);
    const requiredConfig = {
      CompanyCode: process.env.S4_COMPANY_CODE,
      PurchasingOrganization: process.env.S4_PURCHASING_ORG,
      PurchasingGroup: process.env.S4_PURCHASING_GROUP,
      Plant: process.env.S4_PLANT
    };
    const missing = Object.entries(requiredConfig).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      throw Object.assign(new Error(`Configuration S/4 manquante : ${missing.join(', ')}.`), { statusCode: 503 });
    }
    if (!supplier?.supplierNumber) {
      throw Object.assign(new Error('Le fournisseur ne possède pas de numéro S/4.'), { statusCode: 400 });
    }
    const payload = {
      PurchaseOrderType: process.env.S4_ORDER_TYPE || 'NB',
      CompanyCode: requiredConfig.CompanyCode,
      PurchasingOrganization: requiredConfig.PurchasingOrganization,
      PurchasingGroup: requiredConfig.PurchasingGroup,
      Supplier: supplier.supplierNumber,
      CorrespncExternalReference: request.requestNumber,
      DocumentCurrency: request.currency,
      PurchaseOrderDate: new Date().toISOString().slice(0, 10),
      _PurchaseOrderItem: items.map(item => ({
        Plant: requiredConfig.Plant,
        PurchaseOrderItemText: String(item.description || '').slice(0, 40),
        MaterialGroup: String(item.category || process.env.S4_DEFAULT_MATERIAL_GROUP || '001').slice(0, 9),
        OrderQuantity: Number(item.quantity),
        PurchaseOrderQuantityUnit: String(item.unit || 'EA').slice(0, 3),
        NetPriceAmount: Number(item.unitPrice),
        NetPriceQuantity: 1,
        DocumentCurrency: request.currency
      }))
    };
    const created = await remote.run(INSERT.into(remote.entities.PurchaseOrder).entries(payload));
    const result = Array.isArray(created) ? created[0] : created;
    const orderNumber = result?.PurchaseOrder || result?.purchaseOrder;
    if (!orderNumber) throw Object.assign(new Error('S/4HANA n’a retourné aucun numéro de commande.'), { statusCode: 502 });
    return String(orderNumber);
  }

  this.on('READ', PurchaseOrders, async (req, next) => {
    if (!isRemoteMode()) return next();
    try {
      return await loadRemoteOrders();
    } catch (error) {
      req.error(error.statusCode || 502, `Lecture S/4HANA impossible : ${error.message}`);
    }
  });

  this.on('me', req => ({
    id: req.user.id,
    canApprove: req.user.is('Admin') || APPROVAL_ROLES.some(role => req.user.is(role)),
    isAdmin: req.user.is('Admin'),
    roles: APPROVAL_ROLES.filter(role => req.user.is(role))
  }));

  this.on('systemInfo', () => ({
    mode: isRemoteMode() ? 'remote' : 'local',
    sourceLabel: isRemoteMode() ? 'SAP S/4HANA simulé ou distant' : 'Données locales SQLite',
    remote: isRemoteMode()
  }));

  const db = cds.entities('procurement');
  const ensureApprovalRole = req => {
    if (!req.user.is('Admin') && !APPROVAL_ROLES.some(role => req.user.is(role))) {
      req.reject(403, 'Rôle de validation précis requis.');
    }
  };
  const ensureStepRole = (req, step) => {
    if (!req.user.is('Admin') && !req.user.is(step.role)) {
      req.reject(403, `Cette étape exige le rôle ${step.role}.`);
    }
  };
  const audit = (tx, req, entityType, entityID, action, details) => tx.run(INSERT.into(db.AuditEvents).entries({
    ID: cds.utils.uuid(), entityType, entityID: String(entityID), action,
    actor: req.user.id, details, occurredAt: new Date().toISOString()
  }));

  async function adjustBudget(tx, budgetID, committedDelta, consumedDelta = 0) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await tx.run(SELECT.one.from(db.Budgets).where({ ID: budgetID }));
      if (!current) throw Object.assign(new Error('Budget introuvable.'), { statusCode: 409 });
      const committed = Number(current.committed || 0) + Number(committedDelta || 0);
      const consumed = Number(current.consumed || 0) + Number(consumedDelta || 0);
      if (committed < 0 || consumed < 0 || committed + consumed > Number(current.allocated)) {
        throw Object.assign(new Error('Le budget disponible est insuffisant.'), { statusCode: 409 });
      }
      const changed = await tx.run(UPDATE(db.Budgets).set({ committed, consumed }).where({
        ID: budgetID,
        committed: current.committed,
        consumed: current.consumed
      }));
      if (changed === 1) return { ...current, committed, consumed };
    }
    throw Object.assign(new Error('Le budget a été modifié simultanément. Réessayez.'), { statusCode: 409 });
  }

  async function releaseCommitment(tx, requestID, targetStatus) {
    const commitment = await tx.run(SELECT.one.from(db.BudgetCommitments).where({ request_ID: requestID, status: 'active' }));
    if (!commitment) throw Object.assign(new Error('Engagement budgétaire actif introuvable.'), { statusCode: 409 });
    const now = new Date().toISOString();
    const changed = await tx.run(UPDATE(db.BudgetCommitments).set({
      status: targetStatus,
      releasedAt: targetStatus === 'released' ? now : null,
      consumedAt: targetStatus === 'consumed' ? now : null
    }).where({ ID: commitment.ID, status: 'active' }));
    if (changed !== 1) throw Object.assign(new Error('Cet engagement a déjà été traité.'), { statusCode: 409 });
    await adjustBudget(
      tx,
      commitment.budget_ID,
      -Number(commitment.amount),
      targetStatus === 'consumed' ? Number(commitment.amount) : 0
    );
    return commitment;
  }

  this.before(['CREATE', 'UPDATE'], 'RequestItems', async req => {
    let quantity = req.data.quantity;
    let unitPrice = req.data.unitPrice;
    if (req.event === 'UPDATE' && (quantity === undefined || unitPrice === undefined)) {
      const itemID = req.params?.[0]?.ID || req.data.ID;
      const stored = itemID ? await cds.tx(req).run(SELECT.one.from(db.RequestItems).where({ ID: itemID })) : null;
      quantity ??= stored?.quantity;
      unitPrice ??= stored?.unitPrice;
    }
    if (Number(quantity) <= 0 || Number(unitPrice) < 0) req.reject(400, 'La quantité doit être positive et le prix ne peut pas être négatif.');
    if (quantity !== undefined || unitPrice !== undefined) req.data.amount = Number(quantity) * Number(unitPrice);
  });

  this.before('UPDATE', 'PurchaseRequests', async req => {
    const forbidden = Object.keys(req.data).filter(field => PROTECTED_REQUEST_FIELDS.has(field));
    if (forbidden.length) req.reject(400, `Champs gouvernés non modifiables directement : ${forbidden.join(', ')}.`);
    const requestID = req.params?.[0]?.ID || req.data.ID;
    if (!requestID) req.reject(400, 'Identifiant de demande absent.');
    const stored = await cds.tx(req).run(SELECT.one.from(db.PurchaseRequests).where({ ID: requestID }));
    if (!stored) req.reject(404, 'Demande introuvable.');
    if (stored.status !== 'draft') req.reject(409, 'Seul un brouillon peut être modifié.');
    if (!req.user.is('Admin') && stored.requester !== req.user.id) req.reject(403, 'Vous ne pouvez modifier que vos propres brouillons.');
  });

  this.before('DELETE', 'PurchaseRequests', async req => {
    const requestID = req.params?.[0]?.ID;
    const stored = requestID ? await cds.tx(req).run(SELECT.one.from(db.PurchaseRequests).where({ ID: requestID })) : null;
    if (!stored) req.reject(404, 'Demande introuvable.');
    if (stored.status !== 'draft') req.reject(409, 'Une demande engagée ne peut pas être supprimée.');
  });

  this.before('CREATE', 'PurchaseRequests', async req => {
    if (!req.data.requestNumber || !req.data.costCenterCode || !req.data.supplier_ID || !String(req.data.justification || '').trim()) {
      req.reject(400, 'Numéro, centre de coûts, fournisseur et justification sont obligatoires.');
    }
    const duplicate = await cds.tx(req).run(SELECT.one.from(db.PurchaseRequests).columns('ID').where({ requestNumber: req.data.requestNumber }));
    if (duplicate) req.reject(409, 'Ce numéro de demande existe déjà.');
    req.data.requester = req.user.id;
    req.data.fiscalYear = req.data.fiscalYear || new Date().getFullYear();
    req.data.status = 'draft';
    if (Array.isArray(req.data.items)) {
      req.data.items.forEach((item, index) => {
        if (Number(item.quantity) <= 0 || Number(item.unitPrice) < 0) req.reject(400, `Valeurs invalides sur la ligne ${index + 1}.`);
        item.position ||= index + 1;
        item.amount = Number(item.quantity || 0) * Number(item.unitPrice || 0);
      });
      req.data.totalAmount = req.data.items.reduce((sum, item) => sum + item.amount, 0);
    }
  });

  this.before('READ', 'Notifications', req => {
    if (req.user.is('Admin')) return;
    const recipients = [req.user.id, ...APPROVAL_ROLES.filter(role => req.user.is(role))];
    req.query.where({ recipient: { in: recipients } });
  });

  this.before('UPDATE', 'Notifications', async req => {
    if (req.user.is('Admin')) return;
    const notificationID = req.params?.[0]?.ID || req.data.ID;
    const notification = notificationID
      ? await cds.tx(req).run(SELECT.one.from(db.Notifications).where({ ID: notificationID }))
      : null;
    if (!notification || (notification.recipient !== req.user.id && !req.user.is(notification.recipient))) {
      req.reject(403, 'Cette notification ne vous appartient pas.');
    }
    const illegal = Object.keys(req.data).filter(field => !['ID', 'isRead'].includes(field));
    if (illegal.length) req.reject(400, 'Seul l’état de lecture peut être modifié.');
  });

  this.on('dashboard', async req => {
    const tx = cds.tx(req);
    const [requests, steps, budgets] = await Promise.all([
      tx.run(SELECT.from(db.PurchaseRequests)),
      tx.run(SELECT.from(db.ApprovalSteps)),
      tx.run(SELECT.from(db.Budgets))
    ]);
    const now = Date.now();
    return {
      requests: requests.length,
      pendingSteps: steps.filter(step => step.status === 'active').length,
      highRisk: requests.filter(item => ['high', 'critical'].includes(item.riskLevel)).length,
      overdueSteps: steps.filter(step => step.status === 'active' && step.dueAt && new Date(step.dueAt).getTime() < now).length,
      budgetAllocated: budgets.reduce((sum, item) => sum + Number(item.allocated || 0), 0),
      budgetCommitted: budgets.reduce((sum, item) => sum + Number(item.committed || 0), 0),
      budgetConsumed: budgets.reduce((sum, item) => sum + Number(item.consumed || 0), 0),
      budgetCurrency: [...new Set(budgets.map(item => item.currency).filter(Boolean))].length === 1 ? budgets[0]?.currency : 'MULTI'
    };
  });

  this.on('submitRequest', async req => {
    ensureApprovalRole(req);
    const tx = cds.tx(req);
    const request = await tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: req.data.requestID }));
    if (!request) req.reject(404, 'Demande introuvable.');
    if (!req.user.is('Admin') && request.requester !== req.user.id) req.reject(403, 'Vous ne pouvez soumettre que vos propres demandes.');
    if (request.status !== 'draft') req.reject(409, 'Seule une demande en brouillon peut être soumise.');
    const items = await tx.run(SELECT.from(db.RequestItems).where({ request_ID: request.ID }));
    if (!items.length) req.reject(400, 'Ajoutez au moins une ligne à la demande.');
    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || Number(item.quantity) * Number(item.unitPrice)), 0);
    const supplier = request.supplier_ID
      ? await tx.run(SELECT.one.from(db.Suppliers).where({ ID: request.supplier_ID })) : {};
    if (supplier?.blocked) req.reject(400, 'Le fournisseur sélectionné est bloqué.');
    const budget = await tx.run(SELECT.one.from(db.Budgets).where({
      costCenter_code: request.costCenterCode,
      fiscalYear: request.fiscalYear
    }));
    if (!budget) req.reject(400, 'Aucun budget trouvé pour ce centre de coûts.');
    if (request.currency !== budget.currency) req.reject(400, `La devise ${request.currency} ne correspond pas au budget ${budget.currency}.`);
    const available = Number(budget.allocated) - Number(budget.committed) - Number(budget.consumed);
    if (available < totalAmount) req.reject(409, `Budget insuffisant. Disponible : ${available.toFixed(2)} ${budget.currency}.`);

    const evaluated = Object.assign({}, request, { totalAmount });
    const risk = calculateRisk(evaluated, supplier || {});
    const workflowRules = await tx.run(SELECT.from(db.WorkflowRules).where({ active: true }).orderBy('sequence'));
    const steps = buildApprovalSteps(evaluated, risk.level, workflowRules);
    if (!steps.length) req.reject(409, 'Aucune règle de workflow active ne correspond à cette demande.');
    try {
      await adjustBudget(tx, budget.ID, totalAmount);
    } catch (error) {
      req.reject(error.statusCode || 409, error.message);
    }
    await tx.run(INSERT.into(db.BudgetCommitments).entries({
      ID: cds.utils.uuid(), request_ID: request.ID, budget_ID: budget.ID,
      amount: totalAmount, currency: budget.currency, status: 'active', reservedAt: new Date().toISOString()
    }));
    await tx.run(DELETE.from(db.ApprovalSteps).where({ request_ID: request.ID }));
    await tx.run(INSERT.into(db.ApprovalSteps).entries(steps.map(step => ({
      ID: cds.utils.uuid(), request_ID: request.ID, ...step
    }))));
    await tx.run(UPDATE(db.PurchaseRequests).set({
      status: 'inApproval', totalAmount, riskScore: risk.score, riskLevel: risk.level,
      riskExplanation: risk.explanation, currentApprovalLevel: 1, submittedAt: new Date().toISOString()
    }).where({ ID: request.ID }));
    await tx.run(INSERT.into(db.Notifications).entries({
      ID: cds.utils.uuid(), recipient: steps[0].role, request_ID: request.ID,
      title: `Validation ${request.requestNumber}`, message: steps[0].label,
      severity: risk.level === 'critical' ? 'Error' : 'Information', dueAt: steps[0].dueAt
    }));
    await audit(tx, req, 'PurchaseRequest', request.ID, 'SUBMITTED', `Montant ${totalAmount}; risque ${risk.score}/100; ${steps.length} niveau(x)`);
    return tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: request.ID }));
  });

  this.on('decideApproval', async req => {
    ensureApprovalRole(req);
    const decision = String(req.data.decision || '').toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) req.reject(400, 'Décision attendue : approved ou rejected.');
    if (decision === 'rejected' && !String(req.data.comment || '').trim()) req.reject(400, 'Un commentaire est obligatoire pour rejeter.');
    const tx = cds.tx(req);
    const step = await tx.run(SELECT.one.from(db.ApprovalSteps).where({ ID: req.data.stepID }));
    if (!step) req.reject(404, 'Étape introuvable.');
    ensureStepRole(req, step);
    if (step.status !== 'active') req.reject(409, 'Cette étape n’est pas active.');
    const request = await tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: step.request_ID }));
    if (!request || request.status !== 'inApproval') req.reject(409, 'La demande n’est plus en cours de validation.');
    const now = new Date().toISOString();
    const decided = await tx.run(UPDATE(db.ApprovalSteps).set({ status: decision, approver: req.user.id, decidedAt: now, comment: req.data.comment || '' }).where({ ID: step.ID, status: 'active' }));
    if (decided !== 1) req.reject(409, 'Cette étape vient déjà d’être traitée.');
    if (decision === 'rejected') {
      await tx.run(UPDATE(db.PurchaseRequests).set({ status: 'rejected' }).where({ ID: request.ID }));
      try {
        await releaseCommitment(tx, request.ID, 'released');
      } catch (error) {
        req.reject(error.statusCode || 409, error.message);
      }
    } else {
      const next = await tx.run(SELECT.one.from(db.ApprovalSteps).where({ request_ID: request.ID, sequence: step.sequence + 1 }));
      if (next) {
        const activated = await tx.run(UPDATE(db.ApprovalSteps).set({ status: 'active' }).where({ ID: next.ID, status: 'waiting' }));
        if (activated !== 1) req.reject(409, 'L’étape suivante ne peut pas être activée.');
        await tx.run(UPDATE(db.PurchaseRequests).set({ currentApprovalLevel: next.sequence }).where({ ID: request.ID }));
        await tx.run(INSERT.into(db.Notifications).entries({ ID: cds.utils.uuid(), recipient: next.role, request_ID: request.ID, title: `Validation ${request.requestNumber}`, message: next.label, dueAt: next.dueAt }));
      } else {
        await tx.run(UPDATE(db.PurchaseRequests).set({ status: 'approved' }).where({ ID: request.ID }));
      }
    }
    await audit(tx, req, 'ApprovalStep', step.ID, decision.toUpperCase(), req.data.comment || 'Sans commentaire');
    return tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: request.ID }));
  });

  this.on('convertRequest', async req => {
    if (!req.user.is('Admin') && !req.user.is('PurchasingDirector')) {
      req.reject(403, 'La création de commande exige le rôle PurchasingDirector.');
    }
    const tx = cds.tx(req);
    const request = await tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: req.data.requestID }));
    if (!request) req.reject(404, 'Demande introuvable.');
    if (request.status !== 'approved') req.reject(409, 'La demande doit être totalement approuvée.');
    const [items, supplier] = await Promise.all([
      tx.run(SELECT.from(db.RequestItems).where({ request_ID: request.ID }).orderBy('position')),
      request.supplier_ID ? tx.run(SELECT.one.from(db.Suppliers).where({ ID: request.supplier_ID })) : null
    ]);
    if (!items.length) req.reject(409, 'La demande ne contient aucune ligne.');

    let orderNumber;
    if (isRemoteMode()) {
      try {
        orderNumber = await createRemotePurchaseOrder(request, items, supplier);
      } catch (error) {
        req.reject(error.statusCode || 502, `Création S/4HANA impossible : ${error.message}`);
      }
    } else {
      orderNumber = `46${crypto.randomInt(10000000, 100000000)}`;
      await tx.run(INSERT.into(db.PurchaseOrders).entries({
        ID: cds.utils.uuid(), orderNumber, supplier: supplier?.name || supplier?.supplierNumber || 'Fournisseur',
        orderDate: new Date().toISOString().slice(0, 10), amount: request.totalAmount,
        currency: request.currency, category: items[0].category || 'ACHAT', buyer: req.user.id,
        description: request.title, requestingDepartment: request.department,
        costCenter: request.costCenterCode, priority: request.priority, requestedBy: request.requester,
        requiredDeliveryDate: request.desiredDeliveryDate, businessJustification: request.justification
      }));
    }

    const converted = await tx.run(UPDATE(db.PurchaseRequests).set({ status: 'converted', convertedOrderNumber: orderNumber }).where({ ID: request.ID, status: 'approved' }));
    if (converted !== 1) req.reject(409, 'Cette demande vient déjà d’être convertie.');
    try {
      await releaseCommitment(tx, request.ID, 'consumed');
    } catch (error) {
      req.reject(error.statusCode || 409, error.message);
    }
    await audit(tx, req, 'PurchaseRequest', request.ID, 'CONVERTED', `Commande ${isRemoteMode() ? 'S/4HANA' : 'locale'} ${orderNumber}`);
    return tx.run(SELECT.one.from(db.PurchaseRequests).where({ ID: request.ID }));
  });

  this.before(['CREATE', 'UPDATE'], Reviews, async req => {
    if (req.event === 'CREATE' && (!req.data.status || req.data.status === 'pending')) {
      req.reject(400, 'Une décision doit être approved ou rejected.');
    }
    if (req.event === 'UPDATE' && (req.data.purchaseOrder_ID !== undefined || req.data.purchaseOrderNumber !== undefined)) {
      req.reject(400, 'La commande d’une décision ne peut pas être modifiée.');
    }
    let purchaseOrderId = req.data.purchaseOrder_ID;
    let purchaseOrderNumber = req.data.purchaseOrderNumber;
    let storedReview;
    if (req.event === 'UPDATE' && !purchaseOrderId && !purchaseOrderNumber) {
      const reviewId = req.params?.[0]?.ID;
      storedReview = reviewId ? await cds.tx(req).run(SELECT.one.from(Reviews).where({ ID: reviewId })) : null;
      purchaseOrderId = storedReview?.purchaseOrder_ID;
      purchaseOrderNumber = storedReview?.purchaseOrderNumber;
    }

    let purchaseOrder;
    if (isRemoteMode()) {
      purchaseOrder = purchaseOrderNumber ? (await loadRemoteOrders(purchaseOrderNumber))[0] : null;
      req.data.purchaseOrder_ID = null;
    } else {
      purchaseOrder = purchaseOrderId
        ? await SELECT.one.from(PurchaseOrders).where({ ID: purchaseOrderId })
        : purchaseOrderNumber
          ? await SELECT.one.from(PurchaseOrders).where({ orderNumber: purchaseOrderNumber })
          : null;
      if (purchaseOrder) req.data.purchaseOrder_ID = purchaseOrder.ID;
    }
    if (!purchaseOrder) req.reject(404, 'Commande introuvable.');
    req.data.purchaseOrderNumber = purchaseOrder.orderNumber;

    if (req.event === 'CREATE') {
      req.data.reviewer = req.user.id;
      req.data.decisionAt = new Date().toISOString();
    } else {
      delete req.data.reviewer;
      delete req.data.decisionAt;
    }

    const error = validateReview({ ...(storedReview || {}), ...req.data }, purchaseOrder);
    if (error) req.reject(error.code, error.message);

    if (req.event === 'CREATE') {
      let existing = await SELECT.one.from(Reviews).where({ purchaseOrderNumber: purchaseOrder.orderNumber });
      if (!existing && req.data.purchaseOrder_ID) {
        existing = await SELECT.one.from(Reviews).where({ purchaseOrder_ID: req.data.purchaseOrder_ID });
      }
      if (existing) req.reject(409, 'Cette commande possède déjà une décision.');
    }
  });

  this.after('UPDATE', Reviews, async (data, req) => {
    await audit(cds.tx(req), req, 'Review', data.ID || req.params?.[0]?.ID, 'UPDATED', `Statut ${data.status || 'inchangé'}`);
  });

  this.before('DELETE', Reviews, async req => {
    const reviewID = req.params?.[0]?.ID;
    const stored = reviewID ? await cds.tx(req).run(SELECT.one.from(Reviews).where({ ID: reviewID })) : null;
    if (stored) await audit(cds.tx(req), req, 'Review', reviewID, 'DELETED', `Commande ${stored.purchaseOrderNumber}; statut ${stored.status}`);
  });
});
