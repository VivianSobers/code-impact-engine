import { NextResponse } from "next/server";
import { authenticate, endSession, startSession } from "@/lib/auth/login";

// Sign in from scripts and API clients: POST {"username", "password"} sets the same
// session cookie as the login form. DELETE signs out.
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with username and password." }, { status: 400 });
  }
  const result = await authenticate(
    typeof body.username === "string" ? body.username : "",
    typeof body.password === "string" ? body.password : "",
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  await startSession(result.user);
  return NextResponse.json({ user: result.user });
}

export async function DELETE() {
  await endSession();
  return new NextResponse(null, { status: 204 });
}
