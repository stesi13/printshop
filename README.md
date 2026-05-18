# Printshop

The customer-facing webshop for a small 3D-printed-goods business. This repo will grow into the catalog, checkout, and marketplace-integration surface. Right now it ships a placeholder home page so we have a deploy pipeline to push real work through.

## Stack rationale

**Next.js + TypeScript** is the boring full-stack default for a JS webshop, and it gets us to a paid Stripe checkout the fastest. **Managed Postgres** (Neon, picked when STE-4 lands) will be the single source of truth for catalog and inventory — read by both the storefront and every marketplace integration. **Stripe** owns payments; we never touch card data. **Vercel** is the intended production host (native Next.js runtime, free Hobby tier to start). For this bootstrap milestone we deploy the static-exported placeholder to **GitHub Pages** via GitHub Actions because it requires zero external accounts and is fully reversible — we'll switch staging over to Vercel once we add server-rendered routes (catalog, checkout) in [STE-4](../../issues) / [STE-5](../../issues). Choice graded against the time-to-first-paid-order lens.

## Repo layout

- `app/` — Next.js App Router pages.
- `next.config.mjs` — configured for static export so we can host the placeholder on GitHub Pages. The `basePath` defaults to `/printshop` in production and is overridable via `NEXT_PUBLIC_BASE_PATH`.
- `.github/workflows/ci.yml` — lint + typecheck on every push and PR.
- `.github/workflows/deploy.yml` — builds and publishes to GitHub Pages on push to `main`.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run lint
npm run typecheck
npm run build        # produces ./out/ for static hosting
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the static export and publishes it to GitHub Pages. The staging URL is the repo's Pages URL (set on first deploy under **Settings → Pages**).

When we move staging to Vercel, this workflow gets retired and Vercel takes over via its GitHub app.
