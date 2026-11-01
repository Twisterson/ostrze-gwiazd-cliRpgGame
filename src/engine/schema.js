const TYPE_MESSAGES = {
  object: "oczekiwano obiektu",
  array: "oczekiwano tablicy",
  string: "oczekiwano tekstu",
  number: "oczekiwano liczby",
  integer: "oczekiwano liczby całkowitej",
  boolean: "oczekiwano wartości logicznej",
};

function matchesType(value, type) {
  switch (type) {
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}

const withPath = (path, text) => (path ? `${path}: ${text}` : text);
const keyPath = (path, key) => (path ? `${path}.${key}` : key);

/** Validates `value` against `schema`; returns a list of error messages (empty = valid). */
export function check(value, schema, path = "") {
  if (!matchesType(value, schema.type)) {
    return [withPath(path, TYPE_MESSAGES[schema.type] ?? `nieznany typ schematu: ${schema.type}`)];
  }
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(withPath(path, `dozwolone wartości: ${schema.enum.join(", ")}`));
  }
  if (schema.type === "string") {
    if (schema.pattern && !schema.pattern.test(value)) errors.push(withPath(path, `niepoprawny format "${value}"`));
    if (schema.nonEmpty && value === "") errors.push(withPath(path, "pusty tekst"));
  }
  if ((schema.type === "number" || schema.type === "integer") && schema.min !== undefined && value < schema.min) {
    errors.push(withPath(path, `wartość mniejsza niż ${schema.min}`));
  }
  if ((schema.type === "number" || schema.type === "integer") && schema.max !== undefined && value > schema.max) {
    errors.push(withPath(path, `wartość większa niż ${schema.max}`));
  }
  if (schema.type === "array" && schema.items) {
    value.forEach((item, i) => errors.push(...check(item, schema.items, `${path}[${i}]`)));
  }
  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(withPath(keyPath(path, key), "brak wymaganego pola"));
    }
    const fields = schema.fields ?? {};
    for (const key of Object.keys(value)) {
      const sub = Object.hasOwn(fields, key) ? fields[key] : schema.values;
      if (sub) errors.push(...check(value[key], sub, keyPath(path, key)));
      else if (schema.additional === false) errors.push(withPath(keyPath(path, key), "nieznane pole"));
    }
  }
  return errors;
}
