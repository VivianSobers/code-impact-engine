import type { SessionUser } from "./session";

export type Access = "allow" | "login" | 401 | 403;

const PUBLIC = [/^\/login$/, /^\/logout$/, /^\/_next\//, /^\/favicon\.ico$/];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isRead(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

// Who may do what. Developers can read everything; only admins can add repositories
// (the JSON route and the page's server action both POST), review clone clusters, or
// manage users.
export function accessFor(method: string, pathname: string, user: SessionUser | null): Access {
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return "allow";
  if (!user) return under(pathname, "/api") ? 401 : "login";
  if (user.role === "admin") return "allow";

  if (under(pathname, "/admin")) return 403;
  if (!isRead(method)) {
    for (const prefix of ["/repositories", "/api/repositories", "/clones", "/api/clones"]) {
      if (under(pathname, prefix)) return 403;
    }
  }
  return "allow";
}

// Where to go after signing in. Only paths on this site, and never back to /login.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (under(next.split("?")[0], "/login")) return "/dashboard";
  return next;
}
