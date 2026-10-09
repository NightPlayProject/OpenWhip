(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhipMotion = api.WhipMotion;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const STEP = 1000 / 120;

  class FlickDetector {
    constructor() { this.reset(0); }

    reset(time) {
      this.previous = null;
      this.stroke = null;
      this.armed = true;
      this.quietSince = null;
      this.lastCrack = -Infinity;
      this.readyAt = time + 180;
      this.history = [];
    }

    sample(point) {
      const previous = this.previous;
      if (previous && point.time <= previous.time) return false;
      this.previous = point;
      if (!previous) { this.history = [point]; return false; }
      const elapsed = point.time - previous.time;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (elapsed > 120 || distance > 600) {
        this.stroke = null;
        this.history = [point];
        this.readyAt = point.time + 180;
        return false;
      }
      this.history.push(point);
      while (this.history.length > 2 && this.history[1].time <= point.time - 40) this.history.shift();
      const oldest = this.history[0];
      const speed = Math.hypot(point.x - oldest.x, point.y - oldest.y) * 1000 / Math.max(1, point.time - oldest.time);
      if (speed < 220) {
        this.quietSince ??= point.time;
        if (point.time - this.quietSince >= 100) { this.armed = true; this.stroke = null; }
      } else {
        this.quietSince = null;
      }
      if (!this.armed || point.time < this.readyAt || point.time - this.lastCrack < 1000) return false;
      if (this.stroke && point.time - this.stroke.time > 220) this.stroke = null;
      if (!this.stroke && speed >= 600) this.stroke = { ...previous, travel: 0 };
      if (!this.stroke) return false;
      this.stroke.travel += distance;
      const displacement = Math.hypot(point.x - this.stroke.x, point.y - this.stroke.y);
      if (speed >= 1100 && this.stroke.travel >= 90 && displacement >= 80) {
        this.lastCrack = point.time;
        this.armed = false;
        this.stroke = null;
        return true;
      }
      return false;
    }
  }

  class WhipMotion {
    constructor() {
      this.points = [];
      this.lengths = Array.from({ length: 27 }, (_, index) => index < 2 ? 19 : mix(23, 11, (index - 2) / 24));
      this.baseAngle = -1.12;
      this.detector = new FlickDetector();
      this.active = false;
      this.dropping = false;
      this.samples = [];
    }

    spawn(point) {
      this.active = true;
      this.dropping = false;
      this.angle = this.baseAngle;
      this.angularVelocity = 0;
      this.aimVelocity = { x: 0, y: 0 };
      this.simulationTime = point.time;
      this.lastFrame = point.time;
      this.accumulator = 0;
      this.crackAt = -Infinity;
      this.samples = [{ ...point }];
      this.detector.reset(point.time);
      this.detector.sample(point);
      this.points = [{ x: point.x, y: point.y, px: point.x, py: point.y }];
      for (let index = 0; index < this.lengths.length; index++) {
        const previous = this.points[index];
        const angle = this.baseAngle + Math.pow(index / this.lengths.length, 2) * 1.1;
        const x = previous.x + Math.cos(angle) * this.lengths[index];
        const y = previous.y + Math.sin(angle) * this.lengths[index];
        this.points.push({ x, y, px: x, py: y });
      }
    }

    input(point) {
      if (!this.active || this.dropping || ![point.x, point.y, point.time].every(Number.isFinite)) return false;
      if (point.time <= this.samples.at(-1).time) return false;
      this.samples.push({ ...point });
      // Keep recent samples for interpolation, including samples from a paused renderer.
      while (this.samples.length > 64) this.samples.shift();
      const cracked = this.detector.sample(point);
      if (cracked) this.crackAt = point.time;
      return cracked;
    }

    positionAt(time) {
      while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift();
      const a = this.samples[0];
      const b = this.samples[1] || a;
      const amount = a === b ? 0 : clamp((time - a.time) / (b.time - a.time), 0, 1);
      return { x: mix(a.x, b.x, amount), y: mix(a.y, b.y, amount) };
    }

    drop(time) {
      if (!this.active || this.dropping) return;
      this.dropping = true;
      this.dropAt = time;
    }

    stop() { this.active = false; this.points = []; }

    rebase(dx, dy) {
      for (const point of this.points) { point.x += dx; point.px += dx; point.y += dy; point.py += dy; }
      for (const point of this.samples) { point.x += dx; point.y += dy; }
      if (this.detector.previous) {
        // All detector positions share objects with its history; translate each once.
        const positions = new Set([...this.detector.history, this.detector.previous, this.detector.stroke]);
        for (const point of positions) if (point) { point.x += dx; point.y += dy; }
      }
    }

    advance(time) {
      if (!this.active || time <= this.lastFrame) return;
      const elapsed = time - this.lastFrame;
      this.lastFrame = time;
      if (elapsed > 120) {
        this.aimVelocity = { x: 0, y: 0 };
        this.angularVelocity = 0;
        const latest = this.samples.at(-1);
        const dx = latest.x - this.points[0].x;
        const dy = latest.y - this.points[0].y;
        for (const point of this.points) { point.x += dx; point.y += dy; point.px = point.x; point.py = point.y; }
        this.samples = [{ ...latest }];
        this.simulationTime = time;
        this.accumulator = 0;
        this.detector.reset(time);
        this.detector.sample(latest);
      } else {
        this.accumulator += elapsed;
        while (this.accumulator + 0.00001 >= STEP) {
          this.simulationTime += STEP;
          // A tiny sample buffer lets every display interpolate the same cursor path.
          this.step(STEP / 1000, this.positionAt(this.simulationTime - 16));
          this.accumulator -= STEP;
        }
      }
      if (this.dropping && time - this.dropAt >= 650) this.stop();
    }

    step(dt, cursor) {
      const points = this.points;
      const head = points[0];
      if (!this.dropping) {
        const vx = (cursor.x - head.x) / dt;
        const vy = (cursor.y - head.y) / dt;
        const response = 1 - Math.exp(-18 * dt);
        this.aimVelocity.x = mix(this.aimVelocity.x, vx, response);
        this.aimVelocity.y = mix(this.aimVelocity.y, vy, response);
        const target = this.baseAngle + clamp(this.aimVelocity.x / 3600 + this.aimVelocity.y / 4800, -0.65, 0.65);
        this.angularVelocity += (wrapAngle(target - this.angle) * 180 - this.angularVelocity * 28) * dt;
        this.angle = wrapAngle(this.angle + this.angularVelocity * dt);
      }
      const firstFree = this.dropping ? 0 : 3;
      const damping = Math.exp(-5.8 * dt);
      for (let index = firstFree; index < points.length; index++) {
        const point = points[index];
        let vx = (point.x - point.px) * damping;
        let vy = (point.y - point.py) * damping;
        const speed = Math.hypot(vx, vy);
        if (speed > 6500 * dt) { vx *= 6500 * dt / speed; vy *= 6500 * dt / speed; }
        point.px = point.x;
        point.py = point.y;
        point.x += vx;
        point.y += vy + (this.dropping ? 1900 : 1100) * dt * dt;
      }
      if (!this.dropping) {
        head.x = cursor.x; head.y = cursor.y;
        head.px = cursor.x; head.py = cursor.y;
        for (let index = 1; index <= 2; index++) {
          const point = points[index];
          point.px = point.x; point.py = point.y;
          point.x = points[index - 1].x + Math.cos(this.angle) * this.lengths[index - 1];
          point.y = points[index - 1].y + Math.sin(this.angle) * this.lengths[index - 1];
        }
      }
      // Gently limit sharp folds once per fixed step, leaving the tail free to travel.
      if (!this.dropping) {
        for (let index = 2; index < points.length - 1; index++) {
          const a = points[index - 1], b = points[index], c = points[index + 1];
          const incoming = Math.atan2(b.y - a.y, b.x - a.x);
          const bend = wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - incoming);
          const position = (index - 2) / (points.length - 3);
          const limit = mix(0.65, 2.5, position);
          if (Math.abs(bend) > limit) {
            const angle = incoming + Math.sign(bend) * limit;
            const strength = mix(0.4, 0.08, position);
            c.x = mix(c.x, b.x + Math.cos(angle) * this.lengths[index], strength);
            c.y = mix(c.y, b.y + Math.sin(angle) * this.lengths[index], strength);
          }
        }
      }
      for (let iteration = 0; iteration < 12; iteration++) {
        for (let index = this.dropping ? 0 : 2; index < this.lengths.length; index++) {
          const a = points[index], b = points[index + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.0001;
          const correction = (distance - this.lengths[index]) / distance;
          const aWeight = index >= firstFree ? 0.5 : 0;
          a.x += dx * correction * aWeight; a.y += dy * correction * aWeight;
          b.x -= dx * correction * (1 - aWeight); b.y -= dy * correction * (1 - aWeight);
        }
        // A soft two-link span resists tiny knots without pinning the moving tail.
        if (!this.dropping) {
          for (let index = 2; index < points.length - 1; index++) {
            const a = points[index - 1], c = points[index + 1];
            const dx = c.x - a.x, dy = c.y - a.y;
            const distance = Math.hypot(dx, dy) || 0.0001;
            const span = (this.lengths[index - 1] + this.lengths[index]) * 0.96;
            if (distance >= span) continue;
            const strength = mix(0.12, 0.025, (index - 2) / (points.length - 3));
            const correction = (span - distance) / distance * strength;
            const aWeight = index - 1 >= firstFree ? 0.5 : 0;
            a.x -= dx * correction * aWeight; a.y -= dy * correction * aWeight;
            c.x += dx * correction * (1 - aWeight); c.y += dy * correction * (1 - aWeight);
          }
        }
      }
      // Bound the length even for a fast flick or a pointer jump.
      for (let index = this.dropping ? 0 : 2; index < this.lengths.length; index++) {
        const a = points[index], b = points[index + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.0001) {
          const ratio = this.lengths[index] / distance;
          b.x = a.x + dx * ratio; b.y = a.y + dy * ratio;
        }
      }
    }

    renderPoints() {
      if (!this.active) return [];
      const result = this.points.map(point => ({ x: point.x, y: point.y }));
      if (!this.dropping) {
        const latest = this.samples.at(-1);
        const dx = latest.x - result[0].x, dy = latest.y - result[0].y;
        for (let index = 0; index < result.length; index++) {
          // Anchor the grip immediately; blend the short substep remainder into the rope.
          const weight = Math.max(0, 1 - Math.max(0, index - 2) / 8);
          result[index].x += dx * weight;
          result[index].y += dy * weight;
        }
      }
      return result;
    }
  }

  return { WhipMotion, FlickDetector };
});
