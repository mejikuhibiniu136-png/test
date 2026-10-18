// Sanitasi data tidak tepercaya sebelum disimpan. Murni dan tidak pernah melempar error.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LIMITS = { depth: 6, keys: 60, items: 50, string: 4096, nodes: 1500 };

// Salinan dalam yang aman: buang kunci berbahaya, karakter kontrol, nilai non-JSON, dan batasi
// kedalaman, jumlah node, serta panjang string. Hasilnya selalu object biasa.
export function sanitizeDeep(value: unknown): Record<string, unknown> {
  const budget = { nodes: LIMITS.nodes };

  const walk = (v: unknown, depth: number): unknown => {
    if (budget.nodes-- <= 0) return undefined;
    if (v === null) return null;
    switch (typeof v) {
      case 'string':
        return v.replace(CONTROL_CHARS, '').slice(0, LIMITS.string);
      case 'number':
        return Number.isFinite(v) ? v : undefined;
      case 'boolean':
        return v;
      case 'object':
        break;
      default:
        return undefined;
    }
    if (depth >= LIMITS.depth) return undefined;
    if (Array.isArray(v)) {
      return v
        .slice(0, LIMITS.items)
        .map((item) => walk(item, depth + 1))
        .filter((item) => item !== undefined);
    }
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(v as object)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (count >= LIMITS.keys) break;
      const clean = walk((v as Record<string, unknown>)[key], depth + 1);
      if (clean === undefined) continue;
      out[key.replace(CONTROL_CHARS, '').slice(0, 128)] = clean;
      count += 1;
    }
    return out;
  };

  const result = walk(value, 0);
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
}
