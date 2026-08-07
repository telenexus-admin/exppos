"use client";

import { useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import type { PaymentMethod } from "@/server/settings/tenant-settings";

export type PosProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  imageData: string | null;
  category: string;
  price: number;
  taxRate: number;
  quantity: number;
  trackStock: boolean;
};

export type PosCustomer = {
  id: string;
  name: string;
  number: string;
  phone: string | null;
  creditLimit: number;
  outstandingBalance: number;
};

export type PosBehavior = {
  enabledPaymentMethods: PaymentMethod[];
  requireReferenceForNonCash: boolean;
  confirmBeforePayment: boolean;
  taxEnabled: boolean;
  pricesIncludeTax: boolean;
  showTaxBreakdown: boolean;
  mpesaType: "Till" | "Paybill";
  mpesaNumber: string;
  mpesaAccountInstructions: string;
};

type CartLine = { productId: string; quantity: number };

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function PosTerminal({
  products,
  customers,
  branchId,
  branchName,
  shiftId,
  cashierName,
  currency,
  canSell,
  returnPath,
  behavior,
  branches,
  canSelectBranch,
}: {
  products: PosProduct[];
  customers: PosCustomer[];
  branchId: string | null;
  branchName: string;
  shiftId: string | null;
  cashierName: string;
  currency: string;
  canSell: boolean;
  returnPath: string;
  behavior: PosBehavior;
  branches: { id: string; name: string; code: string }[];
  canSelectBranch: boolean;
}) {
  const paymentMethods = behavior.enabledPaymentMethods.length > 0 ? behavior.enabledPaymentMethods : ["Cash" as const];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All items");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [stock, setStock] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((product) => [product.id, product.quantity])),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(paymentMethods[0]);
  const [customerId, setCustomerId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [closingCash, setClosingCash] = useState("0");
  const [closingShift, setClosingShift] = useState(false);
  const [closeError, setCloseError] = useState("");

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const categories = useMemo(
    () => ["All items", ...Array.from(new Set(products.map((product) => product.category))).sort()],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatches = category === "All items" || product.category === category;
      const searchMatches = !needle || [product.name, product.sku, product.barcode ?? ""].some((value) => value.toLowerCase().includes(needle));
      return categoryMatches && searchMatches;
    });
  }, [category, products, query]);

  const lines = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const displayedPriceTotal = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const tax = behavior.taxEnabled
    ? lines.reduce((sum, line) => {
        const amount = line.product.price * line.quantity;
        if (line.product.taxRate <= 0) return sum;
        return sum + (behavior.pricesIncludeTax
          ? amount - amount / (1 + line.product.taxRate)
          : amount * line.product.taxRate);
      }, 0)
    : 0;
  const subtotal = behavior.pricesIncludeTax ? displayedPriceTotal - tax : displayedPriceTotal;
  const total = behavior.pricesIncludeTax ? displayedPriceTotal : displayedPriceTotal + tax;

  function addProduct(product: PosProduct) {
    setError("");
    setSuccess("");
    if (!shiftId) {
      setError("Open a shift before adding products to a sale.");
      return;
    }
    if (!canSell) {
      setError("This account does not have permission to process sales.");
      return;
    }

    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      const nextQuantity = (existing?.quantity ?? 0) + 1;
      const available = stock[product.id] ?? 0;
      if (product.trackStock && nextQuantity > available) {
        setError(available <= 0
          ? `${product.name} is out of stock at ${branchName}. The sale cannot continue.`
          : `Only ${available} ${product.name} available at ${branchName}.`);
        return current;
      }
      return existing
        ? current.map((line) => line.productId === product.id ? { ...line, quantity: nextQuantity } : line)
        : [...current, { productId: product.id, quantity: 1 }];
    });
  }

  function setQuantity(productId: string, quantity: number) {
    const product = productMap.get(productId);
    if (!product) return;
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.productId !== productId));
      return;
    }
    const available = stock[productId] ?? 0;
    if (product.trackStock && quantity > available) {
      setError(available <= 0
        ? `${product.name} is out of stock at ${branchName}. The sale cannot continue.`
        : `Only ${available} ${product.name} available at ${branchName}.`);
      return;
    }
    setError("");
    setCart((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line));
  }

  async function completeSale() {
    if (!branchId || !shiftId || lines.length === 0 || !canSell) return;
    const unavailableLine = lines.find(
      (line) => line.product.trackStock && line.quantity > (stock[line.product.id] ?? 0),
    );
    if (unavailableLine) {
      const available = stock[unavailableLine.product.id] ?? 0;
      setError(available <= 0
        ? `${unavailableLine.product.name} is out of stock at ${branchName}. Remove it before payment.`
        : `Only ${available} ${unavailableLine.product.name} available at ${branchName}. Reduce the quantity before payment.`);
      return;
    }
    if (paymentMethod === "Credit" && !selectedCustomer) {
      setError(customers.length ? "Select the customer who will pay later." : "No customers are available. Ask the administrator to add a customer first.");
      return;
    }
    if (paymentMethod === "Credit" && selectedCustomer?.creditLimit && selectedCustomer.outstandingBalance + total > selectedCustomer.creditLimit) {
      setError(`${selectedCustomer.name}'s pay-later limit would be exceeded by this sale.`);
      return;
    }
    if (behavior.requireReferenceForNonCash && paymentMethod !== "Cash" && paymentMethod !== "Credit" && !paymentReference.trim()) {
      setError(`Enter the ${paymentMethod} transaction reference before completing the sale.`);
      return;
    }
    const paymentLabel = paymentMethod === "Credit" ? `Customer — Pay Later for ${selectedCustomer?.name}` : paymentMethod;
    if (behavior.confirmBeforePayment && !window.confirm(`Record this ${paymentLabel} sale for ${money(total, currency)}?`)) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await authenticatedFetch("/api/v1/app/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          shiftId,
          customerId: paymentMethod === "Credit" ? customerId : undefined,
          idempotencyKey: crypto.randomUUID(),
          items: lines.map((line) => ({
            productId: line.product.id,
            quantity: String(line.quantity),
            unitPrice: line.product.price.toFixed(2),
          })),
          payments: [{
            method: paymentMethod,
            amount: total.toFixed(2),
            externalReference: paymentReference.trim() || undefined,
          }],
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "The sale could not be completed.");
        return;
      }

      setStock((current) => {
        const next = { ...current };
        for (const line of lines) {
          if (line.product.trackStock) next[line.product.id] = (next[line.product.id] ?? 0) - line.quantity;
        }
        return next;
      });
      setCart([]);
      setPaymentReference("");
      if (paymentMethod === "Credit") setCustomerId("");
      setCheckoutOpen(false);
      setSuccess(paymentMethod === "Credit" ? `Sale ${body?.saleNumber ?? "completed"} was added to ${selectedCustomer?.name}'s pay-later account.` : `Sale ${body?.saleNumber ?? "completed"} was recorded successfully.`);
    } catch {
      setError("The POS could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function closeShift() {
    if (!shiftId || closingShift) return;
    if (cart.length > 0) { setCloseError("Clear or complete the current order before closing the shift."); return; }
    const countedCash = Number(closingCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) { setCloseError("Enter a valid closing cash amount."); return; }
    setClosingShift(true); setCloseError("");
    try {
      const response = await authenticatedFetch("/api/v1/staff/shifts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shiftId, closingCash: countedCash }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setCloseError(body?.error?.message ?? "The shift could not be closed."); return; }
      window.location.assign(returnPath);
    } catch { setCloseError("The server could not be reached. Check the connection and try again."); }
    finally { setClosingShift(false); }
  }

  return (
    <main className="pos live-pos">
      <header>
        <a className="brand" href={returnPath}>Speedyhive<span>{branchName}</span></a>
        <input className="pos-global-search" aria-label="Search products" type="search" placeholder="Scan barcode or search name / SKU…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        <div className="pos-user-actions"><div className="cashier"><span className="status-dot" />{cashierName}</div>{shiftId && <button type="button" className="pos-close-shift-button" onClick={() => { setCloseError(""); setCloseOpen(true); }}>Close shift</button>}<a href="/api/v1/auth/logout">Log out</a></div>
      </header>

      <section className="catalog">
        <div className="pos-context-row">
          <div><small>ACTIVE BRANCH</small><strong>{branchName}</strong></div>
          {branches.length > 1 && (canSelectBranch ? (
            <form className="pos-branch-selector" action="/app/pos" method="get">
              <label htmlFor="pos-branch">View inventory for</label>
              <select id="pos-branch" name="branch" defaultValue={branchId ?? ""}>
                {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name} ({branch.code})</option>)}
              </select>
              <button type="submit">Switch branch</button>
            </form>
          ) : <small className="pos-branch-locked">Branch locked to the open shift</small>)}
          <span className={shiftId ? "pos-shift-ready" : "pos-shift-required"}>{shiftId ? "Shift open" : "Shift required"}</span>
        </div>
        {!shiftId && <div className="pos-alert"><div><strong>Open a shift to start selling</strong><span>The live inventory is visible below, but checkout is locked until a shift is opened.</span></div><a href="/staff/dashboard">Open shift</a></div>}
        {error && <p className="pos-message pos-error" role="alert">{error}</p>}
        {success && <p className="pos-message pos-success" role="status">{success}</p>}

        <div className="pos-product-search"><label htmlFor="pos-product-search">Find a product</label><div><input id="pos-product-search" type="search" placeholder="Search by product, SKU or barcode" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery("")}>Clear</button>}</div></div>

        <div className="category-row">{categories.map((item) => <button className={category === item ? "active" : ""} type="button" onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
        {filteredProducts.length === 0 ? (
          <div className="pos-empty"><span>0</span><h2>No inventory products found</h2><p>Add products and allocate stock to {branchName}. They will appear here automatically.</p></div>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const available = stock[product.id] ?? 0;
              const unavailable = product.trackStock && available <= 0;
              const inCart = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
              return <button className={`product${inCart > 0 ? " product--in-cart" : ""}`} type="button" onClick={() => addProduct(product)} disabled={unavailable} key={product.id}>{product.imageData ? <img className="product-image" src={product.imageData} alt="" /> : <span>{product.name.slice(0, 1).toUpperCase()}</span>}<strong>{product.name}</strong><small>{money(product.price, currency)}</small><em>{product.trackStock ? (unavailable ? "Out of stock" : `${available} in stock`) : "Service / unlimited"}</em><i>{product.sku}</i>{inCart > 0 && <b className="product-cart-count" aria-label={`${inCart} ${product.name} in current order`}>{inCart}</b>}</button>;
            })}
          </div>
        )}
      </section>

      <aside className="cart pos-checkout-bar">
        <div className="pay-actions"><button type="button" onClick={() => { setCart([]); setError(""); setSuccess(""); }} disabled={lines.length === 0}>Cancel</button><button className="primary" type="button" onClick={() => { setError(""); setCheckoutOpen(true); }} disabled={loading || lines.length === 0 || !shiftId || !canSell}>{loading ? "Processing…" : `Pay ${money(total, currency)}`}</button></div>
      </aside>
      {checkoutOpen && <div className="pos-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-payment-title"><button className="pos-checkout-backdrop" type="button" aria-label="Close payment options" onClick={() => !loading && setCheckoutOpen(false)} /><div className="pos-checkout-card"><div className="pos-checkout-heading"><div><small>PAYMENT</small><h2 id="checkout-payment-title">Choose payment method</h2></div><button type="button" aria-label="Close payment options" onClick={() => !loading && setCheckoutOpen(false)}>×</button></div>
        <div className="payment-fields">
          <label>Payment method<select value={paymentMethod} onChange={(event) => { const method = event.target.value as PaymentMethod; setPaymentMethod(method); setPaymentReference(""); if (method !== "Credit") setCustomerId(""); }}>{paymentMethods.map((method) => <option key={method} value={method}>{method === "Credit" ? "Customer — Pay Later" : method}</option>)}</select></label>
          {paymentMethod === "Credit" && <div className="pos-customer-credit"><label>Select customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required><option value="">Select an existing customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone || customer.number}</option>)}</select></label>{selectedCustomer && <div><span>Current balance <strong>{money(selectedCustomer.outstandingBalance, currency)}</strong></span><span>Credit limit <strong>{selectedCustomer.creditLimit > 0 ? money(selectedCustomer.creditLimit, currency) : "No fixed limit"}</strong></span><small>This sale will appear in the customer&apos;s purchase and pay-later history.</small></div>}{customers.length === 0 && <p>No customers found. An administrator must add one from the Customers tab.</p>}</div>}
          {paymentMethod === "Mobile Money" && behavior.mpesaNumber && (
            <div className="pos-payment-instructions">
              <small>M-PESA {behavior.mpesaType.toUpperCase()}</small>
              <strong>{behavior.mpesaNumber}</strong>
              {behavior.mpesaAccountInstructions && <span>{behavior.mpesaAccountInstructions}</span>}
            </div>
          )}
          {paymentMethod !== "Cash" && paymentMethod !== "Credit" && <label>Payment reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} required={behavior.requireReferenceForNonCash} placeholder="Receipt / transaction reference" /></label>}
        </div>
        {error && <p className="pos-close-error" role="alert">{error}</p>}
        <div className="pos-checkout-actions"><button type="button" onClick={() => setCheckoutOpen(false)} disabled={loading}>Back</button><button className="primary" type="button" onClick={completeSale} disabled={loading || lines.length === 0}>{loading ? "Processing…" : `Pay ${money(total, currency)}`}</button></div>
      </div></div>}
      {closeOpen && <div className="pos-close-shift-modal" role="dialog" aria-modal="true" aria-labelledby="close-shift-title"><button className="pos-close-shift-backdrop" type="button" aria-label="Close" onClick={() => !closingShift && setCloseOpen(false)} /><div className="pos-close-shift-card"><div className="pos-close-shift-heading"><div><small>SHIFT CONTROL</small><h2 id="close-shift-title">Close your shift</h2><p>Count the cash in your till. The system will record the expected cash and any variance for the administrator.</p></div><button type="button" onClick={() => setCloseOpen(false)}>×</button></div><label>Closing cash amount<input type="number" min="0" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} autoFocus /></label>{cart.length > 0 && <p className="pos-close-warning">There is an unfinished order in the cart. Complete or clear it first.</p>}{closeError && <p className="pos-close-error" role="alert">{closeError}</p>}<div className="pos-close-shift-actions"><button type="button" onClick={() => setCloseOpen(false)} disabled={closingShift}>Keep shift open</button><button className="primary" type="button" onClick={closeShift} disabled={closingShift || cart.length > 0}>{closingShift ? "Closing shift…" : "Confirm and close shift"}</button></div></div></div>}
    </main>
  );
}
