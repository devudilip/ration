import { describe, expect, it } from 'vitest';
import { arr, matchVariant, nullable, num, obj, optional, str } from '../src/lib/validate';

describe('validate', () => {
  it('accepts matching primitives', () => {
    expect(num(3.5, 'x')).toEqual({ ok: true, value: 3.5 });
    expect(str('hi', 'x')).toEqual({ ok: true, value: 'hi' });
  });

  it('rejects NaN and Infinity as numbers', () => {
    expect(num(NaN, 'x').ok).toBe(false);
    expect(num(Infinity, 'x').ok).toBe(false);
  });

  it('never coerces: numeric strings are not numbers', () => {
    const r = num('42', 'used');
    expect(r).toEqual({ ok: false, path: 'used', expected: 'number' });
  });

  it('reports a precise path into nested objects and arrays', () => {
    const schema = obj({ lanes: arr(obj({ used: num })) });
    const r = schema({ lanes: [{ used: 1 }, { used: 'oops' }] }, '');
    expect(r).toEqual({ ok: false, path: 'lanes[1].used', expected: 'number' });
  });

  it('nullable accepts null, optional accepts missing', () => {
    const schema = obj({ limit: nullable(num), note: optional(str) });
    expect(schema({ limit: null }, '')).toEqual({
      ok: true,
      value: { limit: null, note: undefined },
    });
    expect(schema({ limit: undefined }, '').ok).toBe(false);
  });

  it('rejects arrays where objects are expected', () => {
    expect(obj({ a: num })([], '').ok).toBe(false);
    expect(arr(num)({}, '').ok).toBe(false);
  });

  it('matchVariant returns the first matching variant name', () => {
    const r = matchVariant<{ x: number } | { y: number }>(
      { a: obj({ x: num }), b: obj({ y: num }) },
      { y: 1 },
    );
    expect(r).toEqual({ ok: true, variant: 'b', value: { y: 1 } });
  });

  it('matchVariant reports each variant divergence path on total failure', () => {
    const r = matchVariant<{ x: number } | { y: number }>(
      { a: obj({ x: num }), b: obj({ y: num }) },
      { z: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        { variant: 'a', path: 'x', expected: 'number' },
        { variant: 'b', path: 'y', expected: 'number' },
      ]);
    }
  });
});
