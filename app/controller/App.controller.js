sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/m/Dialog',
  'sap/m/Button',
  'sap/m/MessageBox',
  'sap/m/MessageToast',
  'sap/m/VBox',
  'sap/m/HBox',
  'sap/m/Title',
  'sap/m/Text',
  'sap/m/Label',
  'sap/m/TextArea',
  'sap/m/ObjectStatus'
], function (
  Controller, Dialog, Button, MessageBox, MessageToast,
  VBox, HBox, Title, Text, Label, TextArea, ObjectStatus
) {
  'use strict';

  const API = '/procurement';

  return Controller.extend('procureflow.controller.App', {
    onInit: function () {
      this._authHeader = null;
      this._sessionAuth = false;
      const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
      if (!localHosts.has(window.location.hostname)) this.trySessionLogin();
    },

    apiFetch: function (path, options = {}) {
      const headers = Object.assign({}, options.headers || {});
      if (this._authHeader) headers.Authorization = this._authHeader;
      return fetch(`${API}${path}`, Object.assign({ credentials: 'same-origin' }, options, { headers }));
    },

    trySessionLogin: async function () {
      try {
        const response = await fetch(`${API}/me()`, { credentials: 'same-origin' });
        if (!response.ok) return;
        const user = await response.json();
        this._sessionAuth = true;
        this.setCurrentUser(user);
        this.getOwnerComponent().getModel('app').setProperty('/auth/authenticated', true);
        await this.loadData();
      } catch (_error) {
        // En développement local, l'écran Basic reste affiché.
      }
    },

    onLogin: async function () {
      const model = this.getOwnerComponent().getModel('app');
      const username = this.byId('loginUser').getValue().trim();
      const password = this.byId('loginPassword').getValue();
      model.setProperty('/auth/error', '');

      if (!username || !password) {
        model.setProperty('/auth/error', 'Saisissez l’identifiant et le mot de passe.');
        return;
      }

      model.setProperty('/auth/busy', true);
      const candidateHeader = `Basic ${window.btoa(`${username}:${password}`)}`;
      try {
        const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
        const response = localHosts.has(window.location.hostname)
          ? await fetch('/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          })
          : await fetch(`${API}/me()`, { headers: { Authorization: candidateHeader } });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error?.message || 'Identifiant ou mot de passe incorrect.');
        }
        const user = await response.json();
        this._authHeader = candidateHeader;
        this.setCurrentUser(user);
        model.setProperty('/auth/authenticated', true);
        await this.loadData();
        MessageToast.show(`Bienvenue ${user.id}`);
      } catch (error) {
        this._authHeader = null;
        model.setProperty('/auth/error', error.message || 'Connexion impossible.');
      } finally {
        model.setProperty('/auth/busy', false);
      }
    },

    setCurrentUser: function (user) {
      user.roles = user.roles || [];
      user.initials = user.id.split(/[.\s_-]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
      const roleLabels = { DepartmentManager: 'Responsable département', FinanceController: 'Contrôle financier', PurchasingDirector: 'Direction achats' };
      user.roleLabel = user.isAdmin ? 'Administrateur' : user.roles.map(role => roleLabels[role] || role).join(', ') || 'Consultation';
      this.getOwnerComponent().getModel('app').setProperty('/user', user);
    },

    onLogout: function () {
      this._authHeader = null;
      if (this._sessionAuth) window.location.assign('/logout');
      else window.location.reload();
    },

    loadData: async function () {
      const model = this.getOwnerComponent().getModel('app');
      model.setProperty('/busy', true);
      try {
        const [ordersResponse, reviewsResponse, requestsResponse, budgetsResponse, suppliersResponse, centersResponse, dashboardResponse, systemResponse] = await Promise.all([
          this.apiFetch('/PurchaseOrders?$orderby=orderDate desc'),
          this.apiFetch('/Reviews?$orderby=decisionAt desc'),
          this.apiFetch('/PurchaseRequests?$expand=items,approvalSteps,supplier&$orderby=createdAt desc'),
          this.apiFetch('/Budgets?$expand=costCenter'),
          this.apiFetch('/Suppliers?$orderby=name'),
          this.apiFetch('/CostCenters?$orderby=code'),
          this.apiFetch('/dashboard()'),
          this.apiFetch('/systemInfo()')
        ]);
        if (!ordersResponse.ok || !reviewsResponse.ok) throw new Error('Impossible de lire les données sécurisées.');
        const ordersPayload = await ordersResponse.json();
        const reviewsPayload = await reviewsResponse.json();
        const requestsPayload = await requestsResponse.json();
        const budgetsPayload = await budgetsResponse.json();
        const suppliersPayload = await suppliersResponse.json();
        const centersPayload = await centersResponse.json();
        const dashboard = await dashboardResponse.json();
        const system = await systemResponse.json();
        const rawOrders = ordersPayload.value || [];
        const rawReviews = reviewsPayload.value || [];
        const orders = rawOrders.map(order => this.decorateOrder(order, rawReviews));
        const reviews = rawReviews.map(review => this.decorateReview(review, rawOrders));
        const requests = (requestsPayload.value || []).map(request => this.decorateRequest(request));
        const budgets = (budgetsPayload.value || []).map(budget => {
          const available = Number(budget.allocated) - Number(budget.committed) - Number(budget.consumed);
          return Object.assign({}, budget, {
            budgetDescription: `${budget.costCenter?.name || budget.costCenter_code} · consommé ${this.formatMoney(budget.consumed)} ${budget.currency}`,
            availableText: `${this.formatMoney(available)} ${budget.currency} disponibles`,
            availableState: available < Number(budget.allocated) * 0.15 ? 'Error' : available < Number(budget.allocated) * 0.3 ? 'Warning' : 'Success'
          });
        });
        dashboard.budgetConsumedText = `${new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(Number(dashboard.budgetConsumed))} ${dashboard.budgetCurrency || ''}`;
        model.setProperty('/orders', orders);
        model.setProperty('/reviews', reviews);
        model.setProperty('/requests', requests);
        model.setProperty('/budgets', budgets);
        model.setProperty('/suppliers', suppliersPayload.value || []);
        model.setProperty('/costCenters', centersPayload.value || []);
        model.setProperty('/dashboard', dashboard);
        model.setProperty('/system', system);
        this.recalculate(orders, reviews);
        this.applyFilters();
        this.applyAdminFilters();
      } catch (error) {
        MessageBox.error(error.message);
      } finally {
        model.setProperty('/busy', false);
      }
    },

    decorateOrder: function (order, reviews) {
      const review = reviews.find(item =>
        item.purchaseOrderNumber === order.orderNumber || item.purchaseOrder_ID === order.ID
      );
      const status = review ? review.status : 'pending';
      const labels = { pending: ['À traiter', 'Warning'], approved: ['Approuvée', 'Success'], rejected: ['Rejetée', 'Error'] };
      const priorityLabels = { low: ['Basse', 'None'], medium: ['Normale', 'Information'], high: ['Haute', 'Warning'], critical: ['Critique', 'Error'] };
      const priority = order.priority || 'medium';
      return Object.assign({}, order, {
        review,
        status,
        statusText: labels[status][0],
        statusState: labels[status][1],
        priorityText: priorityLabels[priority][0],
        priorityState: priorityLabels[priority][1],
        formattedDate: this.formatDate(order.orderDate),
        formattedDeliveryDate: order.requiredDeliveryDate ? this.formatDate(order.requiredDeliveryDate) : 'Non définie',
        formattedAmount: new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(order.amount))
      });
    },

    decorateReview: function (review, orders) {
      const order = orders.find(item =>
        item.orderNumber === review.purchaseOrderNumber || item.ID === review.purchaseOrder_ID
      ) || {};
      const approved = review.status === 'approved';
      return Object.assign({}, review, {
        orderNumber: order.orderNumber || 'Commande inconnue',
        supplier: order.supplier || '',
        statusText: approved ? 'Approuvée' : 'Rejetée',
        statusState: approved ? 'Success' : 'Error',
        comment: review.comment || 'Aucun commentaire',
        formattedDecisionAt: this.formatDateTime(review.decisionAt || review.createdAt)
      });
    },

    formatDate: function (value) {
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
    },

    formatDateTime: function (value) {
      if (!value) return 'Date inconnue';
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    },

    formatMoney: function (value) {
      return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(value || 0));
    },

    decorateRequest: function (request) {
      const statuses = { draft: ['Brouillon', 'Information'], submitted: ['Soumise', 'Warning'], inApproval: ['En validation', 'Warning'], approved: ['Approuvée', 'Success'], rejected: ['Rejetée', 'Error'], converted: ['Commande créée', 'Success'] };
      const risks = { low: ['Faible', 'Success'], medium: ['Moyen', 'Warning'], high: ['Élevé', 'Error'], critical: ['Critique', 'Error'] };
      const status = statuses[request.status] || [request.status, 'None'];
      const risk = risks[request.riskLevel] || risks.low;
      return Object.assign({}, request, { statusLabel: status[0], statusState: status[1], riskLabel: `${risk[0]} · ${request.riskScore || 0}/100`, riskState: risk[1], formattedTotal: this.formatMoney(request.totalAmount) });
    },

    recalculate: function (orders, reviews) {
      const count = status => orders.filter(order => order.status === status).length;
      const totalsByCurrency = orders.reduce((totals, order) => {
        totals[order.currency || 'N/A'] = (totals[order.currency || 'N/A'] || 0) + Number(order.amount || 0);
        return totals;
      }, {});
      const portfolioValue = Object.entries(totalsByCurrency)
        .map(([currency, value]) => `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ${currency}`)
        .join(' · ');
      const model = this.getOwnerComponent().getModel('app');
      model.setProperty('/stats', {
        total: orders.length,
        pending: count('pending'),
        approved: count('approved'),
        rejected: count('rejected'),
        value: portfolioValue || '0'
      });
      model.setProperty('/adminStats', {
        total: reviews.length,
        approved: reviews.filter(item => item.status === 'approved').length,
        rejected: reviews.filter(item => item.status === 'rejected').length
      });
    },

    onShowOrders: function () {
      this.getOwnerComponent().getModel('app').setProperty('/view', 'orders');
    },

    onShowRequests: function () {
      this.getOwnerComponent().getModel('app').setProperty('/view', 'requests');
    },

    onShowAdmin: function () {
      const model = this.getOwnerComponent().getModel('app');
      if (model.getProperty('/user/isAdmin')) model.setProperty('/view', 'admin');
    },

    onSearch: function (event) {
      this.getOwnerComponent().getModel('app').setProperty('/query', event.getParameter('newValue') || '');
      this.applyFilters();
    },

    onFilterStatus: function (event) {
      this.getOwnerComponent().getModel('app').setProperty('/statusFilter', event.getSource().getSelectedKey());
      this.applyFilters();
    },

    applyFilters: function () {
      const model = this.getOwnerComponent().getModel('app');
      const query = (model.getProperty('/query') || '').trim().toLocaleLowerCase('fr');
      const status = model.getProperty('/statusFilter');
      const filtered = model.getProperty('/orders').filter(order => {
        const searchable = [order.orderNumber, order.supplier, order.buyer, order.category, order.requestingDepartment].join(' ').toLocaleLowerCase('fr');
        return (!query || searchable.includes(query)) && (status === 'all' || order.status === status);
      });
      model.setProperty('/filteredOrders', filtered);
    },

    onAdminSearch: function (event) {
      this.getOwnerComponent().getModel('app').setProperty('/adminQuery', event.getParameter('newValue') || '');
      this.applyAdminFilters();
    },

    applyAdminFilters: function () {
      const model = this.getOwnerComponent().getModel('app');
      const query = (model.getProperty('/adminQuery') || '').trim().toLocaleLowerCase('fr');
      const filtered = model.getProperty('/reviews').filter(review => {
        const searchable = [review.orderNumber, review.supplier, review.reviewer, review.comment, review.statusText].join(' ').toLocaleLowerCase('fr');
        return !query || searchable.includes(query);
      });
      model.setProperty('/filteredReviews', filtered);
    },

    onRefresh: async function () {
      await this.loadData();
      MessageToast.show('Données actualisées');
    },

    onOpenOrder: function (event) {
      this.openOrderDialog(event.getParameter('listItem').getBindingContext('app').getObject());
    },

    openOrderDialog: function (order) {
      const currentUser = this.getOwnerComponent().getModel('app').getProperty('/user');
      const canDecide = !order.review && currentUser.canApprove;
      const commentInput = new TextArea({ rows: 4, width: '100%', placeholder: 'Expliquez votre décision…' });
      const decision = new sap.m.SegmentedButton({ selectedKey: 'approved', items: [
        new sap.m.SegmentedButtonItem({ key: 'approved', text: 'Approuver', icon: 'sap-icon://accept' }),
        new sap.m.SegmentedButtonItem({ key: 'rejected', text: 'Rejeter', icon: 'sap-icon://decline' })
      ] });
      const content = new VBox({ items: [
        new HBox({ justifyContent: 'SpaceBetween', items: [new VBox({ items: [new Text({ text: 'COMMANDE' }).addStyleClass('pfEyebrow'), new Title({ text: order.orderNumber })] }), new ObjectStatus({ text: order.statusText, state: order.statusState, inverted: true })] }).addStyleClass('sapUiSmallMarginBottom'),
        new Text({ text: order.description, wrapping: true }).addStyleClass('pfDialogLead'),
        new HBox({ wrap: 'Wrap', items: [this.infoBlock('Fournisseur', order.supplier), this.infoBlock('Acheteur', order.buyer), this.infoBlock('Département', order.requestingDepartment || 'Non renseigné'), this.infoBlock('Centre de coûts', order.costCenter || 'Non renseigné'), this.infoBlock('Priorité', order.priorityText), this.infoBlock('Livraison souhaitée', order.formattedDeliveryDate)] }).addStyleClass('pfInfoGrid'),
        new VBox({ items: [new Label({ text: 'Justification métier' }), new Text({ text: order.businessJustification || 'Aucune justification renseignée.', wrapping: true })] }).addStyleClass('pfBusinessReason'),
        new HBox({ alignItems: 'End', items: [new Text({ text: order.formattedAmount }).addStyleClass('pfDialogAmountValue'), new Text({ text: order.currency }).addStyleClass('pfDialogCurrency')] }).addStyleClass('pfDialogAmount'),
        order.review ? new VBox({ items: [new Title({ text: 'Décision enregistrée', level: 'H4' }), new Text({ text: `${order.review.reviewer} · ${order.review.comment || 'Aucun commentaire'}`, wrapping: true })] }).addStyleClass('pfExistingReview')
          : canDecide ? new VBox({ items: [new Title({ text: 'Prendre une décision', level: 'H4' }), new Label({ text: 'Décision', required: true }), decision, new Text({ text: `Décision enregistrée au nom de ${currentUser.id}` }).addStyleClass('pfMuted sapUiTinyMarginTop'), new Label({ text: 'Commentaire (obligatoire pour un rejet, une priorité critique ou un montant ≥ 20 000)' }).addStyleClass('sapUiSmallMarginTop'), commentInput] }).addStyleClass('pfDecisionForm')
            : new VBox({ items: [new ObjectStatus({ text: 'Consultation uniquement', state: 'Information', icon: 'sap-icon://locked' }), new Text({ text: 'Ton rôle permet de consulter cette commande, mais pas de prendre une décision.', wrapping: true }).addStyleClass('sapUiTinyMarginTop')] }).addStyleClass('pfExistingReview')
      ] });
      const dialog = new Dialog({ title: 'Détail de la commande', contentWidth: '40rem', verticalScrolling: true, content: [content],
        beginButton: canDecide ? new Button({ text: 'Enregistrer la décision', type: 'Emphasized', press: () => this.saveReview(order, decision.getSelectedKey(), commentInput.getValue(), dialog) }) : null,
        endButton: new Button({ text: 'Fermer', press: () => dialog.close() }), afterClose: () => dialog.destroy()
      }).addStyleClass('pfDialog');
      dialog.open();
    },

    infoBlock: function (label, value) {
      return new VBox({ items: [new Label({ text: label }), new Text({ text: value, wrapping: true })] }).addStyleClass('pfInfoBlock');
    },

    saveReview: async function (order, status, comment, dialog) {
      if (status === 'rejected' && !comment.trim()) return MessageBox.warning('Expliquez pourquoi la commande est rejetée.');
      if (status === 'approved' && (Number(order.amount) >= 20000 || order.priority === 'critical') && !comment.trim()) return MessageBox.warning('Ajoutez une justification pour cette approbation sensible.');
      try {
        const response = await this.apiFetch('/Reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchaseOrder_ID: order.sourceSystem === 'S4HANA' ? null : order.ID, purchaseOrderNumber: order.orderNumber, status, comment: comment.trim() }) });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || `Erreur HTTP ${response.status}`);
        dialog.close();
        MessageToast.show(status === 'approved' ? 'Commande approuvée' : 'Commande rejetée');
        await this.loadData();
      } catch (error) { MessageBox.error(error.message); }
    },

    callBusinessAction: async function (name, payload) {
      const response = await this.apiFetch(`/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || `Erreur HTTP ${response.status}`);
      return response.json();
    },

    onCreateRequest: function () {
      const model = this.getOwnerComponent().getModel('app');
      const title = new sap.m.Input({ placeholder: 'Ex. Équipements pour la nouvelle équipe' });
      const description = new sap.m.Input({ placeholder: 'Article ou prestation' });
      const quantity = new sap.m.Input({ type: 'Number', value: '1' });
      const unitPrice = new sap.m.Input({ type: 'Number', placeholder: '0.00' });
      const justification = new TextArea({ rows: 3, width: '100%', placeholder: 'Pourquoi cet achat est-il nécessaire ?' });
      const supplier = new sap.m.Select({ width: '100%' });
      const center = new sap.m.Select({ width: '100%' });
      const priority = new sap.m.Select({ width: '100%', items: [
        new sap.ui.core.Item({ key: 'low', text: 'Basse' }), new sap.ui.core.Item({ key: 'medium', text: 'Normale' }),
        new sap.ui.core.Item({ key: 'high', text: 'Haute' }), new sap.ui.core.Item({ key: 'critical', text: 'Critique' })
      ] });
      model.getProperty('/suppliers').filter(item => !item.blocked).forEach(item => supplier.addItem(new sap.ui.core.Item({ key: item.ID, text: `${item.name} · risque ${item.riskLevel}` })));
      model.getProperty('/costCenters').forEach(item => center.addItem(new sap.ui.core.Item({ key: item.code, text: `${item.code} · ${item.name}` })));
      const form = new VBox({ items: [
        new Label({ text: 'Objet', required: true }), title,
        new Label({ text: 'Centre de coûts', required: true }).addStyleClass('sapUiSmallMarginTop'), center,
        new Label({ text: 'Fournisseur', required: true }).addStyleClass('sapUiSmallMarginTop'), supplier,
        new Label({ text: 'Priorité' }).addStyleClass('sapUiSmallMarginTop'), priority,
        new Label({ text: 'Article ou prestation', required: true }).addStyleClass('sapUiSmallMarginTop'), description,
        new HBox({ items: [new VBox({ width: '48%', items: [new Label({ text: 'Quantité' }), quantity] }), new VBox({ width: '48%', items: [new Label({ text: 'Prix unitaire (MAD)' }), unitPrice] })], justifyContent: 'SpaceBetween' }),
        new Label({ text: 'Justification', required: true }).addStyleClass('sapUiSmallMarginTop'), justification
      ] }).addStyleClass('sapUiContentPadding');
      const dialog = new Dialog({ title: 'Nouvelle demande d’achat', contentWidth: '38rem', content: [form],
        beginButton: new Button({ text: 'Créer le brouillon', type: 'Emphasized', press: async () => {
          if (!title.getValue().trim() || !description.getValue().trim() || !justification.getValue().trim() || Number(unitPrice.getValue()) <= 0) return MessageBox.warning('Complétez les champs obligatoires et indiquez un prix positif.');
          const payload = {
            requestNumber: `DA${String(new Date().getFullYear()).slice(-2)}${String(Date.now()).slice(-8)}`, title: title.getValue().trim(),
            department: model.getProperty('/costCenters').find(item => item.code === center.getSelectedKey())?.department || '',
            costCenterCode: center.getSelectedKey(), supplier_ID: supplier.getSelectedKey(), priority: priority.getSelectedKey(),
            currency: 'MAD', justification: justification.getValue().trim(),
            items: [{ position: 1, description: description.getValue().trim(), category: 'ACHAT', quantity: Number(quantity.getValue()), unit: 'EA', unitPrice: Number(unitPrice.getValue()) }]
          };
          const response = await this.apiFetch('/PurchaseRequests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!response.ok) return MessageBox.error((await response.json().catch(() => ({}))).error?.message || `Erreur HTTP ${response.status}`);
          dialog.close(); await this.loadData(); MessageToast.show('Demande créée en brouillon');
        } }),
        endButton: new Button({ text: 'Annuler', press: () => dialog.close() }), afterClose: () => dialog.destroy()
      });
      dialog.open();
    },

    onOpenRequest: function (event) {
      const request = event.getParameter('listItem').getBindingContext('app').getObject();
      const currentUser = this.getOwnerComponent().getModel('app').getProperty('/user');
      const steps = (request.approvalSteps || []).sort((a, b) => a.sequence - b.sequence);
      const activeStep = steps.find(step => step.status === 'active');
      const stepLabels = { waiting: 'En attente', active: 'À traiter', approved: 'Approuvée', rejected: 'Rejetée' };
      const content = new VBox({ items: [
        new HBox({ justifyContent: 'SpaceBetween', items: [new VBox({ items: [new Text({ text: request.requestNumber }).addStyleClass('pfEyebrow'), new Title({ text: request.title })] }), new ObjectStatus({ text: request.statusLabel, state: request.statusState, inverted: true })] }),
        new HBox({ wrap: 'Wrap', items: [this.infoBlock('Montant', `${request.formattedTotal} ${request.currency}`), this.infoBlock('Centre de coûts', request.costCenterCode), this.infoBlock('Fournisseur', request.supplier?.name || 'Non renseigné'), this.infoBlock('Risque', request.riskLabel)] }).addStyleClass('pfInfoGrid sapUiSmallMarginTop'),
        new VBox({ items: [new Label({ text: 'Justification' }), new Text({ text: request.justification || 'Non renseignée', wrapping: true })] }).addStyleClass('pfBusinessReason'),
        new Title({ text: 'Circuit d’approbation', level: 'H4' }).addStyleClass('sapUiSmallMarginTop'),
        ...steps.map(step => new HBox({
          justifyContent: 'SpaceBetween',
          items: [
            new VBox({ items: [
              new Text({ text: `${step.sequence}. ${step.label}` }).addStyleClass('pfStrong'),
              new Text({ text: step.approver ? `Par ${step.approver}` : `Rôle : ${step.role}` }).addStyleClass('pfMuted')
            ] }),
            new ObjectStatus({
              text: stepLabels[step.status] || step.status,
              state: step.status === 'approved' ? 'Success' : step.status === 'rejected' ? 'Error' : 'Warning'
            })
          ]
        }).addStyleClass('pfWorkflowStep')),
        new ObjectStatus({ text: `Score de risque : ${request.riskScore || 0}/100 — ${request.riskExplanation || 'calculé lors de la soumission'}`, state: request.riskState, icon: 'sap-icon://shield' }).addStyleClass('sapUiSmallMarginTop')
      ] }).addStyleClass('sapUiContentPadding');
      const buttons = [];
      if (request.status === 'draft' && (currentUser.isAdmin || request.requester === currentUser.id)) buttons.push(new Button({ text: 'Soumettre', type: 'Emphasized', press: async () => this.runRequestAction('submitRequest', { requestID: request.ID }, dialog, 'Demande soumise') }));
      if (activeStep && (currentUser.isAdmin || currentUser.roles.includes(activeStep.role))) {
        buttons.push(new Button({ text: 'Approuver l’étape', type: 'Accept', press: async () => this.decideRequestStep(activeStep, 'approved', dialog) }));
        buttons.push(new Button({ text: 'Rejeter', type: 'Reject', press: async () => this.decideRequestStep(activeStep, 'rejected', dialog) }));
      }
      if (request.status === 'approved' && (currentUser.isAdmin || currentUser.roles.includes('PurchasingDirector'))) buttons.push(new Button({ text: 'Créer la commande', type: 'Emphasized', press: async () => this.runRequestAction('convertRequest', { requestID: request.ID }, dialog, 'Commande créée') }));
      const dialog = new Dialog({ title: 'Détail de la demande', contentWidth: '45rem', content: [content], buttons: [...buttons, new Button({ text: 'Fermer', press: () => dialog.close() })], afterClose: () => dialog.destroy() });
      dialog.open();
    },

    runRequestAction: async function (name, payload, dialog, successMessage) {
      try { await this.callBusinessAction(name, payload); dialog.close(); await this.loadData(); MessageToast.show(successMessage); }
      catch (error) { MessageBox.error(error.message); }
    },

    decideRequestStep: function (step, decision, parentDialog) {
      const comment = new TextArea({ rows: 4, width: '100%', placeholder: decision === 'rejected' ? 'Motif obligatoire' : 'Commentaire de validation' });
      const dialog = new Dialog({ title: decision === 'approved' ? 'Approuver l’étape' : 'Rejeter la demande', content: [new VBox({ items: [new Label({ text: 'Commentaire', required: decision === 'rejected' }), comment] }).addStyleClass('sapUiContentPadding')],
        beginButton: new Button({ text: 'Confirmer', type: decision === 'approved' ? 'Accept' : 'Reject', press: async () => {
          if (decision === 'rejected' && !comment.getValue().trim()) return MessageBox.warning('Le motif du rejet est obligatoire.');
          try { await this.callBusinessAction('decideApproval', { stepID: step.ID, decision, comment: comment.getValue().trim() }); dialog.close(); parentDialog.close(); await this.loadData(); MessageToast.show('Étape traitée'); }
          catch (error) { MessageBox.error(error.message); }
        } }), endButton: new Button({ text: 'Annuler', press: () => dialog.close() }), afterClose: () => dialog.destroy()
      });
      dialog.open();
    },

    onEditReview: function (event) {
      const review = event.getSource().getBindingContext('app').getObject();
      const commentInput = new TextArea({ value: review.comment === 'Aucun commentaire' ? '' : review.comment, rows: 4, width: '100%' });
      const decision = new sap.m.SegmentedButton({ selectedKey: review.status, items: [
        new sap.m.SegmentedButtonItem({ key: 'approved', text: 'Approuver', icon: 'sap-icon://accept' }),
        new sap.m.SegmentedButtonItem({ key: 'rejected', text: 'Rejeter', icon: 'sap-icon://decline' })
      ] });
      const dialog = new Dialog({ title: `Modifier ${review.orderNumber}`, contentWidth: '32rem', content: [new VBox({ items: [new Label({ text: 'Décision' }), decision, new Label({ text: 'Commentaire' }).addStyleClass('sapUiSmallMarginTop'), commentInput] }).addStyleClass('sapUiContentPadding')],
        beginButton: new Button({ text: 'Enregistrer', type: 'Emphasized', press: async () => {
          const status = decision.getSelectedKey();
          const comment = commentInput.getValue().trim();
          if (status === 'rejected' && !comment) return MessageBox.warning('Le commentaire est obligatoire pour un rejet.');
          const response = await this.apiFetch(`/Reviews(${review.ID})`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, comment }) });
          if (!response.ok) return MessageBox.error((await response.json().catch(() => ({}))).error?.message || `Erreur HTTP ${response.status}`);
          dialog.close(); await this.loadData(); MessageToast.show('Décision mise à jour');
        } }),
        endButton: new Button({ text: 'Annuler', press: () => dialog.close() }), afterClose: () => dialog.destroy()
      });
      dialog.open();
    },

    onDeleteReview: function (event) {
      const review = event.getSource().getBindingContext('app').getObject();
      MessageBox.confirm(`Supprimer la décision de la commande ${review.orderNumber} ?`, {
        title: 'Confirmer la suppression', emphasizedAction: MessageBox.Action.OK,
        onClose: async action => {
          if (action !== MessageBox.Action.OK) return;
          const response = await this.apiFetch(`/Reviews(${review.ID})`, { method: 'DELETE' });
          if (!response.ok) return MessageBox.error(`Suppression impossible (HTTP ${response.status}).`);
          await this.loadData(); MessageToast.show('Décision supprimée');
        }
      });
    }
  });
});
