using { procurement as db } from '../db/schema';

@path: '/procurement'
@requires: 'authenticated-user'
service ProcurementService {
  type CurrentUser {
    id         : String;
    canApprove : Boolean;
    isAdmin    : Boolean;
    roles      : many String;
  }

  function me() returns CurrentUser;

  type SystemInfo {
    mode        : String;
    sourceLabel : String;
    remote      : Boolean;
  }

  type Dashboard {
    requests        : Integer;
    pendingSteps    : Integer;
    highRisk        : Integer;
    overdueSteps    : Integer;
    budgetAllocated : Decimal(15,2);
    budgetCommitted : Decimal(15,2);
    budgetConsumed  : Decimal(15,2);
    budgetCurrency  : String(5);
  }

  function systemInfo() returns SystemInfo;
  function dashboard() returns Dashboard;
  action submitRequest(requestID: UUID) returns PurchaseRequests;
  action decideApproval(stepID: UUID, decision: String, comment: String) returns PurchaseRequests;
  action convertRequest(requestID: UUID) returns PurchaseRequests;

  @readonly
  @restrict: [
    { grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }
  ]
  entity PurchaseOrders as projection on db.PurchaseOrders {
    *,
    virtual sourceSystem : String(20)
  };

  @restrict: [
    { grant: 'READ',   to: ['Viewer', 'Approver', 'Admin'] },
    { grant: 'CREATE', to: ['Approver', 'Admin'] },
    { grant: ['UPDATE', 'DELETE'], to: 'Admin' }
  ]
  entity Reviews as projection on db.Reviews;

  @restrict: [
    { grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] },
    { grant: ['CREATE', 'UPDATE'], to: ['Approver', 'Admin'] },
    { grant: 'DELETE', to: 'Admin' }
  ]
  entity PurchaseRequests as projection on db.PurchaseRequests;

  @restrict: [{ grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }]
  entity RequestItems as projection on db.RequestItems;

  @restrict: [{ grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }]
  entity ApprovalSteps as projection on db.ApprovalSteps;

  @restrict: [{ grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }]
  entity Suppliers as projection on db.Suppliers;

  @restrict: [{ grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }]
  entity CostCenters as projection on db.CostCenters;

  @restrict: [{ grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] }]
  entity Budgets as projection on db.Budgets;

  @restrict: [{ grant: 'READ', to: ['FinanceController', 'PurchasingDirector', 'Admin'] }]
  entity BudgetCommitments as projection on db.BudgetCommitments;

  @readonly entity WorkflowRules as projection on db.WorkflowRules;
  @restrict: [{ grant: 'READ', to: 'Admin' }]
  @readonly entity AuditEvents as projection on db.AuditEvents;

  @restrict: [
    { grant: 'READ', to: ['Viewer', 'Approver', 'Admin'] },
    { grant: 'UPDATE', to: ['Viewer', 'Approver', 'Admin'] }
  ]
  entity Notifications as projection on db.Notifications;
}
