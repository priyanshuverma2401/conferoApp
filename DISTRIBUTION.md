# Distributing Confero (downloadable installers for Windows, macOS, Linux)

This is the end-to-end path from "code on my machine" to "my users download an
installer from my website." Do the steps in order — the backend must be live
**before** any installer is useful.

There are two independent things to ship:

1. **The backend** (`server/`) — one always-on web service you host once. Holds
   the API keys; every installed app talks to it. **Must be public before builds
   work.**
2. **The desktop app** — the installers users download. Built by CI for all three
   OSes and attached to a GitHub Release.

---

## Part 1 — Deploy the backend (do this first)

The repo ships a Render blueprint (`render.yaml`). Render's free tier is enough to
start (note: free services sleep after inactivity and take ~30–60s to wake on the
first request).

1. Push this repo to GitHub if it isn't already.
2. **Create the database first** (see "Database" below) so you have its
   connection string ready — accounts won't persist without it.
3. Create an account at **render.com** → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and proposes the `confero-server` service.
4. Set the secret env vars in the Render dashboard (they are **not** in git):
   - `GROQ_API_KEY` — required (chat + Whisper transcription + snip OCR). Get one
     free at console.groq.com.
   - `MONGODB_URI` — required for real users; the connection string from the
     Database step below. Without it accounts are wiped on every restart.
   - `GEMINI_API_KEY` — optional armed fallback; from aistudio.google.com.
   - `JWT_SECRET` — Render generates this automatically (leave it).
   - `SERVER_PUBLIC_URL` — set **after** the first deploy to the URL Render gives
     you (see next step).
4. Deploy. Render gives you a public URL like
   `https://confero-server.onrender.com`.
5. Put that URL into `SERVER_PUBLIC_URL` in the dashboard and redeploy.
6. Verify it's live: open `https://<your-url>/health` in a browser — it should
   return `{"ok":true}`.

Keep that URL — you need it in Part 2.

### Database (free, permanent — MongoDB Atlas)

User accounts, plans, and login sessions live in MongoDB. On a free host the
local filesystem is wiped on restart, so a real database is required — without
`MONGODB_URI` set, the backend falls back to a local file and users lose their
logins on the next restart.

1. Go to **mongodb.com/atlas** → sign up (free).
2. Create a **free M0 cluster** (512 MB, free forever). Pick any cloud/region.
3. **Database Access** → add a database user (username + password). Save them.
4. **Network Access** → Add IP → **Allow access from anywhere** (`0.0.0.0/0`) —
   Render's IPs are dynamic, so this is required.
5. **Connect → Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Replace `USER`/`PASSWORD` with the ones from step 3.
6. Paste that into `MONGODB_URI` in the Render dashboard (step 4 above).

The app auto-creates the `confero` database and `users` collection on first run —
nothing else to set up. (Locally, leave `MONGODB_URI` unset and it uses a JSON
file so you can develop without Mongo.)

> Other providers (OpenAI, Anthropic, Mistral, …) work too: set that provider's
> key and change `CHAT_PROVIDER` in `render.yaml`. Groq is the default because it
> covers chat **and** Whisper **and** vision with one free key.

### Payments — "Upgrade to Premium" (Stripe)

DSA & System Design (and follow-up-aware answers) are **Premium**. The in-app
**✦ Upgrade** button opens Stripe Checkout; on payment a webhook flips the user's
plan to `premium`. Until you set the three keys below, the button politely says
"upgrades aren't available yet" — everything else works. To turn it on:

1. Create a **Stripe** account → **Product** with a recurring **Price**. Copy the
   price id (`price_...`).
2. In Render set (all secret, `sync:false`): `STRIPE_SECRET_KEY` (`sk_live_...`),
   `STRIPE_PRICE_ID` (`price_...`).
3. In Stripe → **Developers → Webhooks → Add endpoint**:
   `https://<your-render-url>/api/billing/webhook`, event
   `checkout.session.completed` (add `customer.subscription.deleted` to auto-
   downgrade on cancel). Copy the signing secret (`whsec_...`) into Render as
   `STRIPE_WEBHOOK_SECRET`. Without it the webhook still parses but is unverified
   — **required in production** so a plan can't be forged.

### Passwordless email login (OTP)

