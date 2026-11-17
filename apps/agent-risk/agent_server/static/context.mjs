// Supporting sources are retrieved by the existing Genie, never a second model.
import {escapeHTML as esc, safeURL, textValue, renderMarkdown, renderGenieQueries} from './core.mjs';

const normalizeKey = key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const field = (record, names) => {
  for (const name of names) {
    const match = Object.keys(record).find(key => normalizeKey(key) === normalizeKey(name));
    if (match !== undefined && record[match] !== null && record[match] !== '') return record[match];
  }
  return null;
};
export function buildContextQuestion(context, tables) {
  if (!tables.length) throw new Error('Supporting source tables are unavailable. Reload the workspace and try again.');
  const sources = tables.filter(table => /^[A-Za-z_][\w]*\.[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(table));
  if (sources.length !== tables.length) throw new Error('A supporting source table name is invalid.');
  return `Show the relevant external news, industry reports and regional risk reports from ${sources.join(', ')} for this analysis context: ${JSON.stringify(context)}. Include the original title, publication date, publisher, source URL, country/region/industry and relevance where those fields are available in the records. Keep the existing quantitative recommendations unchanged. If no relevant records are available, state that.`;
}
function articleFromRecord(record, kind = 'Supporting source') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const title = field(record, ['headline', 'news_headline', 'article_title', 'report_title', 'title']);
  if (!title) return null;
  return {
    title: textValue(title),
    url: safeURL(field(record, ['url', 'source_url', 'article_url', 'news_url', 'report_url', 'external_url', 'link'])),
    publisher: field(record, ['publisher', 'source_name', 'news_source', 'source', 'organization', 'author']),
    date: field(record, ['publication_date', 'published_date', 'published_at', 'report_date', 'date']),
    relevance: field(record, ['relevance', 'risk_interpretation', 'explanation', 'summary', 'description', 'analysis']),
    country: field(record, ['country', 'relevant_country']),
    region: field(record, ['region', 'relevant_region']),
    industry: field(record, ['industry', 'sector', 'relevant_industry']),
    risk: field(record, ['risk_classification', 'risk_level', 'risk_rating']),
    kind: textValue(field(record, ['source_type', 'document_type', 'report_type']) || kind),
  };
}
function parsedSources(text) {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (Array.isArray(value)) return value;
    return [...(Array.isArray(value.news) ? value.news : []), ...(Array.isArray(value.reports) ? value.reports : []), ...(Array.isArray(value.sources) ? value.sources : [])];
  } catch { return []; }
}
export function collectContextSources(result) {
  const sources = parsedSources(result.text).map(record => articleFromRecord(record));
  for (const query of result.queries || []) {
    const sql = String(query.sql || '').toLowerCase();
    const kinds = [['regional_risk_reports', 'Regional risk report'], ['industry_reports', 'Industry report'], ['external_news', 'External news']].filter(([table]) => sql.includes(table));
    const kind = kinds.length === 1 ? kinds[0][1] : 'Supporting source';
    if (query.data_available === false) continue;
    for (const row of query.rows || []) {
      if (!Array.isArray(row)) continue;
      const record = Object.fromEntries((query.columns || []).map((name, index) => [name, row[index]]));
      sources.push(articleFromRecord(record, kind));
    }
  }
  const seen = new Set();
  return sources.filter(source => {
    if (!source) return false;
    const key = JSON.stringify([source.title, source.url, source.date, source.publisher]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function renderContextResult(result) {
  const sources = collectContextSources(result);
  const cards = sources.map(source => {
    const geography = [source.country, source.region, source.industry].filter(Boolean).map(textValue).join(' · ');
    const riskClass = /low[ _-]*risk/i.test(String(source.risk)) ? 'low' : /high[ _-]*risk/i.test(String(source.risk)) ? '' : 'unknown';
    return `<article class="news-item"><div class="news-meta">${esc(source.kind)} · ${esc(textValue(source.date))} · ${esc(textValue(source.publisher))}</div><h5>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>` : esc(source.title)}</h5>${source.risk ? `<span class="news-badge ${riskClass}">${esc(textValue(source.risk))}</span>` : ''}${geography ? `<p>${esc(geography)}</p>` : ''}${source.relevance ? `<p>${esc(textValue(source.relevance))}</p>` : ''}${!source.url ? '<p class="muted-note">Original source URL was not returned.</p>' : ''}</article>`;
  }).join('');
  // Preserve Genie's own analysis. Rows and links are presented without adding
  // classifications, new financial calculations, or claims of live verification.
  const original = parsedSources(result.text).length ? '' : `<div class="prose">${renderMarkdown(result.text)}</div>`;
  return `<p class="muted-note">Supporting records returned by your Genie from workspace tables.</p>${original}${cards ? `<div class="news-list">${cards}</div>` : ''}${renderGenieQueries(result.queries)}`;
}
