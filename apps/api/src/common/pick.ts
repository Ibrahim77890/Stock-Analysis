/** Whitelisting: rebuild an object from an explicit specification, dropping every other field.
 *  spec value: true = copy as is (primitive, null, or an array of primitives); object = nested spec; [spec] = array of objects. */
export type Spec = true | { [key: string]: Spec } | [Spec];

export interface PickResult<T> {
  value: T;
  dropped: string[]; // names of upstream fields that were not on the list (never their values)
}

export function pick<T = any>(obj: any, spec: Spec, path = "", dropped: string[] = []): PickResult<T> {
  const value = inner(obj, spec, path, dropped);
  return { value: value as T, dropped };
}

function inner(obj: any, spec: Spec, path: string, dropped: string[]): any {
  if (obj === undefined) return undefined;
  if (spec === true) return obj;
  if (obj === null) return null;
  if (Array.isArray(spec)) {
    return Array.isArray(obj) ? obj.map((x, i) => inner(x, spec[0], `${path}[]`, dropped)) : [];
  }
  const out: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (!(key in spec)) {
      dropped.push(path ? `${path}.${key}` : key);
      continue;
    }
    const v = inner(obj[key], spec[key], path ? `${path}.${key}` : key, dropped);
    if (v !== undefined) out[key] = v;
  }
  return out;
}
