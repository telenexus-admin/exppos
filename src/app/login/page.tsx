import { LoginForm } from "./login-form";

export default function Login() {
  return (
    <main className="auth">
      <section className="auth-copy">
        <a className="brand" href="/">Speedyhive<span>Cloud POS</span></a>
        <h1>Run every branch with clarity.</h1>
        <p>Sales, stock, staff and financial controls in one secure workspace.</p>
      </section>
      <LoginForm />
    </main>
  );
}
