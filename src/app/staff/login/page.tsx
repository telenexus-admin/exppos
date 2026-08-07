import { TenantLoginForm } from "../../login/tenant-login-form";

export default function StaffLogin() {
  return (
    <main className="auth tenant-auth staff-auth">
      <section className="auth-copy">
        <a className="brand" href="/">Speedyhive<span>Cloud POS</span></a>
        <h1>Work your shift with confidence.</h1>
        <p>Access your assigned sales workspace, shift and branch tools securely.</p>
      </section>
      <TenantLoginForm mode="staff" />
    </main>
  );
}
