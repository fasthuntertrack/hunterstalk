# Deploy HunterStalk

You only need the `hunterstalk` folder (or the zip). Unzip it, then pick one path.

HTTPS is required if friends will install the app on their phones.

## A. Easiest public URL — Render (about 5 minutes, free)

1. Create a GitHub repo and upload the `hunterstalk` folder (or push this folder as the repo root).
2. Go to https://render.com → **New** → **Web Service** → connect that repo.
3. Settings:
   - Runtime: Node
   - Build command: leave empty or `true`
   - Start command: `node server.js`
4. Create the service. Render gives you `https://something.onrender.com`.
5. Send that URL to friends. They join with your camp code.

Free tier sleeps after idle. First load after sleep takes ~30 seconds. Fine for a friend group.

## B. Fastest from your own computer — Cloudflare Tunnel (no VPS)

If you can already run it locally:

```bash
cd hunterstalk
node server.js
```

In another terminal, after installing cloudflared:

```bash
cloudflared tunnel --url http://localhost:3847
```

It prints an `https://….trycloudflare.com` link. Share that. It lasts until you stop the tunnel.

## C. Fly.io (good if you want it always on)

```bash
# install flyctl, then:
cd hunterstalk
fly launch --name hunterstalk-YOURNAME --copy-config --now
```

## D. Any VPS (DigitalOcean, Hetzner, Oracle free tier)

```bash
# on the server
sudo apt update && sudo apt install -y nodejs nginx
# copy hunterstalk/ onto the machine
cd hunterstalk
node server.js
```

Put Nginx or Caddy in front with HTTPS (Caddy is easiest — it gets the certificate for you):

```
hunterstalk.yourdomain.com {
    reverse_proxy localhost:3847
}
```

Keep it running with systemd or `tmux`.

## After it is live

1. Open the HTTPS URL on your phone.
2. Start a camp, tap **Invite**, copy the code.
3. Friends open the same URL → callsign → paste code.
4. iPhone: Share → Add to Home Screen. Android: Chrome menu → Install app.

## What you do not need

- No database to provision
- No npm install
- No Docker unless you want it (Dockerfile is included)
- No App Store account for the PWA

## Caveats on free hosts

Message history lives in `data/store.json` on the server disk. Free hosts can wipe that on restart. For a real camp, use a VPS with persistent disk, or we can add a tiny Postgres later.

Camp codes are the secret. Do not post the public URL + code on a public page together.
