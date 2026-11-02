export class BadRequestError extends Error {}

export class NotFoundError extends Error {}

export function parseId(raw: string | null | undefined, label: string): number {
  if (raw == null || !/^[1-9][0-9]{0,15}$/.test(raw)) {
    throw new BadRequestError(`${label} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new BadRequestError(`${label} is too large`);
  return value;
}

export function parseOptionalId(raw: string | null | undefined, label: string): number | null {
  if (raw == null || raw === "") return null;
  return parseId(raw, label);
}

export function parseBoundedInt(
  raw: string | null | undefined,
  label: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (raw == null || raw === "") return fallback;
  if (!/^-?[0-9]+$/.test(raw)) throw new BadRequestError(`${label} must be a whole number`);
  const value = Number(raw);
  if (value < min || value > max) throw new BadRequestError(`${label} must be between ${min} and ${max}`);
  return value;
}

export function joinPathSegments(segments: string[]): string {
  const path = segments.map((s) => decodeURIComponent(s)).join("/");
  if (path === "" || path.startsWith("/") || path.split("/").some((s) => s === "" || s === "." || s === "..")) {
    throw new BadRequestError("file path is not valid");
  }
  return path;
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
