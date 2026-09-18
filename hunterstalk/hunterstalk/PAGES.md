# Deploy HunterStalk on Cloudflare Pages

Pages only serves files. The chat API is a **Pages Function** in `functions/`.  
Do **not** upload only `public/` and expect chat to work.

Upload / push the **whole hunterstalk folder** as the repo root so Cloudflare sees:

```
public/              ← website
functions/api/       ← chat API
wrangler.toml
```

---

## Step 1 — Put the project on GitHub

1. Unzip `hunterstalk.zip`.
2. Create a new GitHub repo (example name: `hunterstalk`).
3. Upload **everything inside** the `hunterstalk` folder to the repo root  
   (`public`, `functions`, `wrangler.toml`, `package.json`, …).
4. Commit to `main`.

If the repo root is a parent folder and `hunterstalk/` is nested, set **Root directory** to `hunterstalk` later in Pages.

---

## Step 2 — Create the Pages project

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**.
2. **Create** → **Pages** → **Connect to Git**.
3. Authorize GitHub and select the `hunterstalk` repo.
4. Build settings (this is a static + functions app, no framework):

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(leave empty)* |
   | Build output directory | `public` |

5. Click **Save and Deploy**.

First deploy gives you a URL like:

`https://hunterstalk.pages.dev`

The site will load. Creating a camp will fail until KV is bound. That is expected.

---

## Step 3 — Create KV (this stores camps + encrypted messages)

1. Dashboard → **Workers & Pages** → **KV**.
2. **Create a namespace**.
3. Name it `hunterstalk-store` (any name is fine).
4. Create.

---

## Step 4 — Bind KV to the Pages project

1. **Workers & Pages** → your **hunterstalk** Pages project.
2. **Settings** → **Bindings**.
3. **Add** → **KV namespace**.
4. Fill in exactly:

   | Field | Value |
   |---|---|
   | Variable name | `STORE` |
   | KV namespace | `hunterstalk-store` |

   Variable name must be `STORE` (capital letters). The function looks for `env.STORE`.

5. Save.
6. Do the same binding on the **Preview** environment if you use preview URLs.
7. **Deployments** → open the latest deployment → **Retry deployment**  
   (bindings only apply after a new deploy).

---

## Step 5 — Check it

1. Open `https://YOUR-PROJECT.pages.dev`
2. You should see HunterStalk (dark forest screen).
3. Open `https://YOUR-PROJECT.pages.dev/api/health`  
   You want: `"ok": true` and `"kv": true`.  
   If `"kv": false` or an error about STORE, the binding is missing — repeat Step 4 and redeploy.
4. Enter a callsign → **Start a camp** → copy the `HS-XXX-XXX` code.
5. On your phone (same URL) join with that code.
6. Send a message. Within ~2 seconds it should appear on the other device.

---

## Step 6 — Custom domain (optional, same as your other Pages sites)

1. Pages project → **Custom domains** → **Set up a domain**.
2. Add `chat.yourdomain.com` (or whatever you use).
3. Cloudflare attaches the certificate automatically if the domain is already on your account.

HTTPS is required for “Add to Home Screen” to behave like an app.

---

## What not to do

- Do **not** use **Direct Upload** of only the `public` folder. That skips `functions/` so `/api/*` 404s.
- Do **not** set the output directory to `/` or `.` — it must be `public`.
- Do **not** add a build command like `npm run build`. There is no build.

If you insist on CLI instead of Git:

```bash
cd hunterstalk
npx wrangler pages deploy public --project-name=hunterstalk
```

You still must add the `STORE` KV binding in the dashboard and redeploy. Wrangler uploads `public/` and, from this folder, also the `functions/` directory when you run the command from the project root:

```bash
npx wrangler pages deploy --project-name=hunterstalk
```

---

## After it is live

Send friends **two** things:

1. The Pages URL  
2. Your camp code (`HS-XXX-XXX`)

The URL is public. The code is the lock.
