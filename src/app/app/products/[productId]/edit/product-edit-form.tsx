"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type CategoryOption = { id: string; name: string };
type InventoryAllocation = {
  id: string;
  branchName: string;
  branchCode: string;
  quantity: number;
  reorderLevel: number;
};

export type EditableProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  costPrice: number;
  sellingPrice: number;
  taxPercent: number;
  trackStock: boolean;
  status: "active" | "inactive";
};

function numberLabel(value: number) {
  return value.toLocaleString("en-KE", { maximumFractionDigits: 3 });
}

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

export function ProductEditForm({
  product,
  categories,
  inventory,
  currency,
}: {
  product: EditableProduct;
  categories: CategoryOption[];
  inventory: InventoryAllocation[];
  currency: string;
}) {
  const router = useRouter();
  const [trackStock, setTrackStock] = useState(product.trackStock);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const data = new FormData(event.currentTarget);

    try {
      const response = await authenticatedFetch(`/api/v1/app/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          sku: data.get("sku"),
          barcode: data.get("barcode"),
          categoryId: data.get("categoryId"),
          costPrice: data.get("costPrice"),
          sellingPrice: data.get("sellingPrice"),
          taxPercent: data.get("taxPercent"),
          trackStock,
          status: data.get("status"),
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "The product could not be updated.");
        return;
      }

      setSuccess(`${body.product.name} was updated successfully.`);
      router.refresh();
    } catch {
      setError("The server could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="product-edit-layout">
      <form className="product-edit-form-card" onSubmit={submit}>
        <div className="catalog-form-heading">
          <div>
            <small>EDIT CATALOGUE ITEM</small>
            <h3>Product details</h3>
            <p>Change the product information used by the admin dashboard, Inventory and staff POS checkout.</p>
          </div>
          <span className={`catalog-status ${product.status === "active" ? "active" : "inactive"}`}>{product.status}</span>
        </div>

        <div className="catalog-form-grid">
          <label className="catalog-span-2">
            Product name / size / volume
            <input name="name" required minLength={2} maxLength={160} defaultValue={product.name} placeholder="e.g. Mineral Water 500ml" />
            <small>Include the size or volume in the name when needed, for example 500ml, 1 litre, 2kg or Large.</small>
          </label>

          <label>
            SKU
            <input name="sku" required minLength={2} maxLength={60} pattern="[A-Za-z0-9._-]+" defaultValue={product.sku} />
          </label>

          <label>
            Barcode <small>(optional)</small>
            <input name="barcode" maxLength={100} defaultValue={product.barcode ?? ""} placeholder="Scan or type barcode" />
          </label>

          <label>
            Category
            <select name="categoryId" defaultValue={product.categoryId ?? ""}>
              <option value="">Uncategorized</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>

          <label>
            Product status
            <select name="status" defaultValue={product.status}>
              <option value="active">Active — available for sale</option>
              <option value="inactive">Inactive — hidden from POS</option>
            </select>
          </label>

          <label>
            Cost price
            <input name="costPrice" type="number" min="0" step="0.01" required defaultValue={product.costPrice} />
          </label>

          <label>
            Selling price
            <input name="sellingPrice" type="number" min="0" step="0.01" required defaultValue={product.sellingPrice} />
          </label>

          <label>
            Tax rate (%)
            <input name="taxPercent" type="number" min="0" max="100" step="0.01" required defaultValue={product.taxPercent} />
          </label>

          <label className="catalog-checkbox-label">
            <input type="checkbox" checked={trackStock} onChange={(event) => setTrackStock(event.target.checked)} />
            <span>
              <strong>Track stock</strong>
              <small>Turn this off for services or items with unlimited availability.</small>
            </span>
          </label>
        </div>

        <div className="inventory-mode-note">
          Product edits do not change branch quantities. Use <strong>Inventory → Adjust stock</strong> to add, remove, or set stock so every change remains recorded.
        </div>

        {error && <p className="catalog-form-error" role="alert">{error}</p>}
        {success && <p className="product-edit-success" role="status">{success}</p>}

        <div className="catalog-form-actions product-edit-actions">
          <a className="product-edit-cancel" href="/app/products">Cancel</a>
          <button className="primary" type="submit" disabled={loading}>{loading ? "Saving changes…" : "Save product changes"}</button>
        </div>
      </form>

      <aside className="product-stock-card">
        <div>
          <small>BRANCH INVENTORY</small>
          <h3>Current stock allocation</h3>
          <p>These balances are preserved when product details are edited.</p>
        </div>

        {inventory.length === 0 ? (
          <div className="product-stock-empty">
            <strong>No branch allocation</strong>
            <span>Allocate this product from the Inventory tab.</span>
          </div>
        ) : (
          <div className="product-stock-list">
            {inventory.map((row) => (
              <article key={row.id}>
                <div><strong>{row.branchName}</strong><small>{row.branchCode}</small></div>
                <div><strong>{trackStock ? numberLabel(row.quantity) : "Unlimited"}</strong><small>{trackStock ? `Reorder at ${numberLabel(row.reorderLevel)}` : "Stock tracking disabled"}</small></div>
              </article>
            ))}
          </div>
        )}

        <div className="product-price-summary">
          <span>Cost <strong>{money(product.costPrice, currency)}</strong></span>
          <span>Selling <strong>{money(product.sellingPrice, currency)}</strong></span>
        </div>

        <a className="primary product-stock-action" href="/app/inventory">Open Inventory</a>
      </aside>
    </div>
  );
}
