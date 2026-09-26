// The stop-to-go movement of the Swiss railway clock (Hans Hilfiker, 1944/1953).
//
// The second hand is driven by its own motor and sweeps once around in
// (60 - stop) seconds. It then waits at 12 until the master clock sends the
// minute impulse: at that moment the minute hand jumps forward by one minute
// and the second hand is released for the next round. The real clocks wait
// about 1.5 s; the pause is a setting here.
//
// Angles are in degrees, clockwise from 12.

const TAU_JUMP = 22;   // minute jump: spring damping (1/s)
const W_JUMP = 38;     // minute jump: spring frequency (rad/s)

/** Minute-hand jump progress 0..1 (with a small mechanical overshoot). */
export function jumpProgress(dt, animated = true) {
  if (!animated || dt >= 0.45) return 1;
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt * TAU_JUMP) * Math.cos(dt * W_JUMP);
}

/** Small rebound of the second hand when it hits the stop at 12. */
function latchBounce(dt) {
  if (dt < 0 || dt > 0.5) return 0;
  return 0.55 * Math.exp(-dt * 13) * Math.sin(dt * 46);
}

/**
 * Hand angles for a local wall-clock time.
 * @param {Date|number} time  local time (Date or epoch ms)
 * @param {{stopSeconds:number, minuteJump:boolean}} opts
 */
export function handAngles(time, opts) {
  const d = time instanceof Date ? time : new Date(time);
  const stop = Math.min(10, Math.max(0, opts.stopSeconds));
  const sweep = 60 - stop;
  const s = d.getSeconds() + d.getMilliseconds() / 1000;   // 0..60 within this minute
  const m = d.getMinutes();
  const h = d.getHours() % 12;

  let second;
  if (s < sweep) second = (360 * s) / sweep;
  else second = 360 + latchBounce(s - sweep);
  if (stop === 0) second = 6 * s;

  // The minute and hour hands step once per minute, at the impulse (s = 0).
  const p = jumpProgress(s, opts.minuteJump);
  const minute = (m - 1 + p) * 6;
  const hour = h * 30 + (m - 1 + p) * 0.5;

  return {
    hour: ((hour % 360) + 360) % 360,
    minute: ((minute % 360) + 360) % 360,
    second: second % 360 === 0 ? 0 : second,
    secondsInMinute: s,
    waiting: stop > 0 && s >= sweep,
    sweep,
  };
}

/**
 * Upcoming sound events relative to `time` (seconds until each).
 * 'release' = minute impulse (second hand unlocks, minute hand jumps);
 * 'latch'   = the second hand arrives at 12 and stops.
 */
export function nextEvents(time, stopSeconds) {
  const d = time instanceof Date ? time : new Date(time);
  const s = d.getSeconds() + d.getMilliseconds() / 1000;
  const sweep = 60 - Math.min(10, Math.max(0, stopSeconds));
  const out = [{ type: 'release', in: 60 - s, at: Math.round(d.getTime() + (60 - s) * 1000) }];
  if (stopSeconds > 0) {
    const inLatch = s < sweep ? sweep - s : sweep + 60 - s;
    out.push({ type: 'latch', in: inLatch, at: Math.round(d.getTime() + inLatch * 1000) });
  }
  return out;
}
