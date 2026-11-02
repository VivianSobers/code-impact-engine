import { NextResponse } from "next/server";
import { IngestError } from "./ingest";
import { BadRequestError, NotFoundError } from "./params";

function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof IngestError) {
    return NextResponse.json({ error: error.message, log: error.log || undefined }, { status: error.status });
  }
  const code = pgCode(error);
  if (code === "22023" || code === "22P02") {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  if (code === "P0002") return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  console.error(error);
  return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
}

export async function handle<T>(work: () => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    return NextResponse.json(await work(), { status });
  } catch (error) {
    return errorResponse(error);
  }
}

export function orNotFound<T>(value: T | null, what: string): T {
  if (value === null) throw new NotFoundError(`${what} was not found`);
  return value;
}
