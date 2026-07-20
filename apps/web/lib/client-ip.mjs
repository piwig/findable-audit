// Determine the real client IP used as the per-IP rate-limit key.
//
// TRUST MODEL: this app binds 127.0.0.1 and MUST sit behind nginx. nginx is
// configured to set `X-Real-IP $remote_addr` and to APPEND the real client to
// `X-Forwarded-For`. We therefore trust, in order:
//   1. X-Real-IP           (nginx sets it to the real socket peer)
//   2. the LAST X-Forwarded-For hop (nginx appends the real client last;
//      earlier hops are attacker-controlled and must NOT be trusted)
//   3. the socket address  (direct connection, e.g. local testing)
//
// If this app is ever exposed WITHOUT such a proxy, a client can spoof both
// headers and forge the rate-limit key — see README.

/**
 * @param {{ headers: Record<string, string|string[]|undefined>, socket?: { remoteAddress?: string } }} req
 * @returns {string}
 */
export function clientIp(req) {
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim() !== '') return realIp.trim();

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]; // LAST hop = real client
  }

  return req.socket?.remoteAddress ?? 'unknown';
}
