/**
 * Sur Slot - Web Push Backend (Cloudflare Worker)
 * Storage: Cloudflare KV (Binding name: PUSH_SUBS_KV) or D1
 * Standard RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID authentication)
 * Runs natively in Cloudflare Workers using Web Crypto API.
 */

const DEFAULT_VAPID_PUBLIC_KEY = 'BL2XK2UoL2SiH2v2-lexHyEde_d-cHkQ_aKl9f1kXnlBpaSvK22JxafBpOdpFaI3McnI-5ZRf7vRNgIyrfOTowE';
const DEFAULT_VAPID_PRIVATE_KEY = 'HGYQxTas9Gsl6hstdNkomvdjRnzCxv8pqyNVnyc5NX0';
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@surslot.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname;
    const kv = env.PUSH_SUBS_KV;

    try {
      if (request.method === 'GET' && (path === '/api/push/vapid-public-key' || path === '/vapid-public-key')) {
        const publicKey = env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
        return new Response(JSON.stringify({ publicKey }), { headers: CORS_HEADERS });
      }

      if (request.method === 'POST' && path === '/api/push/subscribe') {
        const body = await request.json();
        const { subscription, userId, name, mobile, role } = body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
          return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400, headers: CORS_HEADERS });
        }
        const subData = {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          userId: userId || '',
          name: name || '',
          mobile: (mobile || '').replace(/[^0-9]/g, ''),
          role: role || 'student',
          updatedAt: Date.now()
        };
        if (kv) await kv.put('sub:' + encodeURIComponent(subscription.endpoint), JSON.stringify(subData));
        return new Response(JSON.stringify({ success: true, message: 'Subscription saved', data: subData }), { status: 200, headers: CORS_HEADERS });
      }

      if (request.method === 'POST' && path === '/api/push/send') {
        const body = await request.json();
        const { target, notification } = body;
        if (!notification || !notification.title) return new Response(JSON.stringify({ error: 'Missing title' }), { status: 400, headers: CORS_HEADERS });
        const vapidKeys = {
          publicKey: env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
          privateKey: env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
          subject: env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
        };
        let targetSubs = [];
        if (kv) {
          const list = await kv.list({ prefix: 'sub:' });
          for (const key of list.keys) {
            const raw = await kv.get(key.name);
            if (raw) {
              try {
                const sub = JSON.parse(raw);
                if (matchesTarget(sub, target)) targetSubs.push(sub);
              } catch (e) {}
            }
          }
        }
        if (body.subscription) targetSubs.push(body.subscription);
        if (targetSubs.length === 0) return new Response(JSON.stringify({ success: true, sentCount: 0, message: 'No subscribers found' }), { headers: CORS_HEADERS });
        const results = await Promise.allSettled(targetSubs.map(sub => sendWebPush(sub, notification, vapidKeys)));
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
        return new Response(JSON.stringify({ success: true, total: targetSubs.length, sent: successful }), { headers: CORS_HEADERS });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  }
};

function matchesTarget(sub, target) {
  if (!target || target === 'all') return true;
  if (target.role && sub.role !== target.role) return false;
  if (target.name && sub.name && !sub.name.toLowerCase().includes(target.name.toLowerCase())) return false;
  if (target.mobile) {
    const cleanTgt = target.mobile.replace(/[^0-9]/g, '');
    const cleanSub = (sub.mobile || '').replace(/[^0-9]/g, '');
    if (cleanTgt && cleanSub && cleanTgt !== cleanSub) return false;
  }
  return true;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function uint8ArrayToUrlBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createVapidHeader(audience, subject, publicKeyStr, privateKeyStr) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };
  const encodedHeader = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = encodedHeader + '.' + encodedPayload;
  const rawPriv = urlBase64ToUint8Array(privateKeyStr);
  const rawPub = urlBase64ToUint8Array(publicKeyStr);
  const jwk = { kty: 'EC', crv: 'P-256', x: uint8ArrayToUrlBase64(rawPub.slice(1, 33)), y: uint8ArrayToUrlBase64(rawPub.slice(33, 65)), d: uint8ArrayToUrlBase64(rawPriv), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, new TextEncoder().encode(unsignedToken));
  const encodedSig = uint8ArrayToUrlBase64(new Uint8Array(signature));
  return 'vapid t=' + unsignedToken + '.' + encodedSig + ', k=' + publicKeyStr;
}

async function encryptPayload(clientP256dhStr, clientAuthStr, payloadString) {
  const userPublicKey = urlBase64ToUint8Array(clientP256dhStr);
  const userAuth = urlBase64ToUint8Array(clientAuthStr);
  const plaintext = new TextEncoder().encode(payloadString);
  const localKeypair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeypair.publicKey));
  const userKey = await crypto.subtle.importKey('raw', userPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, localKeypair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
  }
  const authInfo = new TextEncoder().encode('WebPush: info\0');
  const prkInfo = concatBuffers(authInfo, userPublicKey, localPubRaw);
  const ikm = await hkdf(userAuth, sharedSecret, prkInfo, 32);
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const contentEncryptionKey = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);
  const aesKey = await crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, ['encrypt']);
  const paddedPlaintext = new Uint8Array(plaintext.length + 2);
  paddedPlaintext.set(plaintext);
  paddedPlaintext[plaintext.length] = 2;
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, paddedPlaintext));
  const rsBuf = new Uint8Array(4);
  new DataView(rsBuf.buffer).setUint32(0, 4096);
  const header = concatBuffers(salt, rsBuf, new Uint8Array([localPubRaw.length]), localPubRaw);
  return concatBuffers(header, encrypted);
}

function concatBuffers(...arrays) {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function sendWebPush(subscription, notificationData, vapidKeys) {
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = url.protocol + '//' + url.host;
  const vapidHeader = await createVapidHeader(audience, vapidKeys.subject, vapidKeys.publicKey, vapidKeys.privateKey);
  const payloadString = JSON.stringify(notificationData);
  const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, payloadString);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'high'
    },
    body: body
  });
}