import assert from 'node:assert/strict';
import {buildContextQuestion, collectContextSources, renderContextResult} from '../agent_server/static/context.mjs';

const tables = ['workspace.ifc_case_comp.external_news', 'workspace.ifc_case_comp.industry_reports', 'workspace.ifc_case_comp.regional_risk_reports'];
const question = buildContextQuestion({client_id:'TEST-1', country:'Test country', industry:'Test industry'}, tables);
tables.forEach(table => assert.ok(question.includes(table)));
assert.ok(question.includes('TEST-1'));
assert.throws(() => buildContextQuestion({}, ['workspace.table; DROP TABLE x']));
assert.throws(() => buildContextQuestion({}, []));

const news = {text:'Original Genie explanation.', queries:[{
  sql:'SELECT * FROM workspace.ifc_case_comp.external_news', data_available:true,
  columns:['News Headline', 'Publication Date', 'Publisher', 'Source URL', 'Risk Classification', 'Explanation'],
  rows:[['<Test headline>', '2026-11-01', 'Test publisher', 'https://example.com/story', 'High Risk', '<script>unsafe</script>']],
}]};
const article = collectContextSources(news)[0];
assert.equal(article.kind, 'External news');
assert.equal(article.title, '<Test headline>');
assert.equal(article.date, '2026-11-01');
const html = renderContextResult(news);
assert.ok(html.includes('Original Genie explanation.'));
assert.ok(html.includes('href="https://example.com/story"'));
assert.ok(html.includes('&lt;Test headline&gt;'));
assert.ok(!html.includes('<script>'));
assert.ok(html.includes('rel="noopener noreferrer"'));
assert.ok(!html.includes('Verified source'));

const reports = {text:'', queries:[{
  sql:'SELECT title FROM workspace.ifc_case_comp.industry_reports', data_available:true,
  columns:['report_title', 'report_date', 'url'], rows:[['Industry report', null, 'javascript:alert(1)']],
}, {
  sql:'SELECT title FROM workspace.ifc_case_comp.regional_risk_reports', data_available:true,
  columns:['title', 'country', 'summary'], rows:[['Regional report', 'Test country', 'Original table summary']],
}]};
assert.equal(collectContextSources(reports).length, 2);
assert.equal(collectContextSources(reports)[0].url, null);
assert.ok(!renderContextResult(reports).includes('href="javascript:'));
assert.ok(renderContextResult(reports).includes('Original source URL was not returned.'));
assert.ok(renderContextResult(reports).includes('Unavailable'));
assert.equal(collectContextSources({text:'No relevant records were found.', queries:[]}).length, 0);
assert.ok(renderContextResult({text:'No relevant records were found.', queries:[]}).includes('No relevant records were found.'));
const mixed = structuredClone(news);
mixed.queries[0].sql += ' JOIN workspace.ifc_case_comp.industry_reports';
assert.equal(collectContextSources(mixed)[0].kind, 'Supporting source');
console.log('Supporting news/report request, provenance, fallback and escaping checks passed.');
