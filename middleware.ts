import { NextResponse, type NextRequest } from "next/server";
import { accessFor } from "@/lib/auth/access";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const user = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const access = accessFor(request.method, pathname, user);

  if (access === "allow") return NextResponse.next();
  if (access === "login") {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  const message = access === 401 ? "Sign in first." : "Only admins can do that.";
  return NextResponse.json({ error: message }, { status: access });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
