import {FACTORS, DEFAULT_WEIGHTS, escapeHTML as esc, safeURL, number, formatNumber, money, percent, normalizeWeights, weightLabel, textValue, statusOf, extractResponse, reportWarnings, buildAgentMessage, renderMarkdown} from './core.mjs';

const ICONS = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="18" width="7" height="3" rx="1"/>',
  chart:'<path d="M4 3v17h17M8 15V9m5 6V5m5 10v-4"/>',
  sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4M4 19v3m-1.5-1.5h3"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  sliders:'<path d="M4 7h6m6 0h4M4 17h10m6 0h0"/><circle cx="13" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up':'<path d="M12 20V4m-6 6 6-6 6 6"/>',
  'arrow-up-right':'<path d="m6 18 12-12M6 6h12v12"/>',
  chevrons:'<path d="m9 8 3-3 3 3m-6 8 3 3 3-3"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12c5 4 13 4 18 0M12 12v4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.sparkles}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => {el.innerHTML = icon(el.dataset.icon);});
const $ = id => document.getElementById(id);
const state = {mode:'home', history:[], weights:{...DEFAULT_WEIGHTS}, sessionId:crypto.randomUUID(), busy:false, controller:null, requestId:0, dashboard:null, lastRequest:null};
const factorDisplay = weights => FACTORS.map(([key, label]) => `<span>${esc(label)} ${formatNumber(weights[key], 1)}%</span>`).join('');
const detailList = entries => `<dl class="detail-list">${entries.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(textValue(value))}</dd></div>`).join('')}</dl>`;
const section = (title, html) => `<section class="details-section"><h4>${esc(title)}</h4>${html}</section>`;
const paragraph = value => `<p>${esc(textValue(value))}</p>`;

function renderNews(news, limitations) {
  if (!Array.isArray(news) || !news.length) return `<p class="muted-note">${esc(limitations || 'No verified news articles were returned by the agent. Live news may be unavailable.')}</p>`;
  return `<div class="news-list">${news.map(article => {
    if (!article || typeof article !== 'object') return '';
    const href = safeURL(article.url), risk = String(article.risk_classification || 'Unclassified');
    const kind = /low[ _-]*risk/i.test(risk) ? 'low' : /high[ _-]*risk/i.test(risk) ? '' : 'unknown';
    const headline = esc(article.headline || 'Untitled article');
    return `<article class="news-item"><div class="news-meta">${esc(article.publisher || 'Publisher unavailable')} · ${esc(article.publication_date || 'Date unavailable')}</div><h5>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${headline}${icon('external')}</a>` : headline}</h5><span class="news-badge ${kind}">${esc(risk)}</span>${article.relevance ? `<p>${esc(textValue(article.relevance))}</p>` : ''}<p>${esc(textValue(article.explanation))}</p>${!href ? '<p>Direct source URL unavailable.</p>' : ''}</article>`;
  }).join('')}</div>`;
}

function renderCard(card, index) {
  const type = statusOf(card), metrics = card.quantitative_metrics || {}, performance = card.project_performance || {}, notes = card.qualitative_notes || {}, audit = card.audit || {};
  const label = type === 'continue' ? 'Continue' : type === 'review' ? 'Review / Reduce' : 'Status unavailable';
  const count = value => formatNumber(value, 0);
  const metric = (label, value, sub = '') => `<div><span class="metric-label">${esc(label)}</span><strong class="metric-value">${value}</strong>${sub ? `<div class="metric-sub">${esc(sub)}</div>` : ''}</div>`;
  const risk = number(metrics.weighted_internal_risk) === null ? 'Unavailable' : `${formatNumber(metrics.weighted_internal_risk)} <span class="unit">/ 6</span>`;
  const performanceLabel = type === 'review' ? 'Past Due / Watchlist' : 'Active project performance';
  const performanceValue = type === 'review' ? `${count(performance.past_due)} <span class="unit">/</span> ${count(performance.watchlist)}` : `${count(performance.performing)} <span class="unit">/</span> ${count(performance.active)}`;
  const factorRows = FACTORS.map(([key, label]) => {
    const factor = card.factor_scores?.[key] || {};
    return `<tr><td>${esc(label)}</td><td>${formatNumber(factor.score, 2)}</td><td>${percent(card.applied_weights?.[key])}</td><td>${formatNumber(factor.weighted_contribution, 2)}</td></tr>`;
  }).join('');
  const factorTable = `<div class="table-scroll"><table class="factor-table"><caption class="sr-only">Agent returned factor scores and weighted contributions</caption><thead><tr><th scope="col">Factor</th><th scope="col">Score / 100</th><th scope="col">Weight</th><th scope="col">Contribution</th></tr></thead><tbody>${factorRows}</tbody></table></div><p class="muted-note">${esc(card.score_type || 'Quantitative score')}: ${formatNumber(card.final_score)} / 100. Weights and contributions are reported by your agent.</p>`;
  const riskEntries = [
    ['Active / Performing projects', `${count(performance.active)} / ${count(performance.performing)}`],
    ['Past Due / Watchlist projects', `${count(performance.past_due)} / ${count(performance.watchlist)}`],
    ['Past Due exposure', money(metrics.past_due_exposure_musd)], ['Watchlist exposure', money(metrics.watchlist_exposure_musd)],
    ['Risk exposure ratio', percent(metrics.risk_exposure_ratio_pct)],
    ...(type === 'review' ? [['Estimated ECL (case assumption)', money(metrics.estimated_ecl_musd)]] : []),
  ];
  const flags = Array.isArray(card.data_quality_flags) ? card.data_quality_flags : card.data_quality_flags ? [card.data_quality_flags] : [];
  return `<article class="recommendation-card"><div class="client-card-main"><header class="client-header"><div class="client-heading"><span class="client-rank">${index + 1}</span><div><h3>${esc(card.client_name || 'Client name unavailable')}</h3><p class="client-meta">${esc(card.client_id || 'ID unavailable')} · ${esc(textValue(card.industry || notes.industry || card.product_mix))}</p></div></div><div><span class="status-badge ${type}"><span class="badge-dot"></span>${label}</span><div class="score-label">${type === 'continue' ? 'Continue score' : type === 'review' ? 'Review priority' : 'Score'} <strong>${formatNumber(card.final_score)}</strong></div></div></header><div class="metric-grid">${metric(performanceLabel, performanceValue, type === 'continue' ? 'Performing / Active projects' : '')}${metric('Weighted internal risk', risk)}${metric('Active disbursed amount', esc(money(metrics.active_disbursed_musd)))}${metric('Est. undisbursed', esc(money(metrics.estimated_undisbursed_musd)))}</div><div class="rationale"><strong>${type === 'review' ? 'Review rationale' : 'Investment rationale'}: </strong>${esc(textValue(card.quantitative_rationale))}</div></div><details class="client-details"><summary><span>More details</span>${icon('chevron')}</summary><div class="details-content">${section('Quantitative assessment', detailList([
    ['Active approved investment', money(metrics.approved_musd)], ['Final quantitative score', `${formatNumber(card.final_score)} / 100`], ['Environmental category breakdown', metrics.environmental_breakdown], ['Product line distribution', metrics.product_distribution || card.product_mix],
  ]))}${section('Factor scores & contributions', factorTable)}${section('Performance & risk exposure', detailList(riskEntries) + '<p class="muted-note">Estimated undisbursed amounts are not verified contractual commitments. ECL, when available, uses the case-specific assumption of 60% of Past Due exposure.</p>')}${section('Additional notes', detailList([['Region', notes.region], ['Country', notes.country], ['Industry', notes.industry], ['Strategic collaboration', notes.strategic_collaboration]]) + (notes.research_limitations ? paragraph(notes.research_limitations) : ''))}${section('Related news', renderNews(card.news, notes.research_limitations))}${section('Evidence & methodology', detailList([['Source table', audit.source_table], ['Project filters', audit.filters], ['Project identifiers', audit.project_identifiers], ['Methodology', audit.methodology]]) + (audit.sql ? `<div class="prose"><pre><code>${esc(textValue(audit.sql))}</code></pre></div>` : '<p class="muted-note">SQL was not included in this response. Ask your agent to show its source calculations.</p>') + (audit.limitations ? paragraph(audit.limitations) : ''))}${flags.length ? `<div class="data-flags"><strong>Data quality flags</strong><br>${flags.map(flag => esc(textValue(flag))).join('<br>')}</div>` : ''}<p class="action-note">${esc(textValue(card.recommended_action))}<br>Subject to human approval.</p></div></details></article>`;
}

function showNotice(message, retry = false) {
  $('notice').innerHTML = `${esc(message)}${retry ? ' <button type="button" data-action="retry">Retry</button>' : ''}`;
  $('notice').hidden = false;
}
function clearNotice() { $('notice').hidden = true; $('notice').textContent = ''; }
function updateMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.nav-item').forEach(button => {
    const selected = button.dataset.action === mode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('page-label').textContent = {home:'Overview', quantitative:'Quantitative analysis', recommendations:'4 recommendations'}[mode] || 'Overview';
  $('mode-label').textContent = mode === 'recommendations' ? 'Client recommendations · Continue & Review' : mode === 'quantitative' ? 'Quantitative analysis · Ask your agent' : 'Ask your investment intelligence agent';
}
function showConversation() {
  $('welcome').hidden = true; $('analysis-intro').hidden = true; $('conversation').hidden = false;
}
function setBusy(busy) {
  state.busy = busy; $('activity').hidden = !busy;
  $('send-button').hidden = busy; $('stop-button').hidden = !busy;
  document.querySelectorAll('[data-action="recommendations"]').forEach(button => {button.disabled = busy;});
  $('chat-input').disabled = busy;
}
function stopWaiting() {
  if (!state.busy) return;
  state.requestId++; state.controller?.abort(); setBusy(false);
  showNotice('Stopped waiting for the response. The agent may still be processing on the server. You can retry your request.', true);
}

