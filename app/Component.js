sap.ui.define([
  'sap/ui/core/UIComponent',
  'sap/ui/model/json/JSONModel'
], function (UIComponent, JSONModel) {
  'use strict';

  return UIComponent.extend('procureflow.Component', {
    metadata: { manifest: 'json' },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({
        orders: [],
        filteredOrders: [],
        reviews: [],
        requests: [],
        budgets: [],
        suppliers: [],
        costCenters: [],
        dashboard: { requests: 0, pendingSteps: 0, highRisk: 0, overdueSteps: 0, budgetAllocated: 0, budgetCommitted: 0, budgetConsumed: 0 },
        system: { sourceLabel: 'Chargement...', remote: false },
        filteredReviews: [],
        user: { id: '', initials: '', canApprove: false, isAdmin: false },
        auth: { authenticated: false, busy: false, error: '' },
        view: 'orders',
        adminQuery: '',
        adminStats: { total: 0, approved: 0, rejected: 0 },
        busy: true,
        query: '',
        statusFilter: 'all',
        stats: { total: 0, pending: 0, approved: 0, rejected: 0, value: '0 MAD' }
      }), 'app');
    }
  });
});
