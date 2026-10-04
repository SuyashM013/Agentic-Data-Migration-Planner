/** Pulls a JSON object out of model text (tolerates ```json fences and surrounding prose). Returns undefined on failure. */
function extractJson(text) {
  if (typeof text !== 'string') return undefined;
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

module.exports = { extractJson };
