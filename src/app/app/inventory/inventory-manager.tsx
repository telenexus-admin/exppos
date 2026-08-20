"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  trackStock: boolean;
  sellingPrice: number;
  branchIds: string[];
};
type BranchOption = { id: string; name: string; code: string };
type AdjustmentSuccess = {
  productName: string;
  branchName: string;
  previousQuantity: string;
  quantity: string;
  sellingPrice?: string;
};

export function InventoryManager({
  products,
  branches,
  canAdjust,
  canUpdatePrice,
  reasonRequired,
  currency,
}: {
  products: ProductOption[];
  branches: BranchOption[];
  canAdjust: boolean;
  canUpdatePrice: boolean;
  reasonRequired: boolean;
  currency: string;
}) {
  const router = useRouter();
  const stockProducts = useMemo(() => products.filter((product) => product.trackStock), [products]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<AdjustmentSuccess | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [allocationMode, setAllocationMode] = useState(false);

  const branchProducts = useMemo(
    () => selectedBranchId
      ? stockProducts.filter((product) => product.branchIds.includes(selectedBranchId))
      : [],
    [selectedBranchId, stockProducts],
  );
  const unallocatedProducts = useMemo(
    () => selectedBranchId
      ? stockProducts.filter((product) => !product.branchIds.includes(selectedBranchId))
      : [],
    [selectedBranchId, stockProducts],
  );
  const selectableProducts = allocationMode ? unallocatedProducts : branchProducts;
  const disabled = !canAdjust || stockProducts.length === 0 || branches.length === 0;

  function resetSelection() {
    setSelectedBranchId("");
    setSelectedProductId("");
    setSellingPrice("");
    setAllocationMode(false);
  }

  function close() {
    if (loading) return;
    setOpen(false);
    setError("");
    resetSelection();
  }

  function selectBranch(branchId: string) {
    setSelectedBranchId(branchId);
    setAllocationMode(false);
    const first = stockProducts.find((product) => product.branchIds.includes(branchId)) ?? null;
    setSelectedProductId(first?.id ?? "");
    setSellingPrice(first ? String(first.sellingPrice) : "");
    setError("");
  }

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    const selected = stockProducts.find((product) => product.id === productId);
    setSellingPrice(selected ? String(selected.sellingPrice) : "");
  }

  function toggleAllocationMode(next: boolean) {
    setAllocationMode(next);
    const options = next ? unallocatedProducts : branchProducts;
    const first = options[0] ?? null;
    setSelectedProductId(first?.id ?? "");
    setSellingPrice(first ? String(first.sellingPrice) : "");
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
          sellingPrice: canUpdatePrice ? data.get("sellingPrice") : undefined,
          reason: data.get("reason"),
          allocateToBranch: allocationMode,
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
        sellingPrice: body.inventory.sellingPrice,
      });
      form.reset();
      resetSelection();
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
          <button className="primary catalog-primary-action" type="button" disabled={disabled} onClick={() => { setSuccess(null); resetSelection(); setOpen(true); }}>
            <span aria-hidden="true">↕</span> Adjust stock
          </button>
        </div>
        <small>{stockProducts.length} stock product{stockProducts.length === 1 ? "" : "s"} available across your branches</small>
      </div>

      {!canAdjust && <p className="catalog-inline-warning">Your account does not have permission to adjust inventory.</p>}
      {stockProducts.length === 0 && <p className="catalog-inline-warning">No stock products exist yet. Use Add product to create one first.</p>}
      {branches.length === 0 && <p className="catalog-inline-warning">Create an active branch before adjusting inventory.</p>}

      {success && <div className="catalog-success" role="status"><strong>{success.productName} updated</strong><span>{success.branchName}: {success.previousQuantity} → {success.quantity}{success.sellingPrice ? ` · Selling price ${currency} ${Number(success.sellingPrice).toLocaleString("en-KE")}` : ""}</span><button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button></div>}

      {open && (
        <div className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-form-title">
          <button className="catalog-modal-backdrop" type="button" aria-label="Close stock form" onClick={close} />
          <form className="catalog-form-card inventory-form-card" onSubmit={submit}>
            <div className="catalog-form-heading">
              <div><small>BRANCH STOCK CONTROL</small><h3 id="inventory-form-title">Adjust inventory</h3><p>Choose the branch first. The product list will then show only products stocked at that branch.</p></div>
              <button className="catalog-close-button" type="button" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="catalog-form-grid">
              <label className="catalog-span-2">Branch<select name="branchId" required value={selectedBranchId} onChange={(event) => selectBranch(event.target.value)}><option value="" disabled>Select branch first</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}</select></label>

              <label className="catalog-span-2">{allocationMode ? "Product to allocate" : "Product in selected branch"}<select name="productId" required value={selectedProductId} onChange={(event) => selectProduct(event.target.value)} disabled={!selectedBranchId || selectableProducts.length === 0}><option value="" disabled>{!selectedBranchId ? "Select branch first" : selectableProducts.length === 0 ? "No matching products" : "Select product"}</option>{selectableProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>

              {selectedBranchId && !allocationMode && branchProducts.length === 0 && <div className="catalog-span-2 catalog-inline-warning">This branch has no allocated stock products yet.</div>}
              {selectedBranchId && unallocatedProducts.length > 0 && (
                <div className="catalog-span-2 inventory-mode-note">
                  {allocationMode
                    ? <>You are allocating an existing business product to this branch. <button type="button" onClick={() => toggleAllocationMode(false)}>Back to branch products</button></>
                    : <>Need a product that is not yet stocked here? <button type="button" onClick={() => toggleAllocationMode(true)}>Allocate existing product to this branch</button></>}
                </div>
              )}

              <label>Action<select name="mode" required defaultValue="add"><option value="add">Add stock</option><option value="remove">Remove stock</option><option value="set">Set exact quantity</option></select></label>
              <label>Quantity<input name="quantity" type="number" min="0" step="0.001" required placeholder="0" /></label>
              <label>Selling price ({currency})<input name="sellingPrice" type="number" min="0" step="0.01" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} required={canUpdatePrice} disabled={!canUpdatePrice || !selectedProductId} /></label>
              <label>Reorder level <small>(optional)</small><input name="reorderLevel" type="number" min="0" step="0.001" placeholder="Keep current value" /></label>
              <label className="catalog-span-2">Reason {reasonRequired ? <small>(required)</small> : <small>(optional)</small>}<textarea name="reason" required={reasonRequired} minLength={reasonRequired ? 3 : undefined} maxLength={240} placeholder="e.g. Supplier delivery, damaged stock, physical count correction" /></label>
            </div>

            <div className="inventory-mode-note"><strong>Set exact quantity</strong> replaces the current balance for the selected branch only. <strong>Add</strong> and <strong>Remove</strong> change only that branch&apos;s balance. The selling price remains a business-wide product price.</div>
            {!canUpdatePrice && <p className="catalog-inline-warning">You can adjust stock, but you do not have permission to change selling prices.</p>}
            {error && <p className="catalog-form-error" role="alert">{error}</p>}
            <div className="catalog-form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" type="submit" disabled={loading || !selectedBranchId || !selectedProductId}>{loading ? "Updating stock…" : allocationMode ? "Allocate product and update stock" : "Update branch stock"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}
