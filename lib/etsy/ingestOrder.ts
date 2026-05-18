import { prisma } from "../db";

export type EtsyLineItem = {
  skuCode: string;
  quantity: number;
  unitPriceCents: number;
};

export type EtsyOrderInput = {
  // Etsy receipt id (numeric on Etsy, but kept as a string so we never
  // truncate and so we can also accept manual placeholders for testing).
  externalId: string;
  buyerEmail: string;
  buyerName?: string;
  shippingAddress?: Record<string, unknown>;
  totalCents: number;
  currency?: string;
  placedAt: Date;
  notes?: string;
  items: EtsyLineItem[];
};

export type EtsyIngestResult = {
  orderId: string;
  status: "created" | "already_ingested";
  externalId: string;
};

// Idempotent: re-running with the same Etsy receipt id is a no-op and
// returns the existing order. We never re-decrement inventory for an
// order we've already ingested.
export async function ingestEtsyOrder(
  input: EtsyOrderInput,
): Promise<EtsyIngestResult> {
  if (input.items.length === 0) {
    throw new Error("Etsy order must include at least one line item.");
  }

  const existing = await prisma.order.findUnique({
    where: {
      source_externalId: { source: "etsy", externalId: input.externalId },
    },
  });
  if (existing) {
    return {
      orderId: existing.id,
      status: "already_ingested",
      externalId: existing.externalId,
    };
  }

  const skuCodes = input.items.map((i) => i.skuCode);
  const skus = await prisma.sku.findMany({
    where: { code: { in: skuCodes } },
  });
  const skuByCode = new Map(skus.map((s) => [s.code, s]));
  for (const item of input.items) {
    if (!skuByCode.has(item.skuCode)) {
      throw new Error(`Unknown SKU "${item.skuCode}". Add it to the catalog first.`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid quantity for ${item.skuCode}: ${item.quantity}`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        source: "etsy",
        externalId: input.externalId,
        status: "paid",
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName ?? null,
        shippingAddress: (input.shippingAddress ?? {}) as object,
        totalCents: input.totalCents,
        currency: input.currency ?? "USD",
        placedAt: input.placedAt,
        notes: input.notes ?? null,
        items: {
          create: input.items.map((item) => ({
            skuId: skuByCode.get(item.skuCode)!.id,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
        },
      },
    });

    for (const item of input.items) {
      const sku = skuByCode.get(item.skuCode)!;
      if (sku.fulfillment === "made_to_order") {
        // Made-to-order SKUs don't deplete on-hand stock — they queue a
        // print. We still write a ledger entry so the order is traceable
        // from the SKU's history.
        await tx.inventoryEntry.create({
          data: {
            skuId: sku.id,
            deltaQty: 0,
            reason: "order_reserved",
            note: `etsy:${input.externalId} (made-to-order queue)`,
          },
        });
        continue;
      }
      await tx.sku.update({
        where: { id: sku.id },
        data: { onHandQty: { decrement: item.quantity } },
      });
      await tx.inventoryEntry.create({
        data: {
          skuId: sku.id,
          deltaQty: -item.quantity,
          reason: "order_reserved",
          note: `etsy:${input.externalId}`,
        },
      });
    }

    return {
      orderId: order.id,
      status: "created" as const,
      externalId: order.externalId,
    };
  });
}
