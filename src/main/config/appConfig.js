// ─────────────────────────────────────────────────────────────────────────────
//  DISTRIBUTION SETTING — edit this ONE value before building installers.
// ─────────────────────────────────────────────────────────────────────────────
// A downloaded copy of the app has no localhost backend to talk to, so packaged
// builds point here instead. Set it to your DEPLOYED backend's public URL (e.g.
// the Render URL from render.yaml, like https://confero-server.onrender.com) and
// commit before tagging a release. No trailing slash.
//
// In development (unpackaged, `npx electron .`) this is ignored and the app uses
// http://localhost:8787. A CONFERO_BACKEND_URL env var overrides both.
module.exports = {
  backendUrl: 'https://confero-server.onrender.com',
};
