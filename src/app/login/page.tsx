import { TenantLoginForm } from "./tenant-login-form";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; switch?: string }>;
}) {
  const query = await searchParams;

  return (
    <main className="auth">
      <section className="auth-copy">
        <a className="brand" href="/">Speedyhive<span>Cloud POS</span></a>
        <h1>Run every branch with clarity.</h1>
        <p>Sales, stock, staff and financial controls in one secure workspace.</p>
      </section>
      <TenantLoginForm
        initialBusinessKey={query.business ?? ""}
        switching={query.switch === "1"}
      />
    </main>
  );
}
