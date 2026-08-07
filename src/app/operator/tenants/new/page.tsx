import { DASHBOARD_SECTION_OPTIONS } from "@/lib/dashboard-access";
import { OperatorShell } from "@/components/operator-shell";

function Field({
  label,
  type = "text",
  name,
  pattern,
  minLength,
  required = true,
}: {
  label: string;
  type?: string;
  name: string;
  pattern?: string;
  minLength?: number;
  required?: boolean;
}) {
  return <label>{label}<input name={name} type={type} pattern={pattern} minLength={minLength} required={required} /></label>;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const defaultManagerTabs = new Set(["dashboard", "pos", "inventory", "customers", "sales", "reports"]);

  return (
    <OperatorShell title="Onboard POS business" current="tenants/new">
      {error && <div className="operator-error" role="alert"><strong>Client was not saved.</strong><span>{error}</span></div>}
      <div className="onboard-layout">
        <form className="onboard-form" action="/api/v1/operator/tenants" method="post">
          <section>
            <div className="form-section-title"><span>1</span><div><h2>Business information</h2><p>Legal and operational details for the client.</p></div></div>
            <div className="form-grid">
              <Field label="Business name" name="businessName" />
              <Field label="Legal business name" name="legalName" />
              <Field label="Business email" name="email" type="email" />
              <Field label="Phone number" name="phone" minLength={7} />
              <label>Country<select name="country"><option>Kenya</option></select></label>
              <Field label="Town / City" name="town" />
              <label className="full">Physical address<input name="address" required /></label>
              <label>Currency<select name="currency"><option value="KES">KES - Kenyan Shilling</option></select></label>
              <label>Timezone<select name="timezone"><option>Africa/Nairobi</option></select></label>
            </div>
          </section>

          <section>
            <div className="form-section-title"><span>2</span><div><h2>Tenant and subscription</h2><p>Platform identity, plan and usage limits.</p></div></div>
            <div className="form-grid">
              <Field label="Tenant code" name="code" />
              <Field label="Tenant slug (lowercase letters, numbers and hyphens)" name="slug" pattern="[a-z0-9-]+" />
              <label>Subscription plan<select name="plan"><option>Starter</option><option>Growth</option><option>Business</option></select></label>
              <label>Initial status<select name="status"><option>Trial</option><option>Active</option></select></label>
              <Field label="Trial end date" name="trialEnd" type="date" />
              <Field label="Receipt display name" name="receiptName" />
            </div>
          </section>

          <section>
            <div className="form-section-title"><span>3</span><div><h2>Primary administrator</h2><p>This first administrator receives full access to the business dashboard.</p></div></div>
            <div className="form-grid">
              <Field label="Administrator full name" name="adminName" />
              <Field label="Administrator email" name="adminEmail" type="email" />
              <Field label="Administrator phone" name="adminPhone" minLength={7} />
              <Field label="Temporary password (minimum 12 characters)" name="temporaryPassword" type="password" minLength={12} />
              <Field label="Secure POS PIN (4-8 digits)" name="adminPin" type="password" pattern="[0-9]{4,8}" />
              <Field label="Head office name" name="branchName" />
              <Field label="Branch code" name="branchCode" />
            </div>
          </section>

          <section>
            <div className="form-section-title"><span>4</span><div><h2>Additional dashboard account</h2><p>Optional. Create a second full administrator or a restricted branch manager during onboarding.</p></div></div>
            <div className="form-grid">
              <label>Additional account type
                <select name="extraAccountType" defaultValue="NONE">
                  <option value="NONE">None — add later</option>
                  <option value="ADMINISTRATOR">Administrator — full dashboard</option>
                  <option value="BRANCH_MANAGER">Branch Manager — selected tabs</option>
                </select>
              </label>
              <Field label="Full name" name="extraName" required={false} />
              <Field label="Login username" name="extraUsername" pattern="[A-Za-z0-9._-]{3,32}" required={false} />
              <Field label="Email address (optional)" name="extraEmail" type="email" required={false} />
              <Field label="Phone number (optional)" name="extraPhone" required={false} />
              <Field label="Temporary password" name="extraPassword" type="password" minLength={12} required={false} />
            </div>

            <div className="secure-note">
              <strong>Branch assignment during onboarding</strong>
              <span>A new branch manager is initially assigned to the head office created above. After onboarding, the operator can assign managers to other branches from the client page.</span>
            </div>

            <div className="operator-access-tab-grid">
              {DASHBOARD_SECTION_OPTIONS.map((option) => (
                <label className="operator-access-check" key={option.slug}>
                  <input
                    type="checkbox"
                    name="extraSections"
                    value={option.slug}
                    defaultChecked={defaultManagerTabs.has(option.slug)}
                    disabled={option.slug === "dashboard"}
                  />
                  {option.slug === "dashboard" && <input type="hidden" name="extraSections" value="dashboard" />}
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </div>
            <small>Tab selections are used only when “Branch Manager” is selected. Full administrators automatically receive the entire dashboard.</small>
          </section>

          <div className="form-submit">
            <a className="manage-link" href="/operator/tenants">Cancel</a>
            <button type="submit" className="operator-primary">Create POS client</button>
          </div>
        </form>

        <aside className="onboard-summary">
          <small>ONBOARDING SUMMARY</small>
          <h3>New POS tenant</h3>
          <p>This workflow creates the tenant, subscription, branch, administrator, permissions and audit records together.</p>
          <ul>
            <li>Tenant business account</li>
            <li>Subscription and plan limits</li>
            <li>Head office branch</li>
            <li>Primary Tenant Administrator</li>
            <li>Optional second administrator / branch manager</li>
            <li>Role and dashboard permissions</li>
          </ul>
          <div className="secure-note"><strong>Atomic transaction</strong><span>If any onboarding step fails, all onboarding records roll back.</span></div>
        </aside>
      </div>
    </OperatorShell>
  );
}
