# Catalog & inventory model

The single source of truth for what we sell and how much of it we can produce.
The webshop, the admin CLI, and every marketplace integration read from this
model. There is no parallel SKU list anywhere.

## Domain shape

```
Product ──< ProductVariant ──< Sku ──< InventoryEntry
(slug)      (name, price)     (code,    (delta, reason,
                               fulfill,  timestamp)
                               on-hand,
                               print
                               minutes,
                               grams)
```

- **Product** — the customer-facing concept ("Hexagonal Planter"). Identified
  by a URL-friendly `slug` and surfaced on the storefront.
- **ProductVariant** — a specific buyable configuration of a product, e.g.
  "Small / Sage". Carries its own price and a free-form `options` JSON blob
  (e.g. `{ "size": "small", "color": "sage" }`) so we do not commit to a
  fixed axis list before we have data on what axes matter. Unique by
  `(productId, name)`.
- **Sku** — the unit of inventory and the thing every marketplace listing
  keys off. One-to-one with `ProductVariant` today; kept as a separate
  table so we can later let multiple variants share a SKU (bundles, kits)
  without a schema rewrite.
- **InventoryEntry** — append-only ledger. Every change to `onHandQty`
  records a row here so we can audit movements. Written by the order
  pipeline (later issues); the admin CLI exposes it for inspection.

Pricing lives on the variant (`priceCents`, `currency`). Tax, shipping,
and discounts are not modeled here — they belong on the order, not the
catalog.

## Inventory accounting

Each SKU declares how we plan to satisfy demand for it. The mode drives
which fields matter:

| `fulfillment`   | What it means                                                | Stock signal                    |
| --------------- | ------------------------------------------------------------ | ------------------------------- |
| `in_stock`      | Ship from buffer only. We will not print on demand.          | `onHandQty > 0`                 |
| `made_to_order` | Print after the order. We never carry buffer.                | open queue slots vs `madeToOrderCap` |
| `hybrid`        | Ship from buffer if available, else queue a print.           | `onHandQty > 0` OR queue slots free |

Made-to-order economics travel with the SKU so we can later compute lead
time and printer capacity without re-modeling:

- `printTimeMinutes` — bench time per unit. A `190m` SKU pins a printer
  for 3h 10m per order.
- `materialGrams` — filament grams per unit. Used to project filament
  spend per SKU and per order.
- `material` — what we print it in (currently free text; will become an
  enum once the material list stabilizes).
- `madeToOrderCap` — soft cap on how many we will accept on the queue
  before the SKU is marked unavailable. `null` means uncapped.

`onHandQty` is the only field the order pipeline mutates at sell time
(decrement on reservation, increment on cancel). Every mutation must
write a paired `InventoryEntry` row with a `reason` so the ledger and the
counter never drift.

## Migrations

We use Prisma with one migrations directory: `prisma/migrations/`.
Migration history is the contract — we never destructively reset prod
or staging after data exists. Locally, `npm run db:reset` is fine; on
shared environments, only `prisma migrate deploy` runs.

## Local development

The repo ships with a docker (nerdctl) postgres helper, used by the
admin CLI and the seed script.

```bash
# 1. Boot Postgres (one-off; survives across sessions).
nerdctl run -d --name printshop-postgres \
  -e POSTGRES_PASSWORD=printshop \
  -e POSTGRES_USER=printshop \
  -e POSTGRES_DB=printshop \
  -p 5544:5432 \
  postgres:16-alpine

# 2. Point Prisma at it (already the default in .env.example).
cp .env.example .env

# 3. Apply migrations + seed example products.
npm run db:migrate
npm run db:seed
```

The admin CLI lives at `scripts/admin.ts`:

```bash
# List the catalog (products with variants + SKUs + stock + print economics).
npm run admin -- product:list

# Inspect a single product (full JSON, including the inventory ledger).
npm run admin -- product:show hex-planter

# Create a new product end-to-end. The CLI requires one variant + SKU on
# create to keep the model coherent; add more variants via Prisma Studio
# (`npx prisma studio`) or follow-up CLI commands.
npm run admin -- product:create \
  --slug succulent-saucer \
  --title "Succulent Saucer" \
  --status active \
  --variant Default \
  --sku SAUCER-STD \
  --price-cents 700 \
  --fulfillment in_stock \
  --print-minutes 22 \
  --material-grams 9 \
  --material PLA \
  --on-hand 30
```

## Production (deferred)

Production points `DATABASE_URL` at a managed Neon Postgres instance —
provisioning is owned by the CEO and is its own ticket. The application
code is unchanged: Prisma talks to whichever Postgres `DATABASE_URL`
points at. CI generates the Prisma client via `postinstall`; only
deploy steps that actually run migrations need a real `DATABASE_URL`.

## Why this shape

- **One catalog, many surfaces.** Webshop and marketplace integrations both
  read `Product → Variant → Sku`. There is no second "Etsy catalog" or
  "eBay catalog" — listings on those marketplaces are derived from these
  rows.
- **Inventory is physical.** Print time and material grams travel with the
  SKU so we can later answer "what is our printer utilization?" without
  rewriting the schema. We resisted the temptation to model this in a
  separate `manufacturing_spec` table until we have a second
  manufacturing process to justify the split.
- **Ledger over counter.** A bare `onHandQty` is easy to corrupt and
  impossible to audit; the `InventoryEntry` ledger means we can always
  reconstruct "how did we get here".
- **JSON for variant options (for now).** Until we know what axes
  customers actually shop on, a typed `options` table is over-fit.
  We can promote it once we have evidence (e.g., "color filter on the
  storefront"). The unique `(productId, name)` constraint keeps the
  variant list sane in the meantime.
