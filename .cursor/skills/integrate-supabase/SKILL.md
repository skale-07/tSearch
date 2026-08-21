---
name: integrate-supabase
description: >-
  Migrates tSearch persistence to Supabase and wires the hosted Vite UI to
  read it. Use when the user mentions Supabase, TSEARCH_STORE, Vercel hosting
  of the graph UI, dual-write from JSON stores, or RLS for people/profiles.
---

# Integrate Supabase

Follow [`docs/prompts/integrate-supabase.md`](../../../docs/prompts/integrate-supabase.md) as the source of truth.

Do not migrate in a single swap. Keep `TSEARCH_STORE=fs` until dual-write is proven. Never put the service-role key in `VITE_` env. Never commit person data. Assessment still reads a frozen candidate snapshot. Do not host Playwright or cookies.
