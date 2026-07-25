const config = require('./config');
const userStore = require('./userStore');

// PayPal billing for the "Upgrade to Premium" flow. Uses PayPal's REST
// Subscriptions API directly over fetch (no SDK dependency). Guarded by
// config.billingEnabled so the server runs fine with no PayPal keys — the checkout
// route then returns a friendly "not set up yet" message (like Google sign-in).
//
// Flow: createCheckoutSession() creates a subscription in APPROVAL_PENDING state
// and returns PayPal's hosted approval URL. The app opens it in the browser; the
// user approves; PayPal activates the subscription and POSTs a
// BILLING.SUBSCRIPTION.ACTIVATED webhook here, which flips the user's plan to
// premium. We stamp the user id on the subscription (custom_id) so the webhook
// knows whose plan to flip — never trusting anything the browser sends back.

// PayPal API base — sandbox for testing, live for real money. Switch with PAYPAL_ENV.
function apiBase() {
  return config.paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

// OAuth2 client-credentials token. Short-lived; we fetch a fresh one per operation
// (billing calls are infrequent, so caching isn't worth the staleness risk).
async function getAccessToken() {
  const creds = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
  const r = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(`PayPal auth failed: ${data.error_description || data.error || r.status}`);
  }
  return data.access_token;
}

// Creates a PayPal subscription for the signed-in user and returns its hosted
// approval URL. The app opens this in the user's browser. custom_id carries the
// user id so the webhook can attribute the activation without trusting the client.
async function createCheckoutSession(user) {
  if (!config.billingEnabled) {
    const err = new Error('Upgrades aren\'t available yet. Please check back soon.');
    err.status = 503;
    throw err;
  }

  const token = await getAccessToken();
  const r = await fetch(`${apiBase()}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: config.paypalPlanId,
      custom_id: user.id,
      subscriber: { email_address: user.email },
      application_context: {
        brand_name: 'Confero',
        user_action: 'SUBSCRIBE_NOW',
        shipping_preference: 'NO_SHIPPING',
        payment_method: { payer_selected: 'PAYPAL', payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' },
        return_url: `${config.serverPublicUrl}/upgraded.html`,
        cancel_url: `${config.serverPublicUrl}/upgraded.html?canceled=1`,
      },
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`PayPal subscription failed: ${data.message || r.status}`);
  }
  const approve = (data.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error('PayPal did not return an approval link.');
  return { url: approve.href };
}

// Verifies a webhook came from PayPal by asking PayPal to check the signature
// headers against our webhook id. Mirrors Stripe's signature check. When
// PAYPAL_WEBHOOK_ID is unset (dev/testing) we skip verification — NEVER rely on
// that in production, or events could be forged.
async function verifyWebhook(headers, event) {
  if (!config.paypalWebhookId) return true; // dev fallback — see note above
  const token = await getAccessToken();
  const r = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypalWebhookId,
      webhook_event: event,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return data.verification_status === 'SUCCESS';
}

// Webhook handler. PayPal POSTs raw bytes here; the route passes the raw body plus
// all request headers so we can verify the signature before acting on it.
async function handleWebhook(rawBody, headers) {
  if (!config.billingEnabled) throw new Error('Billing not configured.');

  const event = JSON.parse(rawBody.toString('utf-8'));
  const ok = await verifyWebhook(headers, event);
  if (!ok) throw new Error('Webhook signature verification failed.');

  const resource = event.resource || {};
  const userId = resource.custom_id;

  switch (event.event_type) {
    // Subscription approved + first payment taken → grant premium.
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      if (userId) {
        await userStore.setPlan(userId, 'premium');
        if (resource.id) await userStore.updateUser(userId, { paypalSubscriptionId: resource.id });
      }
      break;
    }
    // Subscription ended (canceled, expired, or suspended for non-payment) — drop
    // the user back to free so entitlements match what they're paying for.
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      if (userId) await userStore.setPlan(userId, 'free');
      break;
    }
    default:
      break; // ignore everything else
  }

  return { received: true };
}

module.exports = { createCheckoutSession, handleWebhook };
