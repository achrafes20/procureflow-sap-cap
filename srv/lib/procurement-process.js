'use strict';

function calculateRisk(request, supplier = {}) {
  let score = 0;
  const reasons = [];
  const amount = Number(request.totalAmount || 0);
  if (amount >= 50000) { score += 30; reasons.push('montant supérieur ou égal à 50 000'); }
  else if (amount >= 20000) { score += 15; reasons.push('montant supérieur ou égal à 20 000'); }
  if (request.priority === 'critical') { score += 25; reasons.push('priorité critique'); }
  if (supplier.blocked) { score += 100; reasons.push('fournisseur bloqué'); }
  if (supplier.riskLevel === 'high') { score += 25; reasons.push('fournisseur à risque élevé'); }
  if (supplier.riskLevel === 'critical') { score += 40; reasons.push('fournisseur à risque critique'); }
  if (Number(supplier.qualityScore || 100) < 70) { score += 15; reasons.push('qualité fournisseur inférieure à 70'); }
  if (supplier.complianceValidUntil && new Date(supplier.complianceValidUntil) < new Date()) {
    score += 30; reasons.push('documents de conformité expirés');
  }
  score = Math.min(score, 100);
  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, explanation: reasons.join(' ; ') || 'Aucun facteur de risque détecté' };
}

const DEFAULT_WORKFLOW_RULES = [
  { name: 'Responsable du département', minAmount: 0, requiredRole: 'DepartmentManager', sequence: 1, triggerMode: 'all', active: true },
  { name: 'Contrôle financier', minAmount: 10000, requiredRole: 'FinanceController', sequence: 2, triggerMode: 'all', active: true },
  { name: 'Direction des achats', minAmount: 50000, minRiskLevel: 'high', requiredRole: 'PurchasingDirector', sequence: 3, triggerMode: 'any', active: true }
];

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function ruleMatches(rule, amount, riskLevel) {
  const checks = [];
  if (rule.minAmount !== undefined && rule.minAmount !== null) checks.push(amount >= Number(rule.minAmount));
  if (rule.maxAmount !== undefined && rule.maxAmount !== null) checks.push(amount <= Number(rule.maxAmount));
  if (rule.minRiskLevel) checks.push((RISK_RANK[riskLevel] || 0) >= (RISK_RANK[rule.minRiskLevel] || 0));
  if (!checks.length) return true;
  return String(rule.triggerMode || 'all').toLowerCase() === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

function buildApprovalSteps(request, riskLevel, rules = DEFAULT_WORKFLOW_RULES, now = new Date()) {
  // Compatibilité avec l'ancienne signature buildApprovalSteps(request, risk, now).
  if (rules instanceof Date) {
    now = rules;
    rules = DEFAULT_WORKFLOW_RULES;
  }
  const amount = Number(request.totalAmount || 0);
  const selectedRules = (Array.isArray(rules) && rules.length ? rules : DEFAULT_WORKFLOW_RULES)
    .filter(rule => rule.active !== false && ruleMatches(rule, amount, riskLevel))
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  return selectedRules.map((rule, index) => ({
    sequence: index + 1,
    role: rule.requiredRole,
    label: rule.name,
    status: index === 0 ? 'active' : 'waiting',
    dueAt: new Date(now.getTime() + (index + 1) * 48 * 60 * 60 * 1000).toISOString()
  }));
}

module.exports = { calculateRisk, buildApprovalSteps, ruleMatches, DEFAULT_WORKFLOW_RULES };
