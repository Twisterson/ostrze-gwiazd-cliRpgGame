export function t(ui, key, vars = {}) {
  const template = ui[key];
  if (typeof template !== "string") return `[[${key}]]`;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}
