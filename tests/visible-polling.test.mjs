import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startVisiblePolling } from '../src/lib/visiblePolling.ts';

class Page extends EventTarget {
  visibilityState = 'visible';
  show(state) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('idle background tab sends no requests and catches up immediately on return', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new Page();
  let requests = 0;
  const stop = startVisiblePolling(page, 5000, async () => { requests++; });
  try {
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(requests, 1);
    page.show('hidden');
    t.mock.timers.tick(60000);
    await flush();
    assert.equal(requests, 1);
    page.show('visible');
    assert.equal(requests, 2);
    await flush();
    t.mock.timers.tick(5000);
    assert.equal(requests, 3);
  } finally { stop(); }
});

test('slow requests never overlap, and cleanup aborts the active request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new Page();
  const requests = [];
  let release;
  const stop = startVisiblePolling(page, 5000, (signal) => {
    requests.push(signal);
    return new Promise((resolve) => { release = resolve; });
  });
  t.mock.timers.tick(5000);
  page.show('hidden');
  page.show('visible');
  t.mock.timers.tick(15000);
  assert.equal(requests.length, 1);
  release();
  await flush();
  assert.equal(requests.length, 2);
  stop();
  assert.equal(requests[1].aborted, true);
  release();
  await flush();
  page.show('visible');
  t.mock.timers.tick(60000);
  assert.equal(requests.length, 2);
});

test('initially hidden and failed requests recover on normal cadence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = new Page();
  page.show('hidden');
  let requests = 0;
  const stop = startVisiblePolling(page, 5000, async () => {
    if (++requests === 1) throw new Error('synthetic disconnect');
  });
  try {
    t.mock.timers.tick(60000);
    assert.equal(requests, 0);
    page.show('visible');
    assert.equal(requests, 1);
    await flush();
    t.mock.timers.tick(5000);
    assert.equal(requests, 2);
  } finally { stop(); }
});
