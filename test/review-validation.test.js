'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReview } = require('../srv/lib/review-validation');

test('une approbation standard est acceptée sans commentaire', () => {
  assert.equal(validateReview({ status: 'approved' }, { amount: 5000, priority: 'medium' }), null);
});

test('un rejet sans commentaire est refusé', () => {
  const error = validateReview({ status: 'rejected' });
  assert.equal(error.code, 400);
  assert.match(error.message, /commentaire/i);
});

test('un rejet commenté est accepté', () => {
  assert.equal(validateReview({
    status: 'rejected',
    comment: 'Budget insuffisant.'
  }), null);
});

test('une commande de 20 000 ou plus exige une justification', () => {
  const error = validateReview({ status: 'approved' }, { amount: 28750, priority: 'high' });
  assert.match(error.message, /justification/i);
});

test('une commande critique exige une justification', () => {
  const error = validateReview({ status: 'approved' }, { amount: 5000, priority: 'critical' });
  assert.match(error.message, /critique/i);
});

test('une approbation sensible commentée est acceptée', () => {
  assert.equal(validateReview(
    { status: 'approved', comment: 'Risque vérifié et budget confirmé.' },
    { amount: 28750, priority: 'critical' }
  ), null);
});

test('un statut inconnu est refusé', () => {
  const error = validateReview({ status: 'cancelled' });
  assert.match(error.message, /statut inconnu/i);
});
