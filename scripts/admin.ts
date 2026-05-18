#!/usr/bin/env tsx
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/db";
import { exportEtsyListingsCsv } from "../lib/etsy/listingExport";
import { ingestEtsyOrder, type EtsyLineItem } from "../lib/etsy/ingestOrder";

type ParsedArgs = {
  positional: string[];
  flags: Record<string, string>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requireFlag(args: ParsedArgs, name: string): string {
  const v = args.flags[name];
  if (!v) {
    throw new Error(`Missing required --${name}`);
  }
  return v;
}

function optionalInt(args: ParsedArgs, name: string): number | undefined {
  const v = args.flags[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new Error(`--${name} must be an integer`);
  }
  return n;
}

async function productList() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      variants: {
        orderBy: { createdAt: "asc" },
        include: { sku: true },
      },
    },
  });

  if (products.length === 0) {
    console.log("(no products)");
    return;
  }

  for (const p of products) {
    console.log(`${p.slug}  [${p.status}]  ${p.title}`);
    for (const v of p.variants) {
      const sku = v.sku;
      const price = `$${(v.priceCents / 100).toFixed(2)} ${v.currency}`;
      if (sku) {
        const stockLine =
          sku.fulfillment === "made_to_order"
            ? `MTO cap=${sku.madeToOrderCap ?? "∞"}`
            : sku.fulfillment === "in_stock"
              ? `on-hand=${sku.onHandQty}`
              : `on-hand=${sku.onHandQty}, MTO cap=${sku.madeToOrderCap ?? "∞"}`;
        const print =
          sku.printTimeMinutes !== null
            ? ` · ${sku.printTimeMinutes}m, ${sku.materialGrams ?? "?"}g ${sku.material ?? ""}`.trimEnd()
            : "";
        console.log(
          `  - ${v.name}  ${price}  [${sku.code}]  ${sku.fulfillment}  ${stockLine}${print}`,
        );
      } else {
        console.log(`  - ${v.name}  ${price}  (no SKU)`);
      }
    }
  }
}

async function productShow(slug: string) {
  const p = await prisma.product.findUnique({
    where: { slug },
    include: {
      variants: { include: { sku: { include: { inventoryLedger: true } } } },
    },
  });
  if (!p) {
    console.error(`No product with slug "${slug}".`);
    process.exit(1);
  }
  console.log(JSON.stringify(p, null, 2));
}

async function productCreate(args: ParsedArgs) {
  const slug = requireFlag(args, "slug");
  const title = requireFlag(args, "title");
  const description = args.flags.description ?? "";
  const status =
    (args.flags.status as "draft" | "active" | "archived" | undefined) ??
    "draft";

  const variantName = requireFlag(args, "variant");
  const skuCode = requireFlag(args, "sku");
  const priceCents = Number(requireFlag(args, "price-cents"));
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error("--price-cents must be a non-negative integer");
  }

  const fulfillment = requireFlag(args, "fulfillment") as
    | "made_to_order"
    | "in_stock"
    | "hybrid";
  if (!["made_to_order", "in_stock", "hybrid"].includes(fulfillment)) {
    throw new Error(
      "--fulfillment must be one of: made_to_order, in_stock, hybrid",
    );
  }

  const printTimeMinutes = optionalInt(args, "print-minutes");
  const materialGrams = optionalInt(args, "material-grams");
  const material = args.flags.material;
  const onHandQty = optionalInt(args, "on-hand") ?? 0;
  const madeToOrderCap = optionalInt(args, "mto-cap");

  const created = await prisma.product.create({
    data: {
      slug,
      title,
      description,
      status,
      variants: {
        create: [
          {
            name: variantName,
            priceCents,
            sku: {
              create: {
                code: skuCode,
                fulfillment,
                printTimeMinutes: printTimeMinutes ?? null,
                materialGrams: materialGrams ?? null,
                material: material ?? null,
                onHandQty,
                madeToOrderCap: madeToOrderCap ?? null,
              },
            },
          },
        ],
      },
    },
    include: { variants: { include: { sku: true } } },
  });
  console.log(`Created product ${created.slug} (${created.id}).`);
  console.log(JSON.stringify(created, null, 2));
}

async function etsyExportListings(args: ParsedArgs) {
  const csv = await exportEtsyListingsCsv();
  const out = args.flags.out;
  if (out) {
    writeFileSync(out, csv, "utf8");
    const rowCount = csv.trim().split("\n").length - 1;
    console.log(`Wrote ${rowCount} listings to ${out}`);
  } else {
    process.stdout.write(csv);
  }
}

