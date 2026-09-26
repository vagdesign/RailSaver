// Unit checks for the stop-to-go movement (node tools/test-motion.mjs).
import assert from 'node:assert/strict';
import { handAngles, jumpProgress, nextEvents } from '../web/js/motion.js';

const at = (h, m, s, ms = 0) => new Date(2026, 8, 26, h, m, s, ms);
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const opts = { stopSeconds: 1.5, minuteJump: true };

// Sweep: 58.5 s per turn, then waits at 12.
near(handAngles(at(10, 9, 0, 0), opts).second, 0, 1e-9, 'second at impulse');
near(handAngles(at(10, 9, 29, 250), opts).second, 180, 1e-6, 'half-way after 29.25 s');
{
  const a = handAngles(at(10, 9, 59, 400), opts);
  assert.ok(a.waiting, 'waiting at 12 after 58.5 s');
  assert.ok(a.second < 1 || a.second > 359, `second near 12 while waiting (${a.second})`);
}
// Long stop (6 s): sweep 54 s.
near(handAngles(at(10, 9, 27), { stopSeconds: 6, minuteJump: false }).second, 180, 1e-6, '6 s stop, half-way at 27 s');
// Continuous sweep with stop 0.
near(handAngles(at(10, 9, 15), { stopSeconds: 0, minuteJump: false }).second, 90, 1e-6, 'continuous');

// Minute hand: previous minute right at the impulse, the new minute once settled.
near(handAngles(at(10, 9, 0, 0), opts).minute, 8 * 6, 1e-9, 'minute before jump');
near(handAngles(at(10, 9, 1), opts).minute, 9 * 6, 1e-9, 'minute after jump');
near(handAngles(at(10, 9, 30), opts).hour, 10 * 30 + 9 * 0.5, 1e-9, 'hour');
near(handAngles(at(0, 0, 0, 0), opts).minute, 354, 1e-9, 'wraps at midnight');
assert.equal(jumpProgress(0.5), 1);
assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => jumpProgress(i / 100))) > 1.05, 'overshoots');
assert.equal(jumpProgress(0.01, false), 1, 'no animation when disabled');

// Events.
const ev = nextEvents(at(10, 9, 58, 400), 1.5);
near(ev.find((e) => e.type === 'release').in, 1.6, 1e-9, 'release in 1.6 s');
near(ev.find((e) => e.type === 'latch').in, 0.1, 1e-9, 'latch in 0.1 s');
assert.equal(nextEvents(at(10, 9, 10), 0).length, 1, 'no latch without a stop');
console.log('motion: all checks passed');