async function ask(question, mode = state.mode, retry = false, structured = mode === 'recommendations') {
  if (state.busy || !question.trim()) return;
  clearNotice();
  const requestMode = mode === 'recommendations' ? 'recommendations' : 'quantitative';
  updateMode(requestMode); showConversation();
  if (!retry) {
    const user = document.createElement('div'); user.className = 'turn turn-user'; user.textContent = question;
    $('conversation').append(user);
  }
  const weights = {...state.weights};
  const input = [...state.history, {role:'user', content:buildAgentMessage(question, structured ? requestMode : 'chat', weights)}];
  state.lastRequest = {question, mode:requestMode, structured};
  const id = ++state.requestId, controller = new AbortController(); state.controller = controller;
  setBusy(true); $('activity').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'end'});
  let timedOut = false;
  const timeout = setTimeout(() => {timedOut = true; controller.abort();}, 300000);
  try {
    const response = await fetch('/invocations', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'Accept':'application/json'},
      body:JSON.stringify({input, stream:false, custom_inputs:{session_id:state.sessionId}}), signal:controller.signal,
    });
    if (id !== state.requestId) return;
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Your Databricks session or agent access needs attention. Sign in again or check the app resource permissions.'
      : `The agent request failed (HTTP ${response.status}). Please retry or check the Databricks app logs.`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error('The server did not return JSON. Your Databricks session may have expired; sign in again and retry.'); }
    if (id !== state.requestId) return;
    const result = extractResponse(payload);
    const turn = document.createElement('article'); turn.className = 'turn turn-assistant';
    const heading = `<div class="turn-heading"><span class="agent-avatar">${icon('sparkles')}</span>IFC Intelligence<small>Agent response</small></div>`;
    if (result.cards !== null) {
      const warnings = reportWarnings(result.cards, result.report, weights);
      turn.innerHTML = `${heading}<div class="report-intro"><h2>Your client recommendations</h2><p>${esc(result.report.summary || 'Quantitative assessment with supporting risk context.')}</p><div class="report-weights">${factorDisplay(weights)}</div><p class="muted-note">Requested weights for this run. Agent-returned weights appear inside each card.</p></div>${warnings.length ? `<div class="notice">${warnings.map(esc).join('<br>')}</div>` : ''}<div class="card-stack">${result.cards.map(renderCard).join('')}</div>`;
    } else {
      turn.innerHTML = `${heading}${structured ? '<p class="muted-note">Your agent returned a text response. The original answer is shown below.</p>' : ''}<div class="prose">${renderMarkdown(result.text)}</div>`;
    }
    $('conversation').append(turn);
    // Commit only completed turns so errors and retries do not duplicate agent history.
    state.history.push(input.at(-1), {role:'assistant', content:result.historyText}); state.lastRequest = null;
    turn.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'});
  } catch (error) {
    if (id === state.requestId) showNotice(timedOut ? 'The response took more than five minutes. Please retry or check whether the agent is still running in Databricks.' : error.name === 'AbortError' ? 'Stopped waiting for the response.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (id === state.requestId) {setBusy(false); state.controller = null; $('chat-input').focus({preventScroll:true});}
  }
}

