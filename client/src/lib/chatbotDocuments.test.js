import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DOCUMENTS_CHARS,
  resolveChatbotDocuments,
  persistChatbotDocuments,
  addChatbotDocument,
  removeChatbotDocument,
  buildDocumentsContext,
  combineSystemPromptWithDocuments,
} from './chatbotDocuments.js';

function withMemoryStorage(fn) {
  const store = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  try { return fn(); } finally { globalThis.localStorage = prev; }
}

test('buildDocumentsContext returns empty for no docs', () => {
  const r = buildDocumentsContext([]);
  assert.equal(r.text, '');
  assert.equal(r.truncated, false);
  assert.equal(r.totalChars, 0);
});

test('buildDocumentsContext includes header and per-doc sections', () => {
  const r = buildDocumentsContext([{ name: 'a.pdf', text: 'hello', chars: 5 }]);
  assert.match(r.text, /# Uploaded Reference Documents/);
  assert.match(r.text, /## a\.pdf/);
  assert.match(r.text, /hello/);
  assert.equal(r.truncated, false);
  assert.equal(r.totalChars, r.text.length);
});

test('buildDocumentsContext truncates to maxChars', () => {
  const big = 'x'.repeat(500);
  const r = buildDocumentsContext([{ name: 'b.pdf', text: big, chars: big.length }], { maxChars: 100 });
  assert.equal(r.text.length, 100);
  assert.equal(r.truncated, true);
  assert.ok(r.totalChars > 100);
});

test('combineSystemPromptWithDocuments appends only when context present', () => {
  assert.equal(combineSystemPromptWithDocuments('PROMPT', ''), 'PROMPT');
  assert.equal(combineSystemPromptWithDocuments('PROMPT', 'CTX'), 'PROMPT\n\nCTX');
});

test('addChatbotDocument replaces an entry with the same name', () => {
  const one = addChatbotDocument([], { name: 'a.pdf', text: 'v1', chars: 2 });
  const two = addChatbotDocument(one, { name: 'a.pdf', text: 'v2', chars: 2 });
  assert.equal(two.length, 1);
  assert.equal(two[0].text, 'v2');
});

test('removeChatbotDocument drops the named entry', () => {
  const docs = [{ name: 'a.pdf', text: 'x', chars: 1 }, { name: 'b.pdf', text: 'y', chars: 1 }];
  const r = removeChatbotDocument(docs, 'a.pdf');
  assert.deepEqual(r.map((d) => d.name), ['b.pdf']);
});

test('persist + resolve round-trips through storage', () => {
  withMemoryStorage(() => {
    const docs = [{ name: 'a.pdf', text: 'hello', chars: 5 }];
    assert.deepEqual(persistChatbotDocuments(docs), { ok: true });
    assert.deepEqual(resolveChatbotDocuments(), docs);
  });
});

test('resolveChatbotDocuments returns [] when storage is empty or invalid', () => {
  withMemoryStorage(() => {
    assert.deepEqual(resolveChatbotDocuments(), []);
    globalThis.localStorage.setItem('chatbot.documents', 'not json');
    assert.deepEqual(resolveChatbotDocuments(), []);
  });
});

test('MAX_DOCUMENTS_CHARS is 100000', () => {
  assert.equal(MAX_DOCUMENTS_CHARS, 100000);
});
