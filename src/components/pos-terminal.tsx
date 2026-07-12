"use client";

import { useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import type { PaymentMethod } from "@/server/settings/tenant-settings";

export type PosProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  taxRate: number;
  quantity: number;
  trackStock: boolean;
};

export type PosBehavior = {
  enabledPaymentMethods: PaymentMethod[];
  requireReferenceForNonCash: boolean;
  confirmBeforePayment: boolean;
  allowNegativeStock: boolean;
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
  branchId,
  branchName,
  shiftId,
  cashierName,
  currency,
  canSell,
  returnPath,
  behavior,
}: {
  products: PosProduct[];
  branchId: string | null;
  branchName: string;
  shiftId: string | null;
  cashierName: string;
  currency: string;
  canSell: boolean;
  returnPath: string;
  behavior: PosBehavior;
}) {
  const paymentMethods = behavior.enabledPaymentMethods.length > 0 ? behavior.enabledPaymentMethods : ["Cash" as const];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All items");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [stock, setStock] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((product) => [product.id, product.quantity])),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(paymentMethods[0]);
  const [paymentReference, setPaymentReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
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
      if (product.trackStock && !behavior.allowNegativeStock && nextQuantity > (stock[product.id] ?? 0)) {
        setError(`Only ${stock[product.id] ?? 0} ${product.name} available at ${branchName}.`);
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
    if (product.trackStock && !behavior.allowNegativeStock && quantity > (stock[productId] ?? 0)) {
      setError(`Only ${stock[productId] ?? 0} ${product.name} available at ${branchName}.`);
      return;
    }
    setCart((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line));
  }

  async function completeSale() {
    if (!branchId || !shiftId || lines.length === 0 || !canSell) return;
    if (behavior.requireReferenceForNonCash && paymentMethod !== "Cash" && !paymentReference.trim()) {
      setError(`Enter the ${paymentMethod} transaction reference before completing the sale.`);
      return;
    }
    if (behavior.confirmBeforePayment && !window.confirm(`Record this ${paymentMethod} sale for ${money(total, currency)}?`)) return;

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
      setSuccess(`Sale ${body?.saleNumber ?? "completed"} was recorded successfully.`);
    } catch {
      setError("The POS could not reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="pos live-pos">
      <header>
        <a className="brand" href={returnPath}>Speedyhive<span>{branchName}</span></a>
        <input placeholder="Scan barcode or search name / SKU…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        <div className="cashier"><span className="status-dot" />{cashierName}</div>
      </header>

      <section className="catalog">
        <div className="pos-context-row">
          <div><small>ACTIVE BRANCH</small><strong>{branchName}</strong></div>
          <span className={shiftId ? "pos-shift-ready" : "pos-shift-required"}>{shiftId ? "Shift open" : "Shift required"}</span>
        </div>
        {!shiftId && <div className="pos-alert"><div><strong>Open a shift to start selling</strong><span>The live inventory is visible below, but checkout is locked until a shift is opened.</span></div><a href="/staff/dashboard">Open shift</a></div>}
        {behavior.allowNegativeStock && <div className="pos-message pos-warning">Negative stock sales are enabled for this business.</div>}
        {error && <p className="pos-message pos-error" role="alert">{error}</p>}
        {success && <p className="pos-message pos-success" role="status">{success}</p>}

        <div className="category-row">{categories.map((item) => <button className={category === item ? "active" : ""} type="button" onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
        {filteredProducts.length === 0 ? (
          <div className="pos-empty"><span>0</span><h2>No inventory products found</h2><p>Add products and allocate stock to {branchName}. They will appear here automatically.</p></div>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const available = stock[product.id] ?? 0;
              const unavailable = product.trackStock && !behavior.allowNegativeStock && available <= 0;
              return <button className="product" type="button" onClick={() => addProduct(product)} disabled={unavailable} key={product.id}><span>{product.name.slice(0, 1).toUpperCase()}</span><strong>{product.name}</strong><small>{money(product.price, currency)}</small><em>{product.trackStock ? `${available} in stock` : "Service / unlimited"}</em><i>{product.sku}</i></button>;
            })}
          </div>
        )}
      </section>

      <aside className="cart">
        <div className="cart-head"><div><small>CURRENT ORDER</small><h2>Walk-in customer</h2></div>{cart.length > 0 && <button type="button" onClick={() => setCart([])}>Clear</button>}</div>
        {lines.length === 0 ? <div className="cart-empty"><span>＋</span><strong>No products selected</strong><small>Select a product from the live branch inventory.</small></div> : lines.map((line) => {
          const amount = line.product.price * line.quantity;
          const lineTax = behavior.taxEnabled && !behavior.pricesIncludeTax ? amount * line.product.taxRate : 0;
          return <div className="cart-item" key={line.productId}><div className="cart-quantity"><button type="button" onClick={() => setQuantity(line.productId, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" onClick={() => setQuantity(line.productId, line.quantity + 1)}>+</button></div><div><strong>{line.product.name}</strong><small>{line.quantity} × {money(line.product.price, currency)}</small></div><b>{money(amount + lineTax, currency)}</b></div>;
        })}
        <div className="totals"><p><span>Subtotal</span><b>{money(subtotal, currency)}</b></p>{behavior.showTaxBreakdown && <p><span>Tax</span><b>{money(tax, currency)}</b></p>}<p className="grand"><span>Total</span><b>{money(total, currency)}</b></p></div>
        <div className="payment-fields">
          <label>Payment method<select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value as PaymentMethod); setPaymentReference(""); }}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label>
          {paymentMethod === "Mobile Money" && behavior.mpesaNumber && (
            <div className="pos-payment-instructions">
              <small>M-PESA {behavior.mpesaType.toUpperCase()}</small>
              <strong>{behavior.mpesaNumber}</strong>
              {behavior.mpesaAccountInstructions && <span>{behavior.mpesaAccountInstructions}</span>}
            </div>
          )}
          {paymentMethod !== "Cash" && <label>Payment reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} required={behavior.requireReferenceForNonCash} placeholder="Receipt / transaction reference" /></label>}
        </div>
        <div className="pay-actions"><button type="button" onClick={() => setCart([])} disabled={lines.length === 0}>Cancel</button><button className="primary" type="button" onClick={completeSale} disabled={loading || lines.length === 0 || !shiftId || !canSell}>{loading ? "Processing…" : `Pay ${money(total, currency)}`}</button></div>
      </aside>
    </main>
  );
}
