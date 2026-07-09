# Confero

Real-time AI meeting & teaching assistant: live transcription, contextual talking
points, and a private overlay only you can see (hidden from screen shares).

## Structure

```
/                 Electron desktop app (main + renderer)
  src/main        Main process: windows, audio capture, transcription, LLM, IPC
  src/renderer    Overlay UI, onboarding, settings panel
  src/preload     contextBridge IPC surface
/server           Backend: auth + AI proxy (email keeps the API key server-side)
```

## Running locally (dev)

**Backend** (holds the Groq key, proxies AI, handles auth):
```
cd server
cp .env.example .env      # fill in GROQ_API_KEY
npm install
npm start                 # http://localhost:8787
```

**Desktop app**:
```
cp .env.example .env      # defaults to backend mode
npm install
npm start
```

First launch shows onboarding → sign in (browser) → the overlay. AI runs through
the backend, so end users never handle an API key.

## Config

All environment-driven (12-factor), so local → production differs only by env
values. Key settings:

- Desktop `.env`: `CONFERO_BACKEND_URL`, provider mode (`backend` by default).
- Server `.env`: `GROQ_API_KEY`, `JWT_SECRET`, optional `GOOGLE_CLIENT_ID/SECRET`
  (Google sign-in), optional `SMTP_*` (password-reset emails).

Secrets live only in `.env` files, which are gitignored. `.env.example` files
document the shape without secrets.

## Status

Local/dev build. Not yet code-signed or deployed. See the project plan for the
productization roadmap (deploy, custom domain, payments).
