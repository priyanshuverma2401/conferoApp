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
2. Create an account at **render.com** → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and proposes the `confero-server` service.
3. Set the secret env vars in the Render dashboard (they are **not** in git):
   - `GROQ_API_KEY` — required (chat + Whisper transcription + snip OCR). Get one
     free at console.groq.com.
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

> Other providers (OpenAI, Anthropic, Mistral, …) work too: set that provider's
> key and change `CHAT_PROVIDER` in `render.yaml`. Groq is the default because it
> covers chat **and** Whisper **and** vision with one free key.

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
