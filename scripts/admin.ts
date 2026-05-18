#!/usr/bin/env tsx
import "dotenv/config";
import { prisma } from "../lib/db";

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
