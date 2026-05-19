// QBO API base types
export type QBORef = {
  value: string;
  name?: string;
}

export type QBOAddress = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string; // state
  PostalCode?: string;
  Country?: string;
}

export type QBOEmailAddress = {
  Address?: string;
}

export type QBOPhoneNumber = {
  FreeFormNumber?: string;
}

// QBO Customer (maps from MGR Customer)
export type QBOCustomer = {
  Id?: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: QBOEmailAddress;
  PrimaryPhone?: QBOPhoneNumber;
  BillAddr?: QBOAddress;
  Taxable?: boolean;
  SyncToken?: string;
  sparse?: boolean;
}

// QBO Vendor (maps from MGR Supplier)
export type QBOVendor = {
  Id?: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: QBOEmailAddress;
  PrimaryPhone?: QBOPhoneNumber;
  SyncToken?: string;
  sparse?: boolean;
}

// QBO Invoice line
export type QBOInvoiceLine = {
  Amount: number;
  Description?: string;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: {
    Qty?: number;
    UnitPrice?: number;
  };
}

// QBO Invoice (maps from MGR Order)
export type QBOInvoice = {
  Id?: string;
  DocNumber?: string;
  CustomerRef: QBORef;
  TxnDate?: string;
  DueDate?: string;
  Line: QBOInvoiceLine[];
  SyncToken?: string;
  sparse?: boolean;
}

// QBO Bill line
export type QBOBillLine = {
  Amount: number;
  Description?: string;
  DetailType: "AccountBasedExpenseLineDetail";
  AccountBasedExpenseLineDetail: {
    AccountRef: QBORef;
  };
}

// QBO Bill (maps from MGR Purchase Order)
export type QBOBill = {
  Id?: string;
  DocNumber?: string;
  VendorRef: QBORef;
  TxnDate?: string;
  DueDate?: string;
  Line: QBOBillLine[];
  SyncToken?: string;
  sparse?: boolean;
}

// QBO Account (chart of accounts)
export type QBOAccount = {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  CurrentBalance?: number;
  Active?: boolean;
}

// QBO Company Info
export type QBOCompanyInfo = {
  CompanyName: string;
  Country?: string;
}

// API response wrapper
export type QBOQueryResponse<T> = {
  QueryResponse: {
    [key: string]: T[] | number | undefined;
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

export type QBOEntityResponse<T> = {
  [key: string]: T;
}

// Sync types for internal use
export type SyncEntityType = "customer" | "supplier" | "order" | "purchase_order";
export type QBOEntityType = "Customer" | "Vendor" | "Invoice" | "Bill";
export type SyncAction = "create" | "update" | "retry";
export type SyncStatus = "pending" | "success" | "error";

export type SyncMapping = {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  qbo_entity_type: QBOEntityType;
  qbo_entity_id: string;
  last_synced_at: string;
}

export type SyncLogEntry = {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncAction;
  status: SyncStatus;
  error_message?: string;
  request_payload?: unknown;
  response_payload?: unknown;
  created_at: string;
  completed_at?: string;
}