Users can sign in with a **6-digit email code** instead of a password (no setup
needed to work — but the code only actually *emails* when SMTP is configured).
The same `SMTP_*` vars that send password-reset emails send the codes. Without
SMTP, codes are logged to the server console (dev only). Set `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in Render to deliver them for real.

---

## Part 2 — Point the app at your backend

Edit **one** line: [`src/main/config/appConfig.js`](src/main/config/appConfig.js)

```js
module.exports = {
  backendUrl: 'https://confero-server.onrender.com', // ← your Render URL, no trailing slash
};
```

Commit it. Packaged builds use this URL; `npx electron .` in development still uses
`http://localhost:8787`. (An advanced user can override with a `CONFERO_BACKEND_URL`
env var, but normal users never touch it.)

---

## Part 3 — Cut a release (CI builds all three installers)

You are on Windows, which **cannot** build or sign a macOS `.dmg` — Apple requires
a Mac. That's why builds run in GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)), which has Mac,
Windows, and Linux runners.

To release:

```bash
# bump the version first (edit package.json "version", e.g. 0.1.0 -> 0.1.1)
git add -A && git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin main --tags
```

Pushing the `v*` tag triggers the workflow. It builds on all three OSes and
attaches the installers to a **GitHub Release** for that tag:

| Platform | File | Notes |
|---|---|---|
| Windows | `Confero-<ver>-Setup.exe` | NSIS installer, per-user (no admin needed) |
| macOS (Apple Silicon) | `Confero-<ver>-arm64.dmg` | M1/M2/M3/M4 Macs |
| macOS (Intel) | `Confero-<ver>-x64.dmg` | older Intel Macs |
| Linux | `Confero-<ver>-x86_64.AppImage` | runs on most distros |
| Linux | `Confero-<ver>-amd64.deb` | Debian/Ubuntu |

Watch progress in the repo's **Actions** tab. When it's green, the release exists
under **Releases** with the files attached. (You can also run the workflow manually
from the Actions tab to produce test artifacts without publishing a release.)

---

## Part 4 — Put download links on your website

Each GitHub Release asset has a stable direct URL. Two options:

- **Always-latest links** (recommended — never edit your site again):
  `https://github.com/<you>/<repo>/releases/latest/download/Confero-<ver>-Setup.exe`
  …except the filename contains the version, so for truly stable links either keep
  the version out of `artifactName`, or link to the Releases page and let users
  pick. Simplest robust choice: link the **Releases page** and detect the OS:

```html
<a href="https://github.com/<you>/<repo>/releases/latest">Download Confero</a>
```

- **Per-OS buttons**: copy the three asset URLs from the latest release into
  Windows / macOS / Linux buttons. Update them each release (or script it against
  the GitHub Releases API).

---

## Part 5 — Install instructions for your users (IMPORTANT — builds are unsigned)

v1 installers are **not code-signed**, so every OS shows a security warning. Put
these notes right next to the download buttons or users will bounce.

**Windows** — SmartScreen shows *"Windows protected your PC."*
→ Click **More info → Run anyway**.

**macOS** — Gatekeeper says the app *"cannot be opened because the developer cannot
be verified."*
→ **Right-click the app → Open → Open**, or **System Settings → Privacy & Security
→ Open Anyway**. (Also: `.dmg` → drag Confero to Applications first.)

**Linux (AppImage)** — make it executable, then run:
```bash
chmod +x Confero-*.AppImage
./Confero-*.AppImage
```

You can remove these warnings later by code-signing (Apple Developer $99/yr;
Windows via a cert or Azure Trusted Signing). Wire the certs into the same CI
workflow when you're ready.

---

## Platform support reality check

Confero was built and tested on **Windows**. Two core features are OS-sensitive and
need testing on the other platforms before you promote them as first-class:

- **Stealth (`setContentProtection`)** — reliable on Windows and macOS, but
  **limited or a no-op on Linux** (the overlay may be visible in screen-share on
  Linux). Treat Linux as "runs, but stealth not guaranteed."
- **System-audio capture** — the loopback capture of the *other* side of the call
  behaves differently per OS; test that interviewer audio is actually transcribed
  on macOS and Linux.

Recommendation: label the downloads **Windows (recommended)**, **macOS (beta)**,
**Linux (experimental)** until you've verified stealth + system audio on each.

---

## First-run experience for downloaded users

Because the app points at your hosted backend, a user's flow is: install → open →
**sign up / sign in** (email + password, handled by your backend) → use it. They
never see or need an API key. If you enabled the free Render tier, warn them the
very first request after idle can take ~30–60s while the server wakes.
