import { NextResponse } from "next/server";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const unauthorized = () => fail("Non autorisé", 401);

export async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** A trimmed string field within a size limit, or null when missing or invalid. */
export function text(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length >= min && v.length <= max ? v : null;
}

export const email = (value: unknown) => {
  const v = text(value, 200)?.toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};

export const MAX_NAME = 80;
export const MAX_MESSAGE = 8000;
export const MAX_FILES_PER_MESSAGE = 10;
