import "dotenv/config";
import { prisma } from "../lib/db";

type SeedVariant = {
  name: string;
  options: Record<string, string>;
  priceCents: number;
  sku: {
    code: string;
    fulfillment: "made_to_order" | "in_stock" | "hybrid";
    printTimeMinutes?: number;
    materialGrams?: number;
    material?: string;
    onHandQty?: number;
    madeToOrderCap?: number;
  };
};

type SeedProduct = {
  slug: string;
  title: string;
  description: string;
  status: "draft" | "active" | "archived";
  variants: SeedVariant[];
};

const products: SeedProduct[] = [
  {
    slug: "hex-planter",
    title: "Hexagonal Planter",
    description:
      "Modular hexagonal planter for small succulents. Tessellates flat on a desk or wall.",
    status: "active",
    variants: [
      {
        name: "Small / Sage",
        options: { size: "small", color: "sage" },
        priceCents: 1800,
        sku: {
          code: "HEX-SM-SAGE",
          fulfillment: "hybrid",
          printTimeMinutes: 95,
          materialGrams: 42,
          material: "PLA",
          onHandQty: 4,
          madeToOrderCap: 20,
        },
      },
      {
        name: "Small / Charcoal",
        options: { size: "small", color: "charcoal" },
        priceCents: 1800,
        sku: {
          code: "HEX-SM-CHAR",
          fulfillment: "made_to_order",
          printTimeMinutes: 95,
          materialGrams: 42,
          material: "PLA",
          onHandQty: 0,
          madeToOrderCap: 20,
        },
      },
      {
        name: "Large / Sage",
        options: { size: "large", color: "sage" },
        priceCents: 3200,
        sku: {
          code: "HEX-LG-SAGE",
          fulfillment: "made_to_order",
          printTimeMinutes: 190,
          materialGrams: 110,
          material: "PLA",
        },
      },
    ],
  },
  {
    slug: "cable-comb",
    title: "Desk Cable Comb",
    description:
      "Six-slot cable comb that screws onto the back of a desk. Keeps charger and monitor cables from tangling.",
    status: "active",
    variants: [
      {
        name: "Black",
        options: { color: "black" },
        priceCents: 900,
        sku: {
          code: "CABLE-COMB-BLK",
          fulfillment: "in_stock",
          printTimeMinutes: 38,
          materialGrams: 18,
          material: "PETG",
          onHandQty: 24,
        },
      },
      {
        name: "White",
        options: { color: "white" },
        priceCents: 900,
        sku: {
          code: "CABLE-COMB-WHT",
          fulfillment: "in_stock",
          printTimeMinutes: 38,
          materialGrams: 18,
          material: "PETG",
          onHandQty: 18,
        },
      },
    ],
  },
  {
    slug: "headphone-hanger",
    title: "Under-Desk Headphone Hanger",
    description:
      "Screw-mount hanger for over-ear headphones. Sticks under the desk so the headband does not warp.",
    status: "active",
    variants: [
      {
        name: "Default",
        options: {},
        priceCents: 1400,
        sku: {
          code: "HEADHANG-STD",
          fulfillment: "hybrid",
          printTimeMinutes: 72,
          materialGrams: 35,
          material: "PETG",
          onHandQty: 6,
          madeToOrderCap: 30,
        },
      },
    ],
  },
  {
    slug: "tarot-tray",
    title: "Sage Tarot Card Tray",
    description:
      "Stackable tray sized for a standard 78-card tarot deck. Sage-finished PLA, magnetic lid.",
    status: "active",
    variants: [
      {
        name: "Sage",
        options: { color: "sage" },
        priceCents: 2600,
        sku: {
          code: "TAROT-TRAY-SAGE",
          fulfillment: "made_to_order",
          printTimeMinutes: 240,
          materialGrams: 165,
          material: "PLA",
          madeToOrderCap: 10,
        },
      },
    ],
  },
  {
    slug: "dice-tower",
    title: "Tabletop Dice Tower",
    description:
      "Foldable dice tower that flat-packs. Internal baffles randomize rolls. Designed for d20 + standard polyhedrals.",
    status: "draft",
    variants: [
      {
        name: "Walnut PLA",
        options: { color: "walnut" },
        priceCents: 4200,
        sku: {
          code: "DICE-TOWER-WAL",
          fulfillment: "made_to_order",
          printTimeMinutes: 360,
          materialGrams: 240,
          material: "PLA",
          madeToOrderCap: 5,
        },
      },
    ],
  },
];

async function main() {
  for (const p of products) {
    const created = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        title: p.title,
        description: p.description,
        status: p.status,
      },
      create: {
        slug: p.slug,
        title: p.title,
        description: p.description,
        status: p.status,
      },
    });

    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { productId_name: { productId: created.id, name: v.name } },
        update: {
          options: v.options,
          priceCents: v.priceCents,
        },
        create: {
          productId: created.id,
          name: v.name,
          options: v.options,
          priceCents: v.priceCents,
        },
      });

      await prisma.sku.upsert({
        where: { code: v.sku.code },
        update: {
          fulfillment: v.sku.fulfillment,
          printTimeMinutes: v.sku.printTimeMinutes ?? null,
          materialGrams: v.sku.materialGrams ?? null,
          material: v.sku.material ?? null,
          onHandQty: v.sku.onHandQty ?? 0,
          madeToOrderCap: v.sku.madeToOrderCap ?? null,
        },
        create: {
          code: v.sku.code,
          variantId: variant.id,
          fulfillment: v.sku.fulfillment,
          printTimeMinutes: v.sku.printTimeMinutes ?? null,
          materialGrams: v.sku.materialGrams ?? null,
          material: v.sku.material ?? null,
          onHandQty: v.sku.onHandQty ?? 0,
          madeToOrderCap: v.sku.madeToOrderCap ?? null,
        },
      });
    }
  }

  const count = await prisma.product.count();
  console.log(`Seeded. ${count} products in catalog.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
