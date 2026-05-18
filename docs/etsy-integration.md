# Etsy integration

Etsy is the first marketplace surface for our catalog. The catalog
(`Product → ProductVariant → Sku`) is the source of truth; Etsy listings
are a projection of it. Orders placed on Etsy land in the same `Order`
table the webshop will write to, tagged with `source: "etsy"`.

## Why CSV-first

The full Etsy API requires an Etsy Shop, a developer account, and an
approved app with OAuth scopes. Approval takes days to weeks and the
business cannot wait for it before listing anything. So the current
integration is operator-driven CSV export + manual order ingest:

1. We export the catalog as a CSV the operator can copy into Etsy's
   listing UI (or hand to a third-party bulk uploader like Vela).
2. When an order arrives, the operator runs an ingest CLI that creates
   an `Order` row in our DB, tagged `source: "etsy"`, and updates
   inventory exactly the way a webshop order would.

The follow-up issue covers replacing both halves with the real Etsy API
(OAuth, listing sync, webhook order ingest).

## Listing export

```bash
# Print to stdout
npm run admin -- etsy:export-listings

# Write to a file
npm run admin -- etsy:export-listings --out etsy-listings.csv
```

Only `status = active` products are exported. Each variant becomes one
listing keyed by SKU code.

Columns:

| Column                    | Source                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `sku`                     | `Sku.code`                                                                                        |
| `title`                   | `"{Product.title} — {Variant.name}"`                                                              |
| `description`             | `Product.description`                                                                             |
| `price`                   | `Variant.priceCents / 100` (two decimals)                                                         |
| `currency`                | `Variant.currency`                                                                                |
| `quantity`                | `in_stock`: `onHandQty`. `made_to_order`: `madeToOrderCap` (or 50 if uncapped). `hybrid`: sum.   |
| `fulfillment`             | `Sku.fulfillment`                                                                                 |
| `lead_time_business_days` | `in_stock`: 1. Otherwise `ceil(printTimeMinutes / 480) + 1`.                                      |
| `material`                | `Sku.material`                                                                                    |
| `tags`                    | Pipe-separated; derived from product title words, variant options, plus `3d-printed` & `made-to-order`. Capped at 13 (Etsy's limit). |

Operator workflow:

1. Run `npm run admin -- etsy:export-listings --out etsy-listings.csv`.
2. Open the CSV. For each row create the matching listing in Etsy's UI
   (or paste into a bulk uploader). Always set the SKU field on the
   Etsy listing to match our `sku` column — that is how order ingest
   resolves back to our catalog.
3. Re-run whenever the catalog changes meaningfully; diff and update
   only the affected listings.

## Order ingest (manual)

When an Etsy order email arrives, the operator runs:

```bash
npm run admin -- etsy:ingest-order \
  --external-id 3001456789 \
  --buyer-email buyer@example.com \
  --buyer-name "Sam Buyer" \
  --total-cents 3600 \
  --currency USD \
  --placed-at 2026-05-18T14:30:00Z \
  --items 'HEX-SM-SAGE:1:1800,CABLE-COMB-BLK:2:900' \
  --shipping-json '{"name":"Sam Buyer","line1":"123 Maple St","city":"Portland","state":"OR","postal":"97201","country":"US"}'
```

Field rules:

- `--external-id`: Etsy receipt id. `(source, external-id)` is unique;
  re-running the same command is a no-op (idempotent), so it is safe to
  retry on partial failure.
- `--items`: comma-separated `SKU:qty:unitPriceCents`. SKUs must already
  exist in the catalog — the ingest aborts otherwise.
- `--total-cents` and `--unitPriceCents` are minor units (cents).
- `--placed-at`: ISO 8601 (UTC preferred).
- `--shipping-json`: optional, free-form JSON. Stored as-is on the order;
  shipping integration will normalize it later.

Side effects on a successful ingest:

- One `Order` row (`source = etsy`, `status = paid`).
- One `OrderItem` row per line item.
- For `in_stock` and `hybrid` SKUs: `Sku.onHandQty` is decremented and
  an `InventoryEntry` row is written with `reason = order_reserved`.
- For `made_to_order` SKUs: no decrement, but a zero-delta
  `InventoryEntry` is written so the SKU history shows the queued order.

## Listing orders

```bash
npm run admin -- order:list                  # all sources
npm run admin -- order:list --source etsy    # Etsy only
```

## Safety / governance

- The CLI never logs the buyer email or address payload. Inspect orders
  with `order:list` or Prisma Studio when an operator needs the address
  to ship.
- The CLI does not call out to Etsy. There are no Etsy credentials to
  manage in this fallback mode — the secret-handling story matters only
  when the API integration lands.
- Orders are never inserted twice. If a manual ingest is interrupted,
  re-running it with the same `--external-id` is safe.

## Follow-up: full Etsy API integration

Tracked in a separate issue. Scope:

- Etsy app registration, OAuth flow, refresh-token handling. Credentials
  live in env (`ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET`, per-shop
  `ETSY_OAUTH_TOKEN`), never in the repo.
- Push listings from the catalog to Etsy via `listings/v3` (replacing
  the CSV operator step).
- Webhook receiver for new Etsy receipts that calls `ingestEtsyOrder`
  with the same shape used here.
- Reconciliation job: backfill any orders the webhook missed while we
  were down.
