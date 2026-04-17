import type { AgentDefinition, AgentKind } from "@agent-hub/core";
import { invoiceAgent } from "./invoice/index.js";
import { financeReportAgent } from "./finance-report/index.js";
import { salesAgent } from "./sales/index.js";
import { clientStatusAgent } from "./client-status/index.js";
import { devSupportAgent } from "./dev-support/index.js";
import { projectAgent } from "./project/index.js";
import { marketingAgent } from "./marketing/index.js";

export const AGENT_REGISTRY: Record<AgentKind, AgentDefinition> = {
  invoice: invoiceAgent,
  finance_report: financeReportAgent,
  sales: salesAgent,
  client_status: clientStatusAgent,
  dev_support: devSupportAgent,
  project: projectAgent,
  marketing: marketingAgent,
};

export {
  invoiceAgent,
  financeReportAgent,
  salesAgent,
  clientStatusAgent,
  devSupportAgent,
  projectAgent,
  marketingAgent,
};
