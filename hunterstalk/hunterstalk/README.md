# HunterStalk

Private camp chat for you and your friends. Works in the browser, installs as an app, and keeps talking when the signal drops.

**Tagline:** Talk in the wild. Stay off the grid.

## What you have now (v0.1 MVP)

A working **web + installable app (PWA)** you can run on a laptop and phones:

- Create a private **camp** and get a code like `HS-K7M-4QP`
- Friends join with that code only — no public directory, no phone numbers
- Messages are **encrypted in the browser** with a key derived from the camp code. The relay stores ciphertext only.
- **Offline:** compose while off-grid. Messages queue locally and flush when you reconnect. History lives in IndexedDB so you can read old signals without a network.
- Presence: who is on the wire vs last seen
- Install to the home screen on iOS / Android / desktop (Add to Home Screen)

This is the seed of a platform, not WhatsApp-scale infrastructure. See the roadmap below.

## Run it

```bash
cd hunterstalk
node server.js
```

Open http://localhost:3847

1. Enter a callsign
2. Click **Start a camp**
3. Copy the invite code from the header
4. Open the same URL on another phone/browser, join with that code
5. Turn on airplane mode, send a message, then reconnect — it delivers

To use it with friends over the internet, put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel, or a VPS). Service workers and installable PWA require HTTPS except on localhost.

Step-by-step hosts: see **DEPLOY.md**. Fastest: Render (free HTTPS) or `cloudflared tunnel --url http://localhost:3847`.

## How privacy works in this MVP

```
You  --AES-GCM(camp code)-->  relay  --ciphertext-->  friend
         ▲                         ▲
    key never leaves           server cannot read
    the devices that           or search messages
    know the camp code
```

This is **shared-secret group encryption**, not the Signal protocol.

- Good for a trusted friend circle that already shares the code out-of-band
- If the code leaks, an outsider who joins can read new (and stored) ciphertext
- No forward secrecy: a stolen code decrypts history that used the same key
- The relay still sees metadata: who is in which camp, when they send, approximate size

That is honest. A “big platform” needs per-device identity keys and the Double Ratchet. The roadmap covers that.

## Product model

| Concept | Meaning |
|---|---|
| Camp | Private room. Code is invite + encryption secret |
| Callsign | Display name on this device |
| Device id | Anonymous uuid stored locally — no email/phone required |
| Relay | Dumb store-and-forward of ciphertext + presence |

## Architecture — from this MVP to a real platform

```
                    ┌──────────────┐
   Web PWA  ───────►│              │
   iOS app  ───────►│  Edge / API  │──► Postgres (camps, devices, ciphertext)
   Android  ───────►│  + WS mesh   │──► Redis (presence, fanout)
   Desktop  ───────►│              │──► Object store (encrypted attachments)
                    └──────────────┘
                           │
                     Push (FCM / APNs)
                           │
                     Local SQLite on device (offline)
```

### Recommended stack when you scale

| Layer | Now | Next |
|---|---|---|
| Clients | This PWA | Flutter or React Native wrapping the same protocol; keep PWA |
| Transport | Socket.io | Socket.io or WebSocket + HTTP fallback; QUIC later |
| Auth | Camp code | Device identity keys + optional passkeys. Still no phone required |
| Crypto | AES-GCM from camp code | X3DH + Double Ratchet (libsignal) per 1:1; sender keys for camps |
| Store | `data/store.json` | Postgres + object storage. Ciphertext and metadata only |
| Offline | IndexedDB + outbox | Same pattern + background sync + push |
| Media | Text only | Encrypted blobs, voice notes, optional location drops |
| Hosting | One Node process | 2+ API nodes, Redis pub/sub for sockets, CDN for the shell |

### Why PWA first

One codebase already is the web app *and* the phone app. Native wrappers (Capacitor / PWABuilder) can put HunterStalk on the App Store and Play Store without rewriting chat. Build native only when you need background push reliability or Bluetooth mesh for true zero-internet field use.

## Roadmap

**v0.2 — usable with a hunting party**
- Encrypted image / voice note attachments
- Read receipts (optional, camp-level toggle)
- Mute / mention
- Export / burn camp history from this device

**v0.3 — real accounts without becoming a data company**
- Passkey login to restore camps across devices
- Per-device keys so a stolen camp code cannot decrypt old history
- Push notifications

**v1.0 — platform**
- Signal-protocol 1:1 DMs inside a camp
- Moderated public “trail boards” (optional, separate from private camps)
- Self-host package so a club can run their own relay
- Audit / transparency report

**Field mode (the offline that actually matters in the woods)**
- Bluetooth / Wi-Fi Direct mesh between nearby devices (Briar-style)
- Sync the mesh to the relay when anyone in the party gets a bar of signal
- Offline topo-friendly UI (large type, dark, glove-friendly tap targets)

## Name & brand

- **HunterStalk** — private signals among a trusted party
- Palette: forest night `#07110c`, moss, bone, amber
- Mark: antler becoming a radio wave (see `public/icons`)

The name is unused as a chat product. Check trademarks in your country before you spend on stores and a domain. Sensible domains to hunt: `hunterstalk.app`, `hunterstalk.com`, `hstalk.app`.

## What this is not

- Not a stalking tool and not for non-consensual tracking
- Not a replacement for Signal / Session on day one
- Not multi-region, moderated, or legally hardened

If you take this public, add a clear acceptable-use policy, abuse contacts, and age gate. Private friend chat still attracts bad actors once it is “a platform.”

## License

You own this copy. Ship it, fork it, self-host it.
