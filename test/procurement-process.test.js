'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRisk, buildApprovalSteps, ruleMatches } = require('../srv/lib/procurement-process');

test('le risque combine montant, priorité et fournisseur', () => {
  const risk = calculateRisk({ totalAmount: 60000, priority: 'critical' }, { riskLevel: 'high', qualityScore: 65 });
  assert.equal(risk.score, 95);
  assert.equal(risk.level, 'critical');
  assert.match(risk.explanation, /montant/);
});

test('un achat sensible produit trois niveaux de validation', () => {
  const steps = buildApprovalSteps({ totalAmount: 60000 }, 'high', new Date('2026-10-18T10:00:00Z'));
  assert.deepEqual(steps.map(step => step.role), ['DepartmentManager', 'FinanceController', 'PurchasingDirector']);
  assert.equal(steps[0].status, 'active');
  assert.equal(steps[1].status, 'waiting');
});

test('les règles configurées pilotent réellement le workflow', () => {
  const rules = [
    { name: 'Validation locale', minAmount: 0, maxAmount: 9999, requiredRole: 'DepartmentManager', sequence: 1, active: true },
    { name: 'Comité spécial', minRiskLevel: 'medium', requiredRole: 'PurchasingDirector', sequence: 2, active: true }
  ];
  const steps = buildApprovalSteps({ totalAmount: 5000 }, 'high', rules, new Date('2026-10-18T10:00:00Z'));
  assert.deepEqual(steps.map(step => step.label), ['Validation locale', 'Comité spécial']);
});

test('le mode any déclenche une règle par le montant ou le risque', () => {
  const rule = { minAmount: 50000, minRiskLevel: 'high', triggerMode: 'any' };
  assert.equal(ruleMatches(rule, 1000, 'high'), true);
  assert.equal(ruleMatches(rule, 60000, 'low'), true);
  assert.equal(ruleMatches(rule, 1000, 'low'), false);
});
