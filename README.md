# Aquavoy

AI agent platform for **Wence** (Aquavoy is Wence's company — same entity).

Current scope: a **OneDrive / Microsoft Graph integration** — connect a Microsoft
account via delegated OAuth and perform the full file surface (browse, download,
upload, create folders, rename/move/copy, delete, search) through a clean API.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Supabase** — OAuth token storage (`onedrive_connections`, service-role only)
- **Microsoft Graph** v1.0 — OneDrive operations

## Architecture

```
src/app/api/onedrive/*   ← route handlers (thin wiring)
src/lib/microsoft/
  oauth.ts               ← OAuth code/refresh flow (owns the token endpoint)
  graph.ts               ← Graph HTTP transport + error envelope
  onedrive.ts            ← file operations in internal DriveItem terms  ← the seam
  connections.ts         ← token persistence + auto-refresh (Supabase)
  types.ts               ← project-internal shapes
src/lib/supabase/server  ← service-role client adapter (server-only)
supabase/migrations      ← onedrive_connections table (RLS on, no policies)
```

The rest of the app talks to `onedrive.ts`; only that module knows Graph's shape.
Swapping endpoints or the auth model is a one-file change.

## Setup

### 1. Microsoft app registration (Entra / Azure AD)

1. https://entra.microsoft.com → **App registrations** → **New registration**.
2. Supported accounts: pick the type that matches `MICROSOFT_TENANT_ID`
   (`common` = work/school **and** personal).
3. **Redirect URI** (Web): `http://localhost:3000/api/onedrive/callback`
   (and your production URL later).
4. **Certificates & secrets** → new client secret → copy the value.
5. **API permissions** → Microsoft Graph → **Delegated**:
   `offline_access`, `User.Read`, `Files.ReadWrite.All` → Grant admin consent if
   required by the tenant.

### 2. Supabase

```bash
npx supabase link        # link to the Aquavoy Supabase project
npx supabase db push     # applies supabase/migrations/0001_onedrive_connections.sql
```

### 3. Env

```bash
cp .env.example .env.local
# fill: MICROSOFT_CLIENT_ID / _SECRET / _TENANT_ID, APP_BASE_URL,
#       NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

### 4. Run

```bash
npm install
npm run dev      # http://localhost:3000 → "Connect OneDrive"
```

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET    | `/api/onedrive/connect` | Start OAuth → redirect to Microsoft |
| GET    | `/api/onedrive/callback` | OAuth return → store connection |
| GET    | `/api/onedrive/connections` | List connected accounts (no tokens) |
| GET    | `/api/onedrive/files?itemId=\|path=` | List folder children |
| GET    | `/api/onedrive/download?itemId=` | Redirect to pre-authed download URL |
| POST   | `/api/onedrive/upload` | Multipart upload (small + chunked) |
| POST   | `/api/onedrive/folder` | Create folder |
| PATCH  | `/api/onedrive/item` | Rename / move / copy |
| DELETE | `/api/onedrive/item?itemId=` | Delete |
| GET    | `/api/onedrive/search?q=` | Full-text drive search |

All file routes accept an optional `connectionId`; without it they use the most
recently connected account.

## Notes / next steps

- **Auth model:** delegated (each user connects their own OneDrive). Swap to
  app-only (client-credentials, one company drive) by changing `oauth.ts` +
  the Graph paths in `onedrive.ts` from `/me/drive` to `/drives/{id}`.
- **Multi-tenant mapping:** connections are keyed by Microsoft user id. When app
  auth lands, link `onedrive_connections` to `auth.uid()` and add an RLS policy.

---

Built by [Qualia Solutions](https://qualiasolutions.net)
