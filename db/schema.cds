namespace procurement;

using { cuid, managed } from '@sap/cds/common';

type ReviewStatus : String(20) enum {
  pending;
  approved;
  rejected;
}

type Priority : String(20) enum {
  low;
  medium;
  high;
  critical;
}

type RequestStatus : String(25) enum {
  draft;
  submitted;
  inApproval;
  approved;
  rejected;
  converted;
}

type StepStatus : String(20) enum {
  waiting;
  active;
  approved;
  rejected;
}

type RiskLevel : String(20) enum {
  low;
  medium;
  high;
  critical;
}

@assert.unique.supplierNumber: [supplierNumber]
entity Suppliers : cuid, managed {
  supplierNumber : String(10) not null;
  name           : String(120) not null;
  country        : String(3);
  category       : String(60);
  qualityScore   : Decimal(5,2) default 80;
  deliveryScore  : Decimal(5,2) default 80;
  riskLevel      : RiskLevel default #low;
  blocked        : Boolean default false;
  complianceValidUntil : Date;
  requests       : Association to many PurchaseRequests on requests.supplier = $self;
}

entity CostCenters {
  key code       : String(20);
  name           : String(100);
  department     : String(80);
  manager        : String(100);
}

@assert.unique.fiscalCostCenter: [fiscalYear, costCenter]
entity Budgets : cuid, managed {
  fiscalYear : Integer not null;
  costCenter : Association to CostCenters not null;
  allocated  : Decimal(15,2) not null;
  committed  : Decimal(15,2) default 0;
  consumed   : Decimal(15,2) default 0;
  currency   : String(3) default 'MAD';
}

@assert.unique.requestNumber: [requestNumber]
entity PurchaseRequests : cuid, managed {
  requestNumber         : String(12) not null;
  title                 : String(160) not null;
  requester             : String(100);
  department            : String(80);
  costCenterCode        : String(20);
  fiscalYear            : Integer not null;
  supplier              : Association to Suppliers;
  status                : RequestStatus default #draft;
  priority              : Priority default #medium;
  totalAmount           : Decimal(15,2) default 0;
  currency              : String(3) default 'MAD';
  desiredDeliveryDate   : Date;
  justification         : String(500);
  riskScore             : Integer default 0;
  riskLevel             : RiskLevel default #low;
  riskExplanation       : String(500);
  currentApprovalLevel  : Integer default 0;
  submittedAt           : Timestamp;
  convertedOrderNumber  : String(10);
  items                 : Composition of many RequestItems on items.request = $self;
  approvalSteps         : Composition of many ApprovalSteps on approvalSteps.request = $self;
}

entity RequestItems : cuid, managed {
  request      : Association to PurchaseRequests not null;
  position     : Integer;
  description  : String(200) not null;
  category     : String(60);
  quantity     : Decimal(13,3) not null;
  unit         : String(5) default 'EA';
  unitPrice    : Decimal(15,2) not null;
  amount       : Decimal(15,2);
}

@assert.unique.requestSequence: [request, sequence]
entity ApprovalSteps : cuid, managed {
  request       : Association to PurchaseRequests not null;
  sequence      : Integer not null;
  role          : String(40) not null;
  label         : String(100);
  approver      : String(100);
  status        : StepStatus default #waiting;
  dueAt         : Timestamp;
  decidedAt     : Timestamp;
  comment       : String(500);
}

entity WorkflowRules : cuid, managed {
  name          : String(100);
  minAmount     : Decimal(15,2) default 0;
  maxAmount     : Decimal(15,2);
  requiredRole  : String(40);
  sequence      : Integer;
  minRiskLevel  : RiskLevel;
  triggerMode   : String(10) default 'all';
  active        : Boolean default true;
}

type CommitmentStatus : String(20) enum {
  active;
  released;
  consumed;
}

@assert.unique.requestCommitment: [request]
entity BudgetCommitments : cuid, managed {
  request     : Association to PurchaseRequests not null;
  budget      : Association to Budgets not null;
  amount      : Decimal(15,2) not null;
  currency    : String(3) not null;
  status      : CommitmentStatus default #active;
  reservedAt  : Timestamp;
  releasedAt  : Timestamp;
  consumedAt  : Timestamp;
}

entity AuditEvents : cuid {
  entityType : String(40);
  entityID   : String(80);
  action     : String(40);
  actor      : String(100);
  details    : String(1000);
  occurredAt : Timestamp;
}

entity Notifications : cuid, managed {
  recipient : String(100);
  title     : String(160);
  message   : String(500);
  severity  : String(20) default 'Information';
  isRead    : Boolean default false;
  dueAt     : Timestamp;
  request   : Association to PurchaseRequests;
}

@assert.unique.orderNumber: [orderNumber]
entity PurchaseOrders : cuid, managed {
  orderNumber : String(10)  @title: 'Commande';
  supplier    : String(100) @title: 'Fournisseur';
  orderDate   : Date        @title: 'Date';
  amount      : Decimal(15,2) @title: 'Montant';
  currency    : String(3)   @title: 'Devise';
  category    : String(60)  @title: 'Catégorie';
  buyer       : String(100) @title: 'Acheteur';
  description : String(255) @title: 'Description';
  requestingDepartment : String(80)  @title: 'Département demandeur';
  costCenter            : String(20)  @title: 'Centre de coûts';
  priority              : Priority default #medium @title: 'Priorité';
  requestedBy           : String(100) @title: 'Demandeur';
  requiredDeliveryDate  : Date        @title: 'Livraison souhaitée';
  businessJustification : String(500) @title: 'Justification métier';
  reviews     : Composition of many Reviews on reviews.purchaseOrder = $self;
}

@assert.unique.purchaseOrderNumber: [purchaseOrderNumber]
entity Reviews : cuid, managed {
  // L'association est renseignée en mode local. En mode S/4 distant, la
  // commande n'est pas copiée dans SQLite : son numéro SAP suffit.
  purchaseOrder       : Association to PurchaseOrders;
  purchaseOrderNumber : String(10) not null @title: 'Commande SAP';
  status        : ReviewStatus default #pending;
  comment       : String(500);
  reviewer      : String(100);
  decisionAt    : Timestamp;
}
