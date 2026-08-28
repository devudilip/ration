/**
 * Tiny combinator-style schema validator. Hand-rolled instead of zod to keep
 * the extension at zero runtime dependencies (an auditability commitment, see
 * README) — our needs are narrow: objects, primitives, arrays, nullable /
 * optional fields, and named variants so adapters can log which known
 * response shape matched.
 *
 * The one non-negotiable semantic: a mismatch is a failure with a precise
 * path. Nothing is ever coerced or defaulted — a shape drift must surface as
 * an error state, never as a confidently wrong zero.
 */

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; path: string; expected: string };

export type Schema<T> = (value: unknown, path: string) => Result<T>;

const fail = (path: string, expected: string): Result<never> => ({ ok: false, path, expected });

export const num: Schema<number> = (v, path) =>
  typeof v === 'number' && Number.isFinite(v) ? { ok: true, value: v } : fail(path, 'number');

export const str: Schema<string> = (v, path) =>
  typeof v === 'string' ? { ok: true, value: v } : fail(path, 'string');

export const bool: Schema<boolean> = (v, path) =>
  typeof v === 'boolean' ? { ok: true, value: v } : fail(path, 'boolean');

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return (v, path) => (v === null ? { ok: true, value: null } : schema(v, path));
}

/** Missing or undefined is accepted as undefined; present values must match. */
export function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return (v, path) => (v === undefined ? { ok: true, value: undefined } : schema(v, path));
}

export function arr<T>(schema: Schema<T>): Schema<T[]> {
  return (v, path) => {
    if (!Array.isArray(v)) return fail(path, 'array');
    const out: T[] = [];
    for (let i = 0; i < v.length; i++) {
      const r = schema(v[i], `${path}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  };
}

export function obj<T extends object>(shape: {
  [K in keyof T]: Schema<T[K]>;
}): Schema<T> {
  return (v, path) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'object');
    const out = {} as T;
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      const r = shape[key]((v as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      if (!r.ok) return r;
      out[key] = r.value;
    }
    return { ok: true, value: out };
  };
}

export type VariantResult<T> =
  | { ok: true; variant: string; value: T }
  | { ok: false; errors: { variant: string; path: string; expected: string }[] };

/**
 * Try each named schema variant in order; the first match wins and its name is
 * recorded (adapters store it as snapshot.schemaVariant). On total failure the
 * per-variant errors give the exact path each one diverged at.
 */
export function matchVariant<T>(
  variants: Record<string, Schema<T>>,
  value: unknown,
): VariantResult<T> {
  const errors: { variant: string; path: string; expected: string }[] = [];
  for (const [name, schema] of Object.entries(variants)) {
    const r = schema(value, '');
    if (r.ok) return { ok: true, variant: name, value: r.value };
    errors.push({ variant: name, path: r.path, expected: r.expected });
  }
  return { ok: false, errors };
}
