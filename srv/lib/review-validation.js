'use strict';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

function validateReview(review, purchaseOrder = {}) {
  const status = review.status || 'pending';
  const comment = typeof review.comment === 'string' ? review.comment.trim() : '';

  if (!VALID_STATUSES.has(status)) {
    return { code: 400, message: `Statut inconnu : ${status}.` };
  }
  if (status === 'rejected' && !comment) {
    return { code: 400, message: 'Un commentaire est obligatoire pour rejeter une commande.' };
  }
  const amount = Number(purchaseOrder.amount || 0);
  if (status === 'approved' && amount >= 20000 && !comment) {
    return { code: 400, message: 'Une justification est obligatoire pour approuver une commande de 20 000 ou plus.' };
  }
  if (status === 'approved' && purchaseOrder.priority === 'critical' && !comment) {
    return { code: 400, message: 'Une justification est obligatoire pour approuver une commande critique.' };
  }
  return null;
}

module.exports = { validateReview, VALID_STATUSES };
