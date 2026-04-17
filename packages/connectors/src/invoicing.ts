/**
 * Unified Invoicing interface — Visma Spiris and Fortnox both implement this
 * so Invoice Agent and Finance Report Agent don't have to care which provider
 * the tenant uses.
 */
import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface Invoice {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  customer_email?: string;
  issued_at: string;
  due_at: string;
  paid_at?: string;
  amount_total: number;
  amount_paid: number;
  currency: string;
  status: "draft" | "open" | "paid" | "overdue" | "void";
}

export interface InvoicingConnector extends Connector {
  listInvoices(params: {
    status?: Invoice["status"];
    from?: string;
    to?: string;
  }): Promise<Invoice[]>;

  getInvoice(id: string): Promise<Invoice>;

  /** Send a reminder (email + optional SMS) for an unpaid invoice. */
  sendReminder(
    invoiceId: string,
    opts: { level: "friendly" | "firm" | "final"; message?: string },
  ): Promise<{ sent: boolean; channel: string }>;

  /** P&L data for a period (used by Finance Report Agent). */
  getFinancials(params: {
    from: string;
    to: string;
  }): Promise<{
    revenue: number;
    expenses: number;
    outstanding: number;
    currency: string;
  }>;
}

// ============================================================
// Visma Spiris implementation
// ============================================================
class VismaSpirisConnector implements InvoicingConnector {
  readonly kind: IntegrationKind = "visma_spiris";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: {
      access_token: string;
      refresh_token: string;
      company_id: string;
      expires_at: string;
    },
  ) {}

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    // Token refresh omitted here — production would check expires_at first.
    const base = "https://eaccountingapi.vismaonline.com/v2";
    const resp = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.creds.access_token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!resp.ok) {
      throw new Error(`Visma API ${resp.status}: ${await resp.text()}`);
    }
    return resp;
  }

  async healthcheck() {
    try {
      await this.fetch("/companysettings");
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listInvoices(params: { status?: Invoice["status"]; from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params.from) qs.set("$filter", `InvoiceDate ge ${params.from}`);
    const resp = await this.fetch(`/customerinvoices?${qs}`);
    const body = (await resp.json()) as { Data?: VismaInvoiceRow[] };
    return (body.Data ?? []).map(mapVismaInvoice).filter((inv) =>
      params.status ? inv.status === params.status : true,
    );
  }

  async getInvoice(id: string) {
    const resp = await this.fetch(`/customerinvoices/${id}`);
    return mapVismaInvoice((await resp.json()) as VismaInvoiceRow);
  }

  async sendReminder(invoiceId: string, opts: { level: string; message?: string }) {
    await this.fetch(`/customerinvoices/${invoiceId}/send-reminder`, {
      method: "POST",
      body: JSON.stringify({ reminderType: opts.level, message: opts.message }),
    });
    return { sent: true, channel: "email" };
  }

  async getFinancials(params: { from: string; to: string }) {
    const resp = await this.fetch(
      `/accountingreports/profit-and-loss?from=${params.from}&to=${params.to}`,
    );
    const body = (await resp.json()) as {
      Revenue: number;
      Expenses: number;
      Outstanding: number;
      Currency: string;
    };
    return {
      revenue: body.Revenue,
      expenses: body.Expenses,
      outstanding: body.Outstanding,
      currency: body.Currency,
    };
  }
}

interface VismaInvoiceRow {
  Id: string;
  InvoiceNumber: string;
  CustomerId: string;
  CustomerName: string;
  EmailAddress?: string;
  InvoiceDate: string;
  DueDate: string;
  PaidDate?: string;
  TotalAmount: number;
  PaidAmount: number;
  CurrencyCode: string;
  Status: number; // 1 draft, 2 open, 3 paid, 4 overdue, 5 void
}

function mapVismaInvoice(r: VismaInvoiceRow): Invoice {
  const statusMap: Record<number, Invoice["status"]> = {
    1: "draft",
    2: "open",
    3: "paid",
    4: "overdue",
    5: "void",
  };
  return {
    id: r.Id,
    number: r.InvoiceNumber,
    customer_id: r.CustomerId,
    customer_name: r.CustomerName,
    customer_email: r.EmailAddress,
    issued_at: r.InvoiceDate,
    due_at: r.DueDate,
    paid_at: r.PaidDate,
    amount_total: r.TotalAmount,
    amount_paid: r.PaidAmount,
    currency: r.CurrencyCode,
    status: statusMap[r.Status] ?? "open",
  };
}

export const vismaFactory: ConnectorFactory<InvoicingConnector> = {
  kind: "visma_spiris",
  async create({ tenant, credentials }) {
    return new VismaSpirisConnector(
      tenant,
      credentials as VismaSpirisConnector["creds"],
    );
  },
};

// ============================================================
// Fortnox implementation (same interface — different endpoints)
// ============================================================
class FortnoxConnector implements InvoicingConnector {
  readonly kind: IntegrationKind = "fortnox";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { access_token: string; client_secret: string },
  ) {}

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const resp = await fetch(`https://api.fortnox.se/3${path}`, {
      ...init,
      headers: {
        "Access-Token": this.creds.access_token,
        "Client-Secret": this.creds.client_secret,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!resp.ok) throw new Error(`Fortnox ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  async healthcheck() {
    try {
      await this.fetch("/companyinformation");
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listInvoices(params: { status?: Invoice["status"]; from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params.status === "overdue") qs.set("filter", "unpaidoverdue");
    else if (params.status === "paid") qs.set("filter", "fullypaid");
    if (params.from) qs.set("fromdate", params.from);
    if (params.to) qs.set("todate", params.to);
    const resp = await this.fetch(`/invoices?${qs}`);
    const body = (await resp.json()) as { Invoices: FortnoxInvoiceRow[] };
    return body.Invoices.map(mapFortnoxInvoice);
  }

  async getInvoice(id: string) {
    const resp = await this.fetch(`/invoices/${id}`);
    const body = (await resp.json()) as { Invoice: FortnoxInvoiceRow };
    return mapFortnoxInvoice(body.Invoice);
  }

  async sendReminder(invoiceId: string) {
    await this.fetch(`/invoices/${invoiceId}/email`, { method: "GET" });
    return { sent: true, channel: "email" };
  }

  async getFinancials(params: { from: string; to: string }) {
    const resp = await this.fetch(
      `/financialyears/balancelist?fromdate=${params.from}&todate=${params.to}`,
    );
    const body = (await resp.json()) as {
      BalanceList?: Array<{ Account: string; Amount: number }>;
    };
    // Naive summary — real impl would sum by account ranges.
    const revenue = (body.BalanceList ?? [])
      .filter((b) => b.Account.startsWith("3"))
      .reduce((s, b) => s - b.Amount, 0);
    const expenses = (body.BalanceList ?? [])
      .filter((b) => b.Account.startsWith("4") || b.Account.startsWith("5") || b.Account.startsWith("6") || b.Account.startsWith("7"))
      .reduce((s, b) => s + b.Amount, 0);
    return { revenue, expenses, outstanding: 0, currency: "SEK" };
  }
}

interface FortnoxInvoiceRow {
  DocumentNumber: string;
  CustomerNumber: string;
  CustomerName: string;
  EmailInformation?: { EmailAddressTo?: string };
  InvoiceDate: string;
  DueDate: string;
  FinalPayDate?: string;
  Total: number;
  Balance: number;
  Currency: string;
  Cancelled: boolean;
  Sent: boolean;
  Booked: boolean;
}

function mapFortnoxInvoice(r: FortnoxInvoiceRow): Invoice {
  const due = new Date(r.DueDate);
  const overdue = !r.FinalPayDate && due < new Date();
  return {
    id: r.DocumentNumber,
    number: r.DocumentNumber,
    customer_id: r.CustomerNumber,
    customer_name: r.CustomerName,
    customer_email: r.EmailInformation?.EmailAddressTo,
    issued_at: r.InvoiceDate,
    due_at: r.DueDate,
    paid_at: r.FinalPayDate,
    amount_total: r.Total,
    amount_paid: r.Total - r.Balance,
    currency: r.Currency,
    status: r.Cancelled
      ? "void"
      : r.FinalPayDate
        ? "paid"
        : overdue
          ? "overdue"
          : r.Sent
            ? "open"
            : "draft",
  };
}

export const fortnoxFactory: ConnectorFactory<InvoicingConnector> = {
  kind: "fortnox",
  async create({ tenant, credentials }) {
    return new FortnoxConnector(tenant, credentials as FortnoxConnector["creds"]);
  },
};
