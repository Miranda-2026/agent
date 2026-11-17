// Presentation and transport helpers. Portfolio calculations remain in the agent.
export const FACTORS = [
  ['disbursed_amount', 'Disbursed amount'],
  ['internal_risk', 'Internal risk rating'],
  ['environmental_category', 'Environmental category'],
  ['product_line', 'Product diversification'],
];
export const DEFAULT_WEIGHTS = Object.fromEntries(FACTORS.map(([key]) => [key, 25]));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function number(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function formatNumber(value, digits = 2) {
  const n = number(value);
  return n === null ? 'Unavailable' : n.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
}
export const money = value => number(value) === null ? 'Unavailable' : `$${formatNumber(value)}M`;
export const percent = value => number(value) === null ? 'Unavailable' : `${formatNumber(value, 1)}%`;

export function requestErrorMessage(status, payload) {
  // MLflow wraps upstream errors in HTTP 500 with a string `detail` field.
  // Match diagnostic codes, but never display raw error bodies or credentials.
  const detail = typeof payload?.detail === 'string' ? payload.detail : JSON.stringify(payload?.detail ?? payload?.error ?? '');
  if (detail.includes('ENDPOINT_NOT_FOUND')) return "The configured model endpoint was not found. Bind your existing GPT OSS 120B endpoint in Databricks App Settings > Resources with key 'llm-endpoint' and Can query permission, then redeploy.";
  if (detail.includes('PERMISSION_DENIED') && detail.includes('_otel_')) return 'The app cannot access its MLflow trace tables. Grant its service principal USE CATALOG, USE SCHEMA, SELECT and MODIFY on the experiment’s actual trace tables.';
  if (detail.includes('PERMISSION_DENIED')) return 'The app service principal cannot access a required Databricks resource. Check the model’s Can query permission and the app’s data resource permissions.';
  if (status === 401 || status === 403) return 'Your Databricks session or app resource access needs attention. Sign in again or check the app resource permissions.';
  if (status === 429) return 'The model endpoint is rate limited. Please wait briefly and retry.';
  return `The agent request failed (HTTP ${status}). Please retry or check the Databricks app logs.`;
}
export function normalizeWeights(values) {
  const weights = FACTORS.map(([key]) => number(values[key]));
  if (weights.some(n => n === null || n < 0)) throw new Error('Enter a valid, nonnegative number for every factor.');
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('At least one factor must have a weight greater than zero.');
  return Object.fromEntries(FACTORS.map(([key], index) => [key, weights[index] / total * 100]));
}
export function weightLabel(weights) {
  return FACTORS.every(([key]) => Math.abs(weights[key] - 25) < .001)
    ? 'Equal weights · 25% each' : 'Custom weights applied';
}
export function textValue(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (Array.isArray(value)) return value.length ? value.map(textValue).join(' · ') : 'Unavailable';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${textValue(item)}`).join(' · ');
  return String(value);
}
export function statusOf(card) {
  const value = String(card.recommendation_status || '').toUpperCase().replaceAll(/[^A-Z]+/g, ' ').trim();
  if (['CONTINUE', 'CONTINUE INVESTING', 'CONTINUE INVESTMENT'].includes(value)) return 'continue';
  if (['REVIEW', 'REDUCE', 'REDUCE REVIEW', 'REVIEW REDUCE', 'REDUCE REVIEW EXPOSURE', 'REVIEW REDUCE EXPOSURE'].includes(value)) return 'review';
  return 'unknown';
}
function parseJSON(text) {
  try { return JSON.parse(text); } catch { return null; }
}
export function extractResponse(payload) {
  if (payload?.error) throw new Error('The agent returned an error. Please retry or check the Databricks app logs.');
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const text = output.filter(item => item.role === 'assistant' || item.type === 'message')
    .flatMap(item => typeof item.content === 'string' ? [item.content] : (item.content || []).filter(part => ['output_text', 'text', 'refusal'].includes(part.type)).map(part => part.text ?? part.refusal ?? ''))
    .join('\n') || (typeof payload?.output_text === 'string' ? payload.output_text : '');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  const parsed = parseJSON(clean) ?? (start >= 0 ? parseJSON(clean.slice(start, end + 1)) : null);
  const structured = [payload?.custom_outputs, payload, parsed].find(value => Array.isArray(value?.cards));
  const cards = structured?.cards?.filter(card => card && typeof card === 'object' && !Array.isArray(card));
  if (!structured && !text.trim()) throw new Error('The agent returned no displayable answer. Please retry.');
  return {text, cards: cards ?? null, report: structured ?? null,
    historyText: text || JSON.stringify(structured)};
}
export function reportWarnings(cards, report, requestedWeights) {
  const warnings = [];
  const statuses = cards.map(statusOf);
  if (cards.length !== 4 || statuses.filter(s => s === 'continue').length !== 2 || statuses.filter(s => s === 'review').length !== 2) warnings.push('The agent did not return two Continue and two Review clients. Available results are shown; eligibility screens have not been relaxed.');
  const ids = cards.map(card => card.client_id).filter(Boolean);
  if (ids.length !== cards.length || new Set(ids).size !== ids.length) warnings.push('Client identifiers are missing or repeated. Review the source output before using these results.');
  for (const card of cards) {
    const weights = card.applied_weights;
    if (!weights || FACTORS.some(([key]) => number(weights[key]) === null || number(weights[key]) < 0) || Math.abs(FACTORS.reduce((sum, [key]) => sum + number(weights?.[key]), 0) - 100) > .1) {
      warnings.push(`${card.client_name || 'A client'}: applied weights were not returned as four valid percentages totaling 100%.`);
    } else if (FACTORS.some(([key]) => Math.abs(weights[key] - requestedWeights[key]) > .1)) {
      warnings.push(`${card.client_name || 'A client'}: returned weights differ from the requested weights. Request a recalculation before relying on this ranking.`);
    }
    const scores = FACTORS.map(([key]) => number(card.factor_scores?.[key]?.score));
    if (weights && scores.every(score => score !== null) && FACTORS.every(([key]) => number(weights[key]) !== null)) {
      const sum = FACTORS.reduce((total, [key], index) => total + scores[index] * weights[key] / 100, 0);
      if (number(card.final_score) !== null && Math.abs(sum - number(card.final_score)) > .15) warnings.push(`${card.client_name || 'A client'}: the returned score does not match its factor scores and weights. Human review is required.`);
    }
  }
  if (report?.limitations) warnings.push(textValue(report.limitations));
  return warnings;
}

const OUTPUT_CONTRACT = `For frontend presentation, return a JSON object with keys summary, limitations (array), and cards (array of separate client objects). Use your existing analytical rules and tools, not model arithmetic or invented data. Return only eligible verified clients; if fewer than four qualify, disclose that in limitations. Order two CONTINUE cards first, then two REDUCE_REVIEW cards when available. Keep qualitative research separate from scoring. For unavailable values use null, never zero or invented placeholders. All money fields below are numeric MILLIONS of USD; percentages are 0–100, risk rating is 1–6, scores are 0–100. Each card uses these keys:
client_id, client_name, industry, product_mix, recommendation_status (CONTINUE or REDUCE_REVIEW), score_type, final_score,
applied_weights ({disbursed_amount, internal_risk, environmental_category, product_line}, percentages),
factor_scores (same four keys, each {score, weighted_contribution}; use the relevant Continue or Review scores),
quantitative_metrics ({active_disbursed_musd, approved_musd, estimated_undisbursed_musd, weighted_internal_risk, environmental_breakdown, product_distribution, past_due_exposure_musd, watchlist_exposure_musd, risk_exposure_ratio_pct, estimated_ecl_musd}),
project_performance ({active, performing, watchlist, past_due}), quantitative_rationale,
qualitative_notes ({region, country, industry, strategic_collaboration, research_limitations}),
news (array of {headline, publisher, publication_date, relevance, risk_classification, explanation, url}; include only verified real sources with direct article URLs; if live search is unavailable, return [] and explain in research_limitations),
recommended_action, data_quality_flags (array), audit ({source_table, filters, project_identifiers, methodology, sql, limitations}).
Do not treat UI validation as SQL verification. Do not change ranking or financial methodology to fit this presentation schema.`;

export function buildAgentMessage(question, mode, weights) {
  const applied = normalizeWeights(weights);
  return `User request: ${question}\n\nApplication context: ${mode === 'recommendations' ? 'Client recommendations' : 'Quantitative analysis / follow-up conversation'}. Current user scoring weights, in percentages: ${JSON.stringify(applied)}. Use these weights whenever scoring or recalculating rankings; do not silently use equal weights. If only weights changed, preserve the validated underlying factors for the same data snapshot and re-rank both eligible populations using the existing rules. If this is only a qualitative follow-up, do not unnecessarily recompute quantitative rankings.\n\n${mode === 'recommendations' ? OUTPUT_CONTRACT : 'Answer the user in clear Markdown. Use your configured data tools for financial calculations. Disclose unavailable data or tools. Keep existing analytical instructions and evidence requirements.'}`;
}

// Small, escaped Markdown renderer. Raw agent HTML is always displayed as text.
function inlineMarkdown(source) {
  const tokens = [];
  const hold = html => { const token = `\u0000${tokens.length}\u0000`; tokens.push(html); return token; };
  let escaped = escapeHTML(String(source).replaceAll('\u0000', ''));
  escaped = escaped.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  escaped = escaped.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, target) => {
    const url = safeURL(target.replaceAll('&amp;', '&'));
    return url ? hold(`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`) : label;
  });
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return escaped.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}
export function renderMarkdown(source) {
  const lines = String(source || '').replaceAll('\r\n', '\n').split('\n');
  const result = [];
  let index = 0;
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const code = []; index++;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      result.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`); index++; continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const headers = cells(line); index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      result.push(`<div class="table-scroll"><table><thead><tr>${headers.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { const level = Math.min(heading[1].length + 1, 6); result.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); index++; continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line); const tag = ordered ? 'ol' : 'ul'; const items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(`<li>${inlineMarkdown(lines[index++].replace(pattern, ''))}</li>`);
      result.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    if (/^>\s?/.test(line)) result.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`);
    else if (line.trim()) result.push(`<p>${inlineMarkdown(line)}</p>`);
    index++;
  }
  return result.join('');
}
