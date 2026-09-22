import type { Row } from "decidr-ts";

// Generates a realistic ~150-option support taxonomy as a real 2-level id
// hierarchy, so the scale demo shows decidr resolving a genuinely large
// option set via a handful of small races instead of one impossible
// 150-way race that no top_logprobs window could see all of at once.

const DEPARTMENTS: Record<string, string[]> = {
  billing: ["refund", "dispute", "subscription", "invoice", "tax", "proration", "chargeback", "trial", "upgrade", "downgrade"],
  shipping: ["delay", "lost", "damaged", "wrong_item", "customs", "address", "tracking", "carrier", "packaging", "return_label"],
  account: ["login", "password", "twofactor", "email_change", "deletion", "export", "merge", "suspension", "verification", "permissions"],
  technical: ["crash", "slow", "sync", "offline", "export_fail", "import_fail", "notification", "search", "upload", "api_error"],
  product: ["feature_request", "bug_report", "compatibility", "documentation", "pricing", "comparison", "roadmap", "beta", "deprecation", "migration"],
  legal: ["privacy", "terms", "gdpr", "data_request", "compliance", "contract", "liability", "ip_claim", "subpoena", "audit"],
  sales: ["quote", "demo", "renewal", "discount", "enterprise", "partnership", "reseller", "trial_extension", "procurement", "contract_review"],
  community: ["moderation", "spam", "harassment", "content_removal", "appeal", "guidelines", "feature_feedback", "bug_triage", "translation", "accessibility"],
  hr: ["recruiting", "onboarding", "benefits", "payroll_question", "leave_request", "training", "conduct_report", "exit", "referral", "equipment"],
  infra: ["outage", "latency", "security_incident", "backup_fail", "capacity", "deploy_fail", "monitoring", "cost_spike", "certificate", "dns"],
  marketing: ["campaign", "brand", "social_media", "press", "event", "sponsorship", "content_review", "seo", "email_deliverability", "analytics"],
  legal2: ["employment_dispute", "vendor_contract", "trademark", "patent", "regulatory", "litigation", "settlement", "insurance", "arbitration", "notarization"],
  finance: ["expense_report", "reimbursement", "budget", "forecast", "audit_request", "vendor_payment", "payroll_run", "tax_filing", "investment", "grant"],
  design: ["ui_bug", "accessibility_review", "brand_asset", "prototype_feedback", "user_research", "icon_request", "style_guide", "motion", "illustration", "copy_review"],
  research: ["survey", "interview", "usability_test", "data_analysis", "competitive_analysis", "market_sizing", "experiment_design", "report_review", "citation", "methodology"],
};

function describe(dept: string, sub: string): string {
  return `${sub.replace(/_/g, " ")} issue under the ${dept} department`;
}

export function buildScaleRow(): Row {
  const options = [];
  for (const [dept, subs] of Object.entries(DEPARTMENTS)) {
    for (const sub of subs) {
      options.push({ id: `${dept}_${sub}`, description: describe(dept, sub) });
    }
  }
  return {
    id: "scale-1",
    state:
      'Internal message: "The nightly data sync job has been failing for two days, and now the export button ' +
      'in the dashboard is timing out too. A few customers are asking why their reports look stale."',
    question: "Which team and category should this be routed to?",
    options,
  };
}
