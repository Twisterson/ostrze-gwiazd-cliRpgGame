const MIN_WIDTH = 10;

function wrapLine(line, width) {
  if (line === "") return [""];
  const out = [];
  let current = "";
  let currentLen = 0;
  for (const word of line.split(" ").filter(Boolean)) {
    let chars = [...word];
    while (chars.length > width) {
      if (currentLen > 0) { out.push(current); current = ""; currentLen = 0; }
      out.push(chars.slice(0, width).join(""));
      chars = chars.slice(width);
    }
    const len = chars.length;
    const rest = chars.join("");
    if (currentLen === 0) { current = rest; currentLen = len; }
    else if (currentLen + 1 + len <= width) { current += ` ${rest}`; currentLen += 1 + len; }
    else { out.push(current); current = rest; currentLen = len; }
  }
  if (currentLen > 0) out.push(current);
  return out;
}

export function wrap(text, width) {
  const w = Math.max(width, MIN_WIDTH);
  return text.split("\n").flatMap((line) => wrapLine(line, w)).join("\n");
}
