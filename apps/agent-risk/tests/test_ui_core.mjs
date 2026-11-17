// Run with `node tests/test_ui_core.mjs` (no npm installation required).
import assert from 'node:assert/strict';
import {normalizeWeights, DEFAULT_WEIGHTS, number, money, safeURL, extractResponse, reportWarnings, renderMarkdown, buildAgentMessage} from '../agent_server/static/core.mjs';

const results = [];
function check(name, fn) {fn(); results.push(name);}
const report = {cards: Array.from({length:4}, (_, index) => ({
  client_id:`TEST-${index}`, client_name:`Test client ${index}`, recommendation_status:index < 2 ? 'CONTINUE' : 'REDUCE_REVIEW',
  applied_weights:{...DEFAULT_WEIGHTS}, final_score:50,
  factor_scores:Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(key => [key, {score:50, weighted_contribution:12.5}])),
}))};
check('Custom weights normalize without losing zero weights', () => {
  const weights = normalizeWeights({disbursed_amount:0, internal_risk:2, environmental_category:3, product_line:5});
  assert.deepEqual(weights, {disbursed_amount:0, internal_risk:20, environmental_category:30, product_line:50});
  assert.throws(() => normalizeWeights(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(key => [key, 0]))));
  assert.throws(() => normalizeWeights({...DEFAULT_WEIGHTS, internal_risk:-1}));
  assert.throws(() => normalizeWeights({...DEFAULT_WEIGHTS, internal_risk:''}));
});
check('Missing financial values are not converted to zero', () => {
  for (const value of [null, undefined, '', ' ', false, [], {}, 'unavailable']) assert.equal(number(value), null);
  assert.equal(money(null), 'Unavailable'); assert.equal(money(0), '$0.00M'); assert.equal(money(1794.94), '$1,794.94M');
});
check('Responses API text, fenced JSON and custom outputs are supported', () => {
  const message = text => ({output:[{type:'function_call_output', output:'hidden tool result'}, {role:'assistant', type:'message', content:[{type:'output_text', text}]}]});
  assert.equal(extractResponse(message('Plain answer')).text, 'Plain answer');
  assert.equal(extractResponse(message('```json\n' + JSON.stringify(report) + '\n```')).cards.length, 4);
  assert.equal(extractResponse({output:[], custom_outputs:report}).cards.length, 4);
  assert.equal(extractResponse(report).cards.length, 4);
  assert.throws(() => extractResponse({output:[]}));
  assert.throws(() => extractResponse({error:'server failure'}));
});
check('Inconsistent scores, weights and eligibility are surfaced', () => {
  assert.deepEqual(reportWarnings(report.cards, report, DEFAULT_WEIGHTS), []);
  const changed = structuredClone(report);
  changed.cards[0].final_score = 95;
  changed.cards[1].applied_weights.internal_risk = 10;
  changed.cards[3].client_id = changed.cards[2].client_id;
  const warnings = reportWarnings(changed.cards, changed, DEFAULT_WEIGHTS).join(' ');
  assert.match(warnings, /does not match/); assert.match(warnings, /valid percentages/); assert.match(warnings, /repeated/);
  assert.match(reportWarnings([report.cards[0]], {}, DEFAULT_WEIGHTS).join(' '), /did not return/);
});
check('Agent HTML and dangerous article links cannot execute', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>\n[bad](javascript:alert)\n[article](https://example.com/news?a=1&b=2)\n**Evidence**');
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /<strong>Evidence<\/strong>/);
  assert.equal(safeURL('javascript:alert(1)'), null); assert.equal(safeURL('data:text/html,hello'), null);
  assert.equal(safeURL('https://secret@example.com'), null);
});
check('Current weights and output schema travel to the existing agent', () => {
  const message = buildAgentMessage('Re-rank clients', 'recommendations', {disbursed_amount:10, internal_risk:40, environmental_category:30, product_line:20});
  assert.match(message, /"internal_risk":40/); assert.match(message, /numeric MILLIONS of USD/);
  assert.match(message, /underlying factors/); assert.match(message, /return a JSON object/);
});
console.log(`${results.length} UI core checks passed.`);
export {results};
