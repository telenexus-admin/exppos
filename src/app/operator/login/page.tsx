import { Suspense } from "react";
import { OperatorLoginForm } from "./operator-login-form";
export default function OperatorLogin(){return <main className="auth operator"><section className="auth-copy"><a className="brand" href="/">Speedyhive<span>Operator Console</span></a><h1>Platform control, without tenant exposure.</h1><p>Onboard and manage subscriptions through a separately secured operator context.</p></section><Suspense fallback={<div className="login-card">Loading secure loginâ€¦</div>}><OperatorLoginForm/></Suspense></main>}
