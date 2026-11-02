import { notFound } from "next/navigation";
import { BadRequestError, joinPathSegments, parseId } from "./params";

function orNotFound<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof BadRequestError) notFound();
    throw error;
  }
}

export function idOrNotFound(raw: string, label: string): number {
  return orNotFound(() => parseId(raw, label));
}

export function pathOrNotFound(segments: string[]): string {
  return orNotFound(() => joinPathSegments(segments));
}

export function safeId(raw: string): number | null {
  const id = Number(raw);
  return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(id) ? id : null;
}
