"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type ProductOption = { id: string; name: string; sku: string; trackStock: boolean };
type BranchOption = { id: string; name: string; code: string };

type AdjustmentSuccess = {
  productName: string;
  branchName: string;
  previousQuantity: string;
  quantity: string;
};

export function InventoryManager({
  products,
  branches,
  canAdjust,
}: {
  products: ProductOption[];
  branches: BranchOption[];
  canAdjust: boolean;
}) {
  const router = useRouter();
  const stockProducts = useMemo(() => products.filter((product) => product.trackStock), [products]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<AdjustmentSuccess | null>(null);
  const disabled = !canAdjust || stockProducts.length === 0 || branches.length === 0;

  function close() {
    if (loading) return;
    setOpen(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await authenticatedFetch("/api/v1/app/inventory/adjustments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: data.get("productId"),
          branchId: data.get("branchId"),
          mode: data.get("mode"),
          quantity: data.get("quantity"),
          reorderLevel: data.get("reorderLevel"),
          reason: data.get("reason"),
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "Stock could not be updated.");
        return;
      }

      setSuccess({
        productName: body.inventory.productName,
        branchName: body.inventory.branchName,
        previousQuantity: body.inventory.previousQuantity,
        quantity: body.inventory.quantity,
      });
      form.reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("The server could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="catalog-action-group">
        <div className="catalog-action-row">
          <a className="catalog-secondary-action" href="/app/products">Add product</a>
          <button className="primary catalog-primary-action" type="button" disabled={disabled} onClick={() => { setSuccess(null); setOpen(true); }}>
            <span aria-hidden="true">↕</span> Adjust stock
          </button>
        </div>
        <small>{stockProducts.length} stock product{stockProducts.length === 1 ? "" : "s"} selectable</small>
      </div>

      {!canAdjust && <p className="catalog-inline-warning">Your account does not have permission to adjust inventory.</p>}
      {stockProducts.length === 0 && <p className="catalog-inline-warning">No stock products exist yet. Use Add product to create one first.</p>}
      {branches.length === 0 && <p className="catalog-inline-warning">Create an active branch before adjusting inventory.</p>}

      {success && (
        <div className="catalog-success" role="status">
          <strong>{success.productName} updated</strong>
          <span>{success.branchName}: {success.previousQuantity} → {success.quantity}</span>
          <button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {open && (
        <div className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-form-title">
          <button className="catalog-modal-backdrop" type="button" aria-label="Close stock form" onClick={close} />
          <form className="catalog-form-card inventory-form-card" onSubmit={submit}>
            <div className="catalog-form-heading">
              <div>
                <small>BRANCH STOCK CONTROL</small>
                <h3 id="inventory-form-title">Adjust inventory</h3>
                <p>Select a real product and branch, then set, add, or remove stock.</p>
              </div>
              <button className="catalog-close-button" type="button" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="catalog-form-grid">
              <label className="catalog-span-2">Product<select name="productId" required defaultValue={stockProducts[0]?.id ?? ""}><option value="" disabled>Select product</option>{products.map((product) => <option key={product.id} value={product.id} disabled={!product.trackStock}>{product.name} · {product.sku}{product.trackStock ? "" : " (stock not tracked)"}</option>)}</select></label>
              <label>Branch<select name="branchId" required defaultValue={branches[0]?.id ?? ""}><option value="" disabled>Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}</select></label>
              <label>Action<select name="mode" required defaultValue="add"><option value="add">Add stock</option><option value="remove">Remove stock</option><option value="set">Set exact quantity</option></select></label>
              <label>Quantity<input name="quantity" type="number" min="0" step="0.001" required placeholder="0" /></label>
              <label>Reorder level <small>(optional)</small><input name="reorderLevel" type="number" min="0" step="0.001" placeholder="Keep current value" /></label>
              <label className="catalog-span-2">Reason<textarea name="reason" required minLength={3} maxLength={240} placeholder="e.g. Opening balance, supplier delivery, damaged stock, physical count correction" /></label>
            </div>

            <div className="inventory-mode-note">
              <strong>Set exact quantity</strong> replaces the current balance. <strong>Add</strong> and <strong>Remove</strong> change it by the entered amount. Leave reorder level blank to preserve its current value.
            </div>

            {error && <p className="catalog-form-error" role="alert">{error}</p>}

            <div className="catalog-form-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button className="primary" type="submit" disabled={loading}>{loading ? "Updating stock…" : "Update stock"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