function parseLineItems(raw: string | undefined): EtsyLineItem[] {
  // Format: SKU:qty:unitPriceCents,SKU2:qty:unitPriceCents
  if (!raw) throw new Error("Missing --items (e.g. HEX-SM-SAGE:1:1800)");
  return raw.split(",").map((entry) => {
    const parts = entry.split(":");
    if (parts.length !== 3) {
      throw new Error(
        `Invalid --items entry "${entry}". Expected SKU:qty:unitPriceCents.`,
      );
    }
    const [skuCode, qtyStr, priceStr] = parts;
    const quantity = Number(qtyStr);
    const unitPriceCents = Number(priceStr);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for ${skuCode}: ${qtyStr}`);
    }
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new Error(`Invalid unit price for ${skuCode}: ${priceStr}`);
    }
    return { skuCode, quantity, unitPriceCents };
  });
}

async function etsyIngestOrder(args: ParsedArgs) {
  const externalId = requireFlag(args, "external-id");
  const buyerEmail = requireFlag(args, "buyer-email");
  const buyerName = args.flags["buyer-name"];
  const totalCents = Number(requireFlag(args, "total-cents"));
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("--total-cents must be a non-negative integer");
  }
  const currency = args.flags.currency;
  const placedAtRaw = requireFlag(args, "placed-at");
  const placedAt = new Date(placedAtRaw);
  if (Number.isNaN(placedAt.getTime())) {
    throw new Error(`Invalid --placed-at "${placedAtRaw}" (expected ISO 8601)`);
  }
  const items = parseLineItems(args.flags.items);
  const shippingAddress = args.flags["shipping-json"]
    ? JSON.parse(args.flags["shipping-json"])
    : undefined;

  const result = await ingestEtsyOrder({
    externalId,
    buyerEmail,
    buyerName: buyerName ?? undefined,
    totalCents,
    currency,
    placedAt,
    items,
    shippingAddress,
    notes: args.flags.notes,
  });

  if (result.status === "already_ingested") {
    console.log(
      `Etsy order ${result.externalId} already ingested as ${result.orderId}.`,
    );
  } else {
    console.log(
      `Ingested Etsy order ${result.externalId} as ${result.orderId}.`,
    );
  }
}

async function orderList(args: ParsedArgs) {
  const source = args.flags.source as
    | "webshop"
    | "etsy"
    | "ebay"
    | undefined;
  const orders = await prisma.order.findMany({
    where: source ? { source } : undefined,
    orderBy: { placedAt: "desc" },
    include: { items: { include: { sku: true } } },
  });
  if (orders.length === 0) {
    console.log("(no orders)");
    return;
  }
  for (const o of orders) {
    const total = `$${(o.totalCents / 100).toFixed(2)} ${o.currency}`;
    console.log(
      `${o.source}:${o.externalId}  [${o.status}]  ${total}  ${o.buyerEmail}  @ ${o.placedAt.toISOString()}`,
    );
    for (const item of o.items) {
      const unit = `$${(item.unitPriceCents / 100).toFixed(2)}`;
      console.log(`  - ${item.sku.code} x${item.quantity} @ ${unit}`);
    }
  }
}

const HELP = `printshop admin

Usage:
  tsx scripts/admin.ts product:list
  tsx scripts/admin.ts product:show <slug>
  tsx scripts/admin.ts product:create \\
      --slug <slug> --title <title> [--description <text>] [--status draft|active|archived] \\
      --variant <variant-name> --sku <sku-code> --price-cents <int> \\
      --fulfillment made_to_order|in_stock|hybrid \\
      [--print-minutes <int>] [--material-grams <int>] [--material <name>] \\
      [--on-hand <int>] [--mto-cap <int>]

  tsx scripts/admin.ts etsy:export-listings [--out <path.csv>]
  tsx scripts/admin.ts etsy:ingest-order \\
      --external-id <etsy-receipt-id> \\
      --buyer-email <email> [--buyer-name <name>] \\
      --total-cents <int> [--currency USD] \\
      --placed-at <iso-8601> \\
      --items SKU:qty:unitPriceCents[,SKU:qty:unitPriceCents...] \\
      [--shipping-json '<json>'] [--notes <text>]

  tsx scripts/admin.ts order:list [--source webshop|etsy|ebay]
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case "product:list":
      await productList();
      break;
    case "product:show": {
      const slug = args.positional[0];
      if (!slug) {
        console.error("Usage: product:show <slug>");
        process.exit(1);
      }
      await productShow(slug);
      break;
    }
    case "product:create":
      await productCreate(args);
      break;
    case "etsy:export-listings":
      await etsyExportListings(args);
      break;
    case "etsy:ingest-order":
      await etsyIngestOrder(args);
      break;
    case "order:list":
      await orderList(args);
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(HELP);
      process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
