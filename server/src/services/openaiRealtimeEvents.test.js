import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RealtimeEventMapper,
  buildClientEvent,
  buildRealtimeSessionUpdate,
  getMissingOpenAiConfigMessage,
} from './openaiRealtimeEvents.js';

test('buildClientEvent keeps browser events JSON serializable', () => {
  assert.deepEqual(buildClientEvent('assistant.text.done', { text: 'Hi' }), {
    type: 'assistant.text.done',
    text: 'Hi',
  });
  assert.deepEqual(buildClientEvent('session.ready'), { type: 'session.ready' });
});

test('buildRealtimeSessionUpdate configures text-only OpenAI responses', () => {
  const message = buildRealtimeSessionUpdate({
    systemPrompt: 'You are casual.',
    vadMode: 'semantic_vad',
  });

  assert.equal(message.type, 'session.update');
  assert.equal(message.session.type, 'realtime');
  assert.deepEqual(message.session.output_modalities, ['text']);
  assert.equal(message.session.instructions, 'You are casual.');
  assert.equal(message.session.audio.input.format.type, 'audio/pcm');
  assert.equal(message.session.audio.input.format.rate, 24000);
  assert.equal(message.session.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(message.session.audio.input.turn_detection.create_response, true);
  assert.equal(message.session.audio.input.turn_detection.interrupt_response, true);
  assert.equal('max_output_tokens' in message.session, false);
});

test('buildRealtimeSessionUpdate configures server VAD when requested', () => {
  const message = buildRealtimeSessionUpdate({
    systemPrompt: 'You are casual.',
    vadMode: 'server_vad',
  });

  assert.equal(message.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(message.session.audio.input.turn_detection.threshold, 0.5);
  assert.equal(message.session.audio.input.turn_detection.silence_duration_ms, 650);
});

test('RealtimeEventMapper maps speech lifecycle events', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({ type: 'session.updated' }), [{ type: 'session.ready' }]);
  assert.deepEqual(mapper.map({ type: 'input_audio_buffer.speech_started' }), [
    { type: 'user.speech.started' },
  ]);
  assert.deepEqual(mapper.map({ type: 'input_audio_buffer.speech_stopped' }), [
    { type: 'user.speech.stopped' },
  ]);
});

test('RealtimeEventMapper accumulates assistant text deltas and emits final text once', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    delta: 'Hello',
  }), [{ type: 'assistant.text.delta', text: 'Hello' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    delta: ' there',
  }), [{ type: 'assistant.text.delta', text: ' there' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    text: 'Hello there',
  }), [{ type: 'assistant.text.done', text: 'Hello there' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    text: 'Hello there',
  }), []);
});

test('RealtimeEventMapper emits separate done events for text parts in the same response', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    item_id: 'item_1',
    content_index: 0,
    delta: 'First',
  }), [{ type: 'assistant.text.delta', text: 'First' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.delta',
    response_id: 'resp_1',
    item_id: 'item_2',
    content_index: 1,
    delta: 'Second',
  }), [{ type: 'assistant.text.delta', text: 'Second' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    item_id: 'item_1',
    content_index: 0,
  }), [{ type: 'assistant.text.done', text: 'First' }]);

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    item_id: 'item_2',
    content_index: 1,
  }), [{ type: 'assistant.text.done', text: 'Second' }]);
});

test('RealtimeEventMapper skips response done text parts already finalized by output text done', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    item_id: 'item_1',
    content_index: 0,
    text: 'Hello there',
  }), [{ type: 'assistant.text.done', text: 'Hello there' }]);

  assert.deepEqual(mapper.map({
    type: 'response.done',
    response: {
      id: 'resp_1',
      output: [{
        id: 'item_1',
        content: [{ type: 'output_text', text: 'Hello there' }],
      }],
    },
  }), []);
});

test('RealtimeEventMapper preserves newlines in final text', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'response.output_text.done',
    response_id: 'resp_1',
    item_id: 'item_1',
    content_index: 0,
    text: '\nLine one\nLine two\n',
  }), [{ type: 'assistant.text.done', text: 'Line one\nLine two' }]);
});

test('RealtimeEventMapper maps OpenAI errors to user-safe app errors', () => {
  const mapper = new RealtimeEventMapper();

  assert.deepEqual(mapper.map({
    type: 'error',
    error: { message: 'invalid API key', code: 'invalid_api_key' },
  }), [{
    type: 'error',
    message: 'AI conversation failed: invalid API key',
    code: 'invalid_api_key',
  }]);
});

test('getMissingOpenAiConfigMessage returns a live-specific message only without a key', () => {
  assert.equal(
    getMissingOpenAiConfigMessage(''),
    'OpenAI Realtime is not configured. Set OPENAI_API_KEY on the backend.',
  );
  assert.equal(getMissingOpenAiConfigMessage('sk-test'), '');
});
