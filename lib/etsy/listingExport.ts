import { prisma } from "../db";

// Columns operators paste into Etsy's listing UI (or hand to a paid bulk
// uploader like Vela). Etsy has no first-party CSV import, so this is a
// reference sheet for our own catalog projected onto Etsy's field names.
export const ETSY_LISTING_COLUMNS = [
  "sku",
  "title",
  "description",
  "price",
  "currency",
  "quantity",
  "fulfillment",
  "lead_time_business_days",
  "material",
  "tags",
] as const;

export type EtsyListingRow = Record<(typeof ETSY_LISTING_COLUMNS)[number], string>;

// Etsy's per-listing tag cap is 13.
const ETSY_TAG_LIMIT = 13;
// Etsy needs a finite quantity per listing. For uncapped made-to-order SKUs
// we project a generous default; the operator can adjust per-listing.
const ETSY_UNCAPPED_MTO_QUANTITY = 50;

function etsyListingQuantity(sku: {
  fulfillment: "made_to_order" | "in_stock" | "hybrid";
  onHandQty: number;
  madeToOrderCap: number | null;
}): number {
  switch (sku.fulfillment) {
    case "in_stock":
      return sku.onHandQty;
    case "made_to_order":
      return sku.madeToOrderCap ?? ETSY_UNCAPPED_MTO_QUANTITY;
    case "hybrid":
      return sku.onHandQty + (sku.madeToOrderCap ?? ETSY_UNCAPPED_MTO_QUANTITY);
  }
}

// Made-to-order print time → lead time in business days. We assume an
// 8-hour print day and pad by one day for QC/shipping prep. This is a
// hint for the operator; they can tighten or relax it per-listing on Etsy.
function leadTimeBusinessDays(printTimeMinutes: number | null): number {
  if (!printTimeMinutes || printTimeMinutes <= 0) return 1;
  const printDays = Math.ceil(printTimeMinutes / (8 * 60));
  return printDays + 1;
}

function deriveTags(productTitle: string, variantOptions: unknown): string[] {
  const tags = new Set<string>();
  for (const word of productTitle.toLowerCase().split(/\s+/)) {
    const clean = word.replace(/[^a-z0-9-]/g, "");
    if (clean) tags.add(clean);
  }
  if (variantOptions && typeof variantOptions === "object") {
    for (const v of Object.values(variantOptions as Record<string, unknown>)) {
      if (typeof v === "string" && v) tags.add(v.toLowerCase());
    }
  }
  tags.add("3d-printed");
  tags.add("made-to-order");
  return Array.from(tags).slice(0, ETSY_TAG_LIMIT);
}

export async function buildEtsyListingRows(): Promise<EtsyListingRow[]> {
  const products = await prisma.product.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    include: {
      variants: {
        orderBy: { createdAt: "asc" },
        include: { sku: true },
      },
    },
  });

  const rows: EtsyListingRow[] = [];
  for (const p of products) {
    for (const v of p.variants) {
      const sku = v.sku;
      if (!sku) continue;
      const qty = etsyListingQuantity(sku);
      if (qty <= 0) continue;
      rows.push({
        sku: sku.code,
        title: `${p.title} — ${v.name}`,
        description: p.description,
        price: (v.priceCents / 100).toFixed(2),
        currency: v.currency,
        quantity: String(qty),
        fulfillment: sku.fulfillment,
        lead_time_business_days: String(
          sku.fulfillment === "in_stock"
            ? 1
            : leadTimeBusinessDays(sku.printTimeMinutes),
        ),
        material: sku.material ?? "",
        tags: deriveTags(p.title, v.options).join("|"),
      });
    }
  }
  return rows;
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: EtsyListingRow[]): string {
  const header = ETSY_LISTING_COLUMNS.join(",");
  const body = rows
    .map((row) =>
      ETSY_LISTING_COLUMNS.map((col) => escapeCsvField(row[col])).join(","),
    )
    .join("\n");
  return body.length > 0 ? `${header}\n${body}\n` : `${header}\n`;
}

export async function exportEtsyListingsCsv(): Promise<string> {
  const rows = await buildEtsyListingRows();
  return rowsToCsv(rows);
}
