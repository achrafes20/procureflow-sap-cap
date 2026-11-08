'use strict';

// cds.test installe les adaptateurs du runner natif Node et démarre CAP sur
// un port aléatoire avec la base SQLite en mémoire du profil "test".
process.env.NODE_ENV = 'test';
const cds = require('@sap/cds');
const assert = require('node:assert/strict');

const project = require('node:path').join(__dirname, '..');
const cap = cds.test(project);
const { GET, POST, PATCH, DELETE, data } = cap;

assert.equal(cds.env.requires.db.credentials.url, ':memory:', 'Les tests doivent utiliser SQLite en mémoire');

const auth = {
  viewer: { auth: { username: 'viewer', password: 'viewer123' } },
  approver: { auth: { username: 'approver', password: 'approver123' } },
  finance: { auth: { username: 'finance', password: 'finance123' } },
  director: { auth: { username: 'director', password: 'director123' } },
  admin: { auth: { username: 'admin', password: 'admin123' } }
};

const orderIds = {
  alreadyReviewed: '11111111-1111-1111-1111-111111111111',
  standard: '22222222-2222-2222-2222-222222222222',
  critical: '44444444-4444-4444-4444-444444444444'
};

const rejectsWithStatus = (promise, status) => assert.rejects(
  promise,
  error => error.status === status,
  `La requête devait échouer avec HTTP ${status}`
);

describe('API ProcureFlow — authentification et autorisations', () => {
  beforeEach(data.reset);

  test('un utilisateur anonyme reçoit HTTP 401', async () => {
    await rejectsWithStatus(GET('/procurement/PurchaseOrders'), 401);
  });

  test('viewer peut lire les commandes mais pas créer une décision', async () => {
    const response = await GET('/procurement/PurchaseOrders', auth.viewer);
    assert.equal(response.status, 200);
    assert.equal(response.data.value.length, 5);

    await rejectsWithStatus(POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.standard,
      status: 'approved',
      comment: 'Tentative interdite'
    }, auth.viewer), 403);
  });

  test('approver peut créer une décision et le serveur impose son identité', async () => {
    const response = await POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.standard,
      status: 'approved',
      reviewer: 'identite-falsifiee',
      comment: 'Budget contrôlé.'
    }, auth.approver);

    assert.equal(response.status, 201);
    assert.equal(response.data.reviewer, 'approver');
    assert.ok(response.data.decisionAt);
  });

  test('approver ne peut ni modifier ni supprimer une décision', async () => {
    const seededReview = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await rejectsWithStatus(PATCH(`/procurement/Reviews(${seededReview})`, {
      comment: 'Modification interdite'
    }, auth.approver), 403);
    await rejectsWithStatus(DELETE(`/procurement/Reviews(${seededReview})`, auth.approver), 403);
  });

  test('admin peut modifier puis supprimer une décision', async () => {
    const created = await POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.standard,
      status: 'approved',
      comment: 'Décision initiale'
    }, auth.admin);

    const updated = await PATCH(`/procurement/Reviews(${created.data.ID})`, {
      status: 'rejected',
      comment: 'Décision corrigée par administration'
    }, auth.admin);
    assert.equal(updated.status, 200);
    assert.equal(updated.data.status, 'rejected');
    assert.equal(updated.data.reviewer, 'admin');

    const removed = await DELETE(`/procurement/Reviews(${created.data.ID})`, auth.admin);
    assert.equal(removed.status, 204);
  });

  test('l’endpoint me retourne le rôle effectif', async () => {
    const viewer = await GET('/procurement/me()', auth.viewer);
    const admin = await GET('/procurement/me()', auth.admin);
    assert.equal(viewer.data.id, 'viewer');
    assert.equal(viewer.data.canApprove, false);
    assert.equal(viewer.data.isAdmin, false);
    assert.equal(admin.data.id, 'admin');
    assert.equal(admin.data.canApprove, true);
    assert.equal(admin.data.isAdmin, true);
  });
});

describe('API ProcureFlow — règles métier intégrées', () => {
  beforeEach(data.reset);

  test('un rejet sans commentaire reçoit HTTP 400', async () => {
    await rejectsWithStatus(POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.standard,
      status: 'rejected',
      comment: ''
    }, auth.approver), 400);
  });

  test('une approbation critique sans justification reçoit HTTP 400', async () => {
    await rejectsWithStatus(POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.critical,
      status: 'approved',
      comment: ''
    }, auth.approver), 400);
  });

  test('une deuxième décision sur la même commande reçoit HTTP 409', async () => {
    await rejectsWithStatus(POST('/procurement/Reviews', {
      purchaseOrder_ID: orderIds.alreadyReviewed,
      status: 'approved',
      comment: 'Deuxième décision'
    }, auth.approver), 409);
  });

  test('une décision pour une commande inconnue reçoit HTTP 404', async () => {
    await rejectsWithStatus(POST('/procurement/Reviews', {
      purchaseOrder_ID: '99999999-9999-9999-9999-999999999999',
      status: 'approved',
      comment: 'Commande absente'
    }, auth.approver), 404);
  });
});

