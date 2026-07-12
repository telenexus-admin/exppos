"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Option = { id: string; name: string; code?: string };

type CreatedProduct = {
  name: string;
  sku: string;
  branchName: string;
  initialStock: string;
};

function generateSku(name: string) {
  const prefix = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12) || "ITEM";
  return `${prefix}-${Date.now().toString().slice(-5)}`;
}

export function ProductManager({
  branches,
  categories,
  canCreate,
  currentProducts,
  maxProducts,
}: {
  branches: Option[];
  categories: Option[];
  canCreate: boolean;
  currentProducts: number;
  maxProducts: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<CreatedProduct | null>(null);
  const [trackStock, setTrackStock] = useState(true);
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const limitReached = currentProducts >= maxProducts;
  const disabled = !canCreate || limitReached || branches.length === 0;
  const usage = useMemo(() => `${currentProducts} of ${maxProducts} products used`, [currentProducts, maxProducts]);

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
      const response = await authenticatedFetch("/api/v1/app/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          sku: data.get("sku"),
          barcode: data.get("barcode"),
          categoryId: data.get("categoryId"),
          branchId: data.get("branchId"),
          costPrice: data.get("costPrice"),
          sellingPrice: data.get("sellingPrice"),
          taxPercent: data.get("taxPercent"),
          trackStock,
          initialStock: trackStock ? data.get("initialStock") : 0,
          reorderLevel: trackStock ? data.get("reorderLevel") : 0,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "The product could not be created.");
        return;
      }

      setSuccess({
        name: body.product.name,
        sku: body.product.sku,
        branchName: body.product.branchName,
        initialStock: body.product.initialStock,
      });
      form.reset();
      setTrackStock(true);
      setProductName("");
      setSku("");
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
        <button className="primary catalog-primary-action" type="button" disabled={disabled} onClick={() => { setSuccess(null); setOpen(true); }}>
          <span aria-hidden="true">＋</span> Add product
        </button>
        <small>{usage}</small>
      </div>

      {!canCreate && <p className="catalog-inline-warning">Your account does not have permission to add products.</p>}
      {limitReached && <p className="catalog-inline-warning">Your subscription product limit has been reached.</p>}
      {branches.length === 0 && <p className="catalog-inline-warning">Create an active branch before adding products.</p>}

      {success && (
        <div className="catalog-success" role="status">
          <strong>{success.name} created</strong>
          <span>SKU {success.sku} · {success.initialStock} opening stock at {success.branchName}</span>
          <button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {open && (
        <div className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
          <button className="catalog-modal-backdrop" type="button" aria-label="Close product form" onClick={close} />
          <form className="catalog-form-card product-form-card" onSubmit={submit}>
            <div className="catalog-form-heading">
              <div>
                <small>NEW CATALOGUE ITEM</small>
                <h3 id="product-form-title">Add a product</h3>
                <p>Create the item, set its selling details, and allocate opening stock to a branch.</p>
              </div>
              <button className="catalog-close-button" type="button" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="catalog-form-grid">
              <label className="catalog-span-2">Product name<input name="name" required minLength={2} maxLength={160} value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="e.g. 500ml Mineral Water" /></label>
              <label>SKU<div className="catalog-input-action"><input name="sku" required minLength={2} maxLength={60} pattern="[A-Za-z0-9._-]+" value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="WATER-500" /><button type="button" onClick={() => setSku(generateSku(productName))}>Generate</button></div></label>
              <label>Barcode <small>(optional)</small><input name="barcode" maxLength={100} placeholder="Scan or type barcode" /></label>
              <label>Category<select name="categoryId" defaultValue=""><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Opening branch<select name="branchId" required defaultValue={branches[0]?.id ?? ""}><option value="" disabled>Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ""}</option>)}</select></label>
              <label>Cost price<input name="costPrice" type="number" min="0" step="0.01" defaultValue="0" required /></label>
              <label>Selling price<input name="sellingPrice" type="number" min="0" step="0.01" required placeholder="0.00" /></label>
              <label>Tax rate (%)<input name="taxPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>
              <label className="catalog-checkbox-label"><input type="checkbox" checked={trackStock} onChange={(event) => setTrackStock(event.target.checked)} /><span><strong>Track stock</strong><small>Turn this off for services or unlimited items.</small></span></label>
              <label>Opening quantity<input name="initialStock" type="number" min="0" step="0.001" defaultValue="0" required disabled={!trackStock} /></label>
              <label>Reorder level<input name="reorderLevel" type="number" min="0" step="0.001" defaultValue="0" required disabled={!trackStock} /></label>
            </div>

            {error && <p className="catalog-form-error" role="alert">{error}</p>}

            <div className="catalog-form-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button className="primary" type="submit" disabled={loading}>{loading ? "Creating product…" : "Create product"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
