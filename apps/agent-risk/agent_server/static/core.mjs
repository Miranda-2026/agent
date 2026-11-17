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
  if (detail.includes('GENIE_ACCESS_DENIED')) return "The app cannot access the existing Genie agent. In App Settings > Resources, bind your Genie Space with key 'ifc-genie' and Can run permission. Also check the app identity's underlying table and warehouse permissions.";
  if (detail.includes('GENIE_SPACE_NOT_FOUND')) return "The configured Genie Space was not found. Check resource 'ifc-genie' and confirm that the app runs in the same Databricks workspace.";
  if (detail.includes('GENIE_SESSION_EXPIRED') || detail.includes('GENIE_INVALID_SESSION')) return 'This Genie conversation is no longer available in the app. Start a New conversation to continue.';
  if (detail.includes('GENIE_RATE_LIMITED') || detail.includes('GENIE_BUSY')) return 'Genie is temporarily busy or rate limited. Please wait briefly and retry.';
  if (detail.includes('GENIE_TIMEOUT')) return 'Your existing Genie agent did not finish within four minutes. Check the Genie conversation or retry later.';
  if (detail.includes('GENIE_EMPTY_RESPONSE')) return 'Genie returned no text or query results. Check the conversation in the Genie Space.';
  if (detail.includes('GENIE_FAILED') || detail.includes('GENIE_CANCELLED') || detail.includes('GENIE_QUERY_RESULT_EXPIRED')) return 'The request reached Genie, but its message did not complete successfully. Check the Genie conversation status. This alone does not establish a permission or data-connection problem.';
  if (detail.includes('GENIE_REQUEST_FAILED')) return 'The direct Genie request failed. Check the Databricks app logs and the Genie conversation.';
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
    queries: Array.isArray(payload?.custom_outputs?.genie_queries) ? payload.custom_outputs.genie_queries : [],
    historyText: text || JSON.stringify(structured)};
}

export function renderGenieQueries(queries) {
  if (!Array.isArray(queries) || !queries.length) return '';
  return `<section class="details-section"><h4>Query results from Genie</h4>${queries.map((query, index) => {
    const columns = Array.isArray(query.columns) ? query.columns : [];
    const rows = Array.isArray(query.rows) ? query.rows : [];
    const table = query.data_available ? `<div class="table-scroll"><table><thead><tr>${columns.map(column => `<th scope="col">${escapeHTML(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${(Array.isArray(row) ? row : []).map(value => `<td>${escapeHTML(textValue(value))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length === 0 ? '<p>No rows returned by Genie.</p>' : ''}` : '<p>Query results are unavailable. The SQL returned by Genie is shown below.</p>';
    return `<details class="client-details"><summary>Genie query ${index + 1}</summary><div class="details-content prose">${query.description ? `<p>${escapeHTML(query.description)}</p>` : ''}${table}${query.truncated ? '<p class="muted-note">Partial results are shown. The full result was not loaded; no portfolio ranking is inferred from this table.</p>' : ''}<pre><code>${escapeHTML(query.sql || 'SQL unavailable')}</code></pre></div></details>`;
  }).join('')}</section>`;
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

export function buildAgentRequest(question, mode, weights, history, sessionId) {
  // The existing agent owns its instructions, analysis, tools and output.
  // UI controls travel as metadata, never as an injected analytical prompt.
  return {
    input: [...history, {role:'user', content:question}],
    stream: false,
    custom_inputs: {session_id:sessionId, ui_mode:mode, weights:normalizeWeights(weights)},
  };
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
