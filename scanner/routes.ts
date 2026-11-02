// Route strings look different in every framework ("/articles/:slug",
// "{id}", "<int:pk>", "^articles/(?P<slug>[-\w]+)/?$", `${API}/articles`).
// They are normalized to one shape so a frontend call can be matched to the
// backend route that serves it, whatever the two stacks are.

const PARAM = ":p";

export function normalizeRoute(raw: string): string | undefined {
  // Regex routes first: their "?" is not a query string.
  let s = raw
    .trim()
    .replace(/\(\?P?<\w+>[^)]*\)/g, PARAM) // Django / named regex groups
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\/\?$/, "")
    .replace(/\/\?(?=\/)/g, "/");
  const url = /^https?:\/\/[^/]+(\/.*)?$/i.exec(s);
  if (url) s = url[1] ?? "/";
  s = s.split(/[?#]/)[0];
  s = s
    .replace(/\$\{[^}]*\}/g, PARAM) // template literals
    .replace(/\{[^}]*\}/g, PARAM) // {id}, Python f-strings
    .replace(/<[^>]*>/g, PARAM) // <int:pk>
    .replace(/[\^$]/g, "");
  if (/\s/.test(s) || s.length > 160) return undefined;
  const segs = s
    .split("/")
    .filter(Boolean)
    .map((seg) => (/^[:*]/.test(seg) || seg.includes(PARAM) ? PARAM : seg.toLowerCase()));
  return "/" + segs.join("/");
}

export function joinRoutes(prefix: string, route: string): string {
  return normalizeRoute(`${prefix}/${route}`) ?? route;
}

// "/api", "/v1" and a base-URL placeholder at the front are deployment
// details: the client may call "/api/articles" for a server route "/articles".
function core(route: string): string[] {
  const segs = route.split("/").filter(Boolean);
  while (segs.length && (segs[0] === "api" || /^v\d+$/.test(segs[0]) || segs[0] === PARAM)) {
    segs.shift();
  }
  return segs;
}

/**
 * How well a client call matches a server route: -1 for no match, higher for
 * closer ones. Same segment (or param on both sides) scores 2, a param against
 * a literal 1, so "/articles/:p" prefers "/articles/:slug" over "/articles/feed".
 */
export function routeScore(call: string, served: string): number {
  const a = core(call);
  const b = core(served);
  if (a.length === 0 || a.length !== b.length) return -1;
  let score = 0;
  let literal = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) {
      score += 2;
      if (a[i] !== PARAM) literal++;
    } else if (a[i] === PARAM || b[i] === PARAM) score += 1;
    else return -1;
  }
  return literal > 0 ? score : -1;
}

export function routesMatch(call: string, served: string): boolean {
  return routeScore(call, served) >= 0;
}

/** Route-looking string worth keeping on its own (not inside a route call). */
export function looksLikeRoute(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (/\.(js|ts|css|scss|png|jpe?g|svg|gif|ico|html?|json|map|woff2?)$/i.test(value)) return false;
  return /[a-z]{2,}/i.test(value) && !/\s/.test(value);
}
