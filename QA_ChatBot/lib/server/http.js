import { NextResponse } from "next/server";
import { logger } from "./logger";

export const json = (data, status = 200) => NextResponse.json(data, { status });
export const fail = (message, status = 400, extra = {}) => NextResponse.json({ error: message, ...extra }, { status });

// In-memory sliding-window limiter keyed by client IP and bucket name.
const hits = (globalThis.__qaBrainRate ||= new Map());

export function rateLimit(req, bucket, { limit, windowMs }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}`;
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return fail(`Too many requests. Please wait ${Math.ceil((windowMs - (t - arr[0])) / 1000)}s and try again.`, 429);
  }
  arr.push(t);
  hits.set(key, arr);
  return null;
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Wraps a route handler so unexpected errors are logged and return a clean 500.
export function handler(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      logger.error("request failed", { path: new URL(req.url).pathname, error: err.message });
      return fail("Something went wrong on the server. Please try again.", 500);
    }
  };
}

export const isId = (s) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export function str(value, { max = 200, min = 1 } = {}) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length >= min && v.length <= max ? v : null;
}
