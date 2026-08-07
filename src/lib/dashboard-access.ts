export const DASHBOARD_MANAGER_ROLE_PREFIX = "DASHBOARD_MANAGER_";

export const DASHBOARD_SECTION_SLUGS = [
  "dashboard",
  "pos",
  "products",
  "inventory",
  "branches",
  "staff",
  "customers",
  "purchases",
  "sales",
  "invoices",
  "accounting",
  "expenses",
  "reports",
  "tasks",
  "audit-logs",
  "settings",
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTION_SLUGS)[number];

export type DashboardSectionOption = {
  slug: DashboardSection;
  label: string;
  description: string;
  permissions: readonly string[];
};

export const DASHBOARD_SECTION_OPTIONS: readonly DashboardSectionOption[] = [
  { slug: "dashboard", label: "Dashboard", description: "Business overview for assigned branches.", permissions: [] },
  { slug: "pos", label: "Point of Sale", description: "Open shifts, process sales and receive payments.", permissions: ["sale.create", "sale.view", "product.view", "inventory.view", "customer.view", "shift.open", "shift.close", "payment.receive"] },
  { slug: "products", label: "Products", description: "View, create and update products.", permissions: ["product.view", "product.create", "product.update", "inventory.view"] },
  { slug: "inventory", label: "Inventory", description: "View stock, adjustments and transfers.", permissions: ["product.view", "inventory.view", "inventory.adjust", "inventory.transfer"] },
  { slug: "branches", label: "Branches", description: "View and update assigned branch information.", permissions: ["branch.view", "branch.update"] },
  { slug: "staff", label: "Staff", description: "View and manage staff in assigned branches.", permissions: ["staff.view", "staff.create", "staff.update", "staff.assign_role"] },
  { slug: "customers", label: "Customers", description: "Create and manage customer accounts.", permissions: ["customer.view", "customer.create", "customer.update", "customer.archive"] },
  { slug: "purchases", label: "Purchases", description: "Create and approve purchases for assigned branches.", permissions: ["purchase.create", "purchase.approve", "product.view", "inventory.view"] },
  { slug: "sales", label: "Sales", description: "View sales, refunds, discounts and payment activity.", permissions: ["sale.view", "sale.discount", "sale.override_price", "sale.void", "sale.refund", "payment.receive"] },
  { slug: "invoices", label: "Invoices", description: "View receivables and receive customer payments.", permissions: ["sale.view", "customer.view", "payment.receive"] },
  { slug: "accounting", label: "Accounting", description: "Financial journals and accounting management.", permissions: ["accounting.manage", "report.financial"] },
  { slug: "expenses", label: "Expenses", description: "Record, review and void branch expenses.", permissions: ["expense.manage"] },
  { slug: "reports", label: "Reports", description: "Operational and financial reports for assigned branches.", permissions: ["report.view", "report.financial"] },
  { slug: "tasks", label: "Tasks", description: "Operational task and approval workspace.", permissions: ["manager.approve"] },
  { slug: "audit-logs", label: "Audit Logs", description: "View tenant audit activity.", permissions: ["audit.view"] },
  { slug: "settings", label: "Settings", description: "Manage tenant business and POS settings.", permissions: ["settings.manage"] },
] as const;

const DASHBOARD_SECTION_SET = new Set<string>(DASHBOARD_SECTION_SLUGS);

export function isDashboardSection(value: string): value is DashboardSection {
  return DASHBOARD_SECTION_SET.has(value);
}

export function normalizeDashboardSections(values: readonly string[]): DashboardSection[] {
  const selected = new Set<DashboardSection>(["dashboard"]);
  for (const value of values) if (isDashboardSection(value)) selected.add(value);
  return DASHBOARD_SECTION_SLUGS.filter((slug) => selected.has(slug));
}

export function dashboardSectionMarker(section: DashboardSection) {
  return `dashboard.section.${section}` as const;
}

export function isDashboardSectionMarker(value: string) {
  return value.startsWith("dashboard.section.") && isDashboardSection(value.slice("dashboard.section.".length));
}

export function isDashboardManagerRoleCode(code: string) {
  return code.startsWith(DASHBOARD_MANAGER_ROLE_PREFIX);
}

export function dashboardManagerRoleCode(username: string) {
  const safe = username.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "USER";
  return `${DASHBOARD_MANAGER_ROLE_PREFIX}${safe}`;
}

export function permissionCodesForDashboardSections(values: readonly string[]) {
  const sections = normalizeDashboardSections(values);
  const permissions = new Set<string>();
  for (const section of sections) {
    permissions.add(dashboardSectionMarker(section));
    const option = DASHBOARD_SECTION_OPTIONS.find((item) => item.slug === section);
    for (const permission of option?.permissions ?? []) permissions.add(permission);
  }
  return { sections, permissions: [...permissions] };
}

export function dashboardSectionsFromPermissions(permissions: Iterable<string>) {
  const markers = new Set<string>();
  for (const permission of permissions) if (isDashboardSectionMarker(permission)) markers.add(permission);
  return DASHBOARD_SECTION_SLUGS.filter((section) => markers.has(dashboardSectionMarker(section)));
}