describe('API ProcureFlow — cycle Source-to-Pay', () => {
  beforeEach(data.reset);

  test('le cockpit retourne les indicateurs de gouvernance', async () => {
    const response = await GET('/procurement/dashboard()', auth.viewer);
    assert.equal(response.status, 200);
    assert.equal(response.data.requests, 3);
    assert.ok(Number(response.data.budgetAllocated) > 0);
  });

  test('la soumission calcule le risque et crée le workflow', async () => {
    const response = await POST('/procurement/submitRequest', {
      requestID: 'e1000000-0000-4000-8000-000000000001'
    }, auth.approver);
    assert.equal(response.status, 200);
    assert.equal(response.data.status, 'inApproval');
    assert.equal(Number(response.data.totalAmount), 42000);

    const steps = await GET('/procurement/ApprovalSteps?$filter=request_ID%20eq%20e1000000-0000-4000-8000-000000000001&$orderby=sequence', auth.approver);
    assert.equal(steps.data.value.length, 2);
    assert.equal(steps.data.value[0].status, 'active');
  });

  test('une approbation active fait avancer le workflow', async () => {
    const response = await POST('/procurement/decideApproval', {
      stepID: 'a1000000-0000-4000-8000-000000000002',
      decision: 'approved',
      comment: 'Budget vérifié.'
    }, auth.finance);
    assert.equal(response.status, 200);
    assert.equal(response.data.currentApprovalLevel, 3);
    assert.equal(response.data.status, 'inApproval');
  });

  test('une demande approuvée devient une commande simulée', async () => {
    const response = await POST('/procurement/convertRequest', {
      requestID: 'e1000000-0000-4000-8000-000000000003'
    }, auth.admin);
    assert.equal(response.status, 200);
    assert.equal(response.data.status, 'converted');
    assert.match(response.data.convertedOrderNumber, /^46\d{8}$/);
  });

  test('une demande multi-ligne calcule son total et impose le demandeur', async () => {
    const response = await POST('/procurement/PurchaseRequests', {
      requestNumber: 'DA-TEST-001', title: 'Demande automatisée', department: 'IT',
      costCenterCode: 'CC-IT-210', supplier_ID: 'd1000000-0000-4000-8000-000000000001',
      priority: 'medium', currency: 'MAD', justification: 'Test du cycle complet',
      items: [
        { position: 1, description: 'Article A', quantity: 2, unit: 'EA', unitPrice: 100 },
        { position: 2, description: 'Article B', quantity: 3, unit: 'EA', unitPrice: 50 }
      ]
    }, auth.approver);
    assert.equal(response.status, 201);
    assert.equal(response.data.requester, 'approver');
    assert.equal(Number(response.data.totalAmount), 350);
    assert.equal(response.data.status, 'draft');
  });

  test('un PATCH ne peut pas contourner les transitions métier', async () => {
    await rejectsWithStatus(PATCH('/procurement/PurchaseRequests(e1000000-0000-4000-8000-000000000001)', {
      status: 'approved', totalAmount: 1
    }, auth.admin), 400);
  });

  test('seul le rôle précis de l’étape peut décider', async () => {
    await rejectsWithStatus(POST('/procurement/decideApproval', {
      stepID: 'a1000000-0000-4000-8000-000000000002', decision: 'approved', comment: 'Tentative'
    }, auth.approver), 403);
  });

  test('les notifications sont limitées au destinataire ou à son rôle', async () => {
    await POST('/procurement/submitRequest', {
      requestID: 'e1000000-0000-4000-8000-000000000001'
    }, auth.approver);
    const managerNotifications = await GET('/procurement/Notifications', auth.approver);
    const financeNotifications = await GET('/procurement/Notifications', auth.finance);
    assert.equal(managerNotifications.data.value.length, 1);
    assert.equal(financeNotifications.data.value.length, 0);
  });

  test('deux soumissions concurrentes ne peuvent pas surengager le budget', async () => {
    const createRequest = (number, amount) => POST('/procurement/PurchaseRequests', {
      requestNumber: number, title: `Concurrence ${number}`, department: 'IT',
      costCenterCode: 'CC-IT-210', supplier_ID: 'd1000000-0000-4000-8000-000000000001',
      priority: 'medium', currency: 'MAD', justification: 'Test de réservation atomique',
      items: [{ position: 1, description: 'Charge concurrente', quantity: 1, unit: 'EA', unitPrice: amount }]
    }, auth.approver);
    const first = await createRequest('DA-LOCK-001', 70000);
    const second = await createRequest('DA-LOCK-002', 70000);
    const results = await Promise.allSettled([
      POST('/procurement/submitRequest', { requestID: first.data.ID }, auth.approver),
      POST('/procurement/submitRequest', { requestID: second.data.ID }, auth.approver)
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  });

  test('les numéros de demande sont uniques en base', async () => {
    await rejectsWithStatus(POST('/procurement/PurchaseRequests', {
      requestNumber: 'DA-2026-001', title: 'Doublon', costCenterCode: 'CC-IT-210',
      supplier_ID: 'd1000000-0000-4000-8000-000000000001', currency: 'MAD', justification: 'Doit être refusé',
      items: [{ description: 'Doublon', quantity: 1, unitPrice: 10 }]
    }, auth.approver), 409);
  });
});
