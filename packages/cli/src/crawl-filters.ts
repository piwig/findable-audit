/** Extensions that are never HTML pages worth crawling. */
export const NON_PAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|mp4|webm|css|js|json|xml|txt)$/i;

/** Infrastructure endpoints injected by CDNs/WAFs (e.g. Cloudflare email
 *  protection at /cdn-cgi/l/email-protection) — never real content pages. */
export const INFRA_PATH = /^\/cdn-cgi\//i;

/** true when a pathname is a crawlable content path (not an infra endpoint). */
export function isContentPath(pathname: string): boolean {
  return !INFRA_PATH.test(pathname);
}