function resetConversation() {
  state.controller?.abort(); state.requestId++; setBusy(false);
  state.history = []; state.lastRequest = null; state.sessionId = crypto.randomUUID();
  $('conversation').replaceChildren(); $('conversation').hidden = true;
  $('welcome').hidden = false; $('analysis-intro').hidden = true;
  $('chat-input').value = ''; $('chat-input').style.height = '';
  updateMode('home'); clearNotice(); window.scrollTo({top:0});
}
function weightValues() { return Object.fromEntries(FACTORS.map(([key]) => [key, $(`weight-${key}`).value])); }
function updateWeightTotal() {
  const values = Object.values(weightValues()).map(number);
  $('weight-total').textContent = values.some(value => value === null) ? '—' : `${formatNumber(values.reduce((sum, value) => sum + value, 0), 2)}%`;
}
function openWeights() {
  $('weight-inputs').innerHTML = FACTORS.map(([key, label]) => `<label class="weight-row" for="weight-${key}"><span>${esc(label)}</span><input id="weight-${key}" name="${key}" type="number" min="0" max="1000000" step="any" required value="${Number(state.weights[key].toFixed(4))}"><span>%</span></label>`).join('');
  $('weight-error').hidden = true; updateWeightTotal(); $('weights-dialog').showModal();
}
function openDashboard() {
  if (!state.dashboard) {showNotice('The dashboard link is unavailable. Reload the page or check DASHBOARD_URL in the app configuration.'); return;}
  window.open(state.dashboard, '_blank', 'noopener,noreferrer');
}
document.addEventListener('click', event => {
  const prompt = event.target.closest('[data-prompt]');
  if (prompt) { void ask(prompt.dataset.prompt, 'quantitative'); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  switch (button.dataset.action) {
    case 'new': resetConversation(); break;
    case 'home':
      if (state.history.length || state.busy) {updateMode('home'); $('welcome').hidden = false; $('analysis-intro').hidden = true; window.scrollTo({top:0});}
      else resetConversation(); break;
    case 'dashboard': openDashboard(); break;
    case 'quantitative':
      clearNotice(); updateMode('quantitative'); $('welcome').hidden = true;
      $('analysis-intro').hidden = false; window.scrollTo({top:0}); $('chat-input').focus({preventScroll:true}); break;
    case 'recommendations': void ask('Generate the four client recommendations: two Continue Investing clients and two Reduce / Review Exposure clients, using the current scoring weights and your existing eligibility and verification rules. Include detailed risk analysis and relevant verified news where available.', 'recommendations'); break;
    case 'weights': openWeights(); break;
    case 'close-weights': $('weights-dialog').close(); break;
    case 'reset-weights': FACTORS.forEach(([key]) => {$(`weight-${key}`).value = 25;}); updateWeightTotal(); break;
    case 'retry': if (state.lastRequest) void ask(state.lastRequest.question, state.lastRequest.mode, true, state.lastRequest.structured); break;
  }
});
$('chat-form').addEventListener('submit', event => {
  event.preventDefault(); const question = $('chat-input').value.trim();
  if (!question || state.busy) return;
  $('chat-input').value = ''; $('chat-input').style.height = ''; void ask(question, state.mode, false, false);
});
$('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); $('chat-form').requestSubmit();}
});
$('chat-input').addEventListener('input', event => {event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`;});
$('stop-button').addEventListener('click', stopWaiting);
$('weights-form').addEventListener('input', updateWeightTotal);
$('weights-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const weights = normalizeWeights(weightValues());
    const changed = FACTORS.some(([key]) => Math.abs(weights[key] - state.weights[key]) > .0001);
    if (state.busy) throw new Error('Wait for the current response, or stop waiting, before applying new weights.');
    state.weights = weights; $('weights-summary').textContent = weightLabel(state.weights); $('weights-dialog').close();
    if (changed && state.mode === 'recommendations') void ask('Recalculate both eligible client rankings using the new scoring weights and regenerate the recommendations. For the same data snapshot, preserve all underlying client metrics and unweighted factor scores. Verify any ranking movement against the previous run; disclose snapshot changes.', 'recommendations');
    else if (changed) showNotice('Scoring weights updated. They will be applied to your next agent analysis. Previous results retain the weights used for their run.');
  } catch (error) { $('weight-error').textContent = error.message; $('weight-error').hidden = false; }
});
$('weights-dialog').addEventListener('click', event => {if (event.target === $('weights-dialog')) {const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();}});
try {
  const response = await fetch('/ui-config', {credentials:'same-origin'});
  if (!response.ok) throw new Error('Unable to load workspace configuration.');
  const config = await response.json(); state.dashboard = safeURL(config.dashboard_url);
} catch { showNotice('Workspace configuration could not be loaded. Agent chat is available; reload to restore the dashboard link.'); }
