// Behavioral regression checks against the actual app module, using a small
// DOM facade. No browser automation, packages, LLM, or network is involved.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.doc = doc; this.dataset = {};
    this.children = []; this.listeners = new Map(); this.attributes = {};
    this.style = {}; this.hidden = false; this.disabled = false; this.value = '';
    this._html = ''; this.textContent = ''; this.open = false; this.nodeType = 1;
    const classes = new Set();
    this.classList = {toggle(name, enabled) {if (enabled) classes.add(name); else classes.delete(name);}, contains(name) {return classes.has(name);}};
  }
  set innerHTML(value) {this._html = value; this.children = [];}
  get innerHTML() {return this._html;}
  matches(selector) {
    if (selector.startsWith('.')) return String(this.className || '').split(' ').includes(selector.slice(1));
    const match = /^(\w+)?\[data-([\w-]+)(?:="([^"]+)")?\]$/.exec(selector);
    if (!match) return false;
    const key = match[2].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return (!match[1] || this.tagName === match[1].toUpperCase()) && key in this.dataset && (match[3] === undefined || this.dataset[key] === match[3]);
  }
  closest(selector) {for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null;}
  querySelector(selector) {for (const child of this.children) {if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found;} return null;}
  addEventListener(name, fn) {if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn);}
  setAttribute(name, value) {this.attributes[name] = value;}
  removeAttribute(name) {delete this.attributes[name];}
  append(...children) {children.forEach(child => {child.parentElement = this; this.children.push(child);});}
  replaceChildren(...children) {this.children.forEach(child => {child.parentElement = null;}); this.children = []; this._html = ''; this.append(...children);}
  focus() {this.doc.activeElement = this;}
  scrollIntoView() {}
  emit(type, target = this) {
    const event = {type, target, stopped:false, defaultPrevented:false, preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}};
    for (let node = target; node && !event.stopped; node = node.parentElement) for (const fn of node.listeners.get(type) || []) fn(event);
    if (!event.stopped) this.doc.emit(type, event);
  }
  click() {this.emit('click');}
  requestSubmit() {this.emit('submit');}
}
class Document {
  constructor(html) {
    this.nodes = []; this.ids = new Map(); this.listeners = new Map();
    for (const [, tag, attributes] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
      const node = this.createElement(tag);
      for (const [, key, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
        if (key === 'id') this.ids.set(value, node);
        if (key === 'class') node.className = value;
        if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
        node.attributes[key] = value;
      }
      node.hidden = /\bhidden(?:\s|$)/.test(attributes);
    }
  }
  createElement(tag) {const node = new Element(tag, this); this.nodes.push(node); return node;}
  getElementById(id) {return this.ids.get(id);}
  querySelectorAll(selector) {return this.nodes.filter(node => node.matches(selector));}
  addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn);}
  emit(type, event) {for (const fn of this.listeners.get(type) || []) fn(event);}
}
const html = await readFile(new URL('../agent_server/static/index.html', import.meta.url), 'utf8');
assert.match(html, /<a id="new-conversation"[^>]*href="\/"[^>]*data-action="new"/);
const doc = new Document(html);
const saved = {document:globalThis.document, window:globalThis.window, fetch:globalThis.fetch};
const pending = [];
const response = text => ({ok:true, json:async () => ({output_text:text})});
const flush = async () => {for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));};
globalThis.document = doc;
globalThis.window = {scrollTo() {}, matchMedia() {return {matches:true};}, open() {}};
globalThis.fetch = async (path, options) => {
  if (path === '/ui-config') return {ok:true, json:async () => ({dashboard_url:'https://example.com/dashboard', context_tables:['workspace.ifc_case_comp.external_news', 'workspace.ifc_case_comp.industry_reports', 'workspace.ifc_case_comp.regional_risk_reports']})};
  return await new Promise(resolve => pending.push({request:JSON.parse(options.body), signal:options.signal, resolve}));
};
try {
  await import('../agent_server/static/app.mjs');
  await flush();
  const input = doc.getElementById('chat-input'), conversation = doc.getElementById('conversation');
  const send = text => {input.value = text; doc.getElementById('chat-form').requestSubmit();};
  const newChat = doc.getElementById('new-conversation');
  const iconChild = doc.createElement('span'); newChat.append(iconChild);
  send('Old question'); await flush();
  assert.equal(pending.length, 1); assert.equal(input.disabled, true);
  const oldSession = pending[0].request.custom_inputs.session_id;
  iconChild.click(); await flush();
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(conversation.children.length, 0);
  assert.equal(doc.getElementById('welcome').hidden, false);
  assert.equal(input.disabled, false);
  assert.equal(doc.activeElement, input);
  assert.ok(doc.getElementById('notice').innerHTML.includes('New conversation started'));
  // Resolve even after abort to simulate a stale proxy/SDK response.
  pending[0].resolve(response('This old result must not return.')); await flush();
  assert.equal(conversation.children.length, 0);
  send('Fresh question'); await flush();
  assert.notEqual(pending[1].request.custom_inputs.session_id, oldSession);
  assert.equal(pending[1].request.input.length, 1);
  assert.equal(pending[1].request.input[0].content, 'Fresh question');
  pending[1].resolve(response('Original quantitative answer.')); await flush();
  const turn = conversation.children.at(-1);
  const key = /data-context-key="([^"]+)"/.exec(turn.innerHTML)[1];
  const detail = doc.createElement('details'); detail.dataset.contextKey = key; detail.open = true;
  const body = doc.createElement('div'); body.dataset.contextBody = ''; detail.append(body); turn.append(detail);
  doc.emit('toggle', {target:detail}); await flush();
  assert.equal(pending[2].request.custom_inputs.ui_mode, 'more_details');
  assert.notEqual(pending[2].request.custom_inputs.session_id, pending[1].request.custom_inputs.session_id);
  assert.ok(pending[2].request.input[0].content.includes('regional_risk_reports'));
  pending[2].resolve(response('Original news and report context.')); await flush();
  assert.ok(body.innerHTML.includes('Original news and report context.'));
  detail.open = false; doc.emit('toggle', {target:detail}); detail.open = true; doc.emit('toggle', {target:detail}); await flush();
  assert.equal(pending.length, 3, 'Opening cached details must not query Genie again.');
  send('Another analysis'); await flush(); pending[3].resolve(response('Another original answer.')); await flush();
  const nextTurn = conversation.children.at(-1);
  const nextDetail = doc.createElement('details'); nextDetail.open = true;
  nextDetail.dataset.contextKey = /data-context-key="([^"]+)"/.exec(nextTurn.innerHTML)[1];
  const nextBody = doc.createElement('div'); nextBody.dataset.contextBody = ''; nextDetail.append(nextBody); nextTurn.append(nextDetail);
  doc.emit('toggle', {target:nextDetail}); await flush();
  newChat.click(); await flush();
  assert.equal(pending[4].signal.aborted, true);
  pending[4].resolve(response('Stale supporting context.')); await flush();
  assert.equal(conversation.children.length, 0);
  assert.ok(!nextBody.innerHTML.includes('Stale supporting context.'));
  console.log('New conversation click/reset, in-flight cancellation, fresh sessions, lazy details, caching and stale-response checks passed.');
} finally {
  globalThis.document = saved.document; globalThis.window = saved.window; globalThis.fetch = saved.fetch;
  pending.forEach(item => item.resolve(response('Test teardown.')));
  await flush();
}
