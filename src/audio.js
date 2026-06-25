/* =========================================================================
 * audio.js — WebAudio synth beeps. Lazy-loaded on first user gesture.
 * If WebAudio is unavailable or fails, every call is a safe no-op.
 * ========================================================================= */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // Resume the context after a user gesture (required by browser autoplay rules).
  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') {
      c.resume().catch(function () {});
    }
  }

  function blip(freq, duration, type, gain, when) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var t0 = when != null ? when : c.currentTime;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  var Sound = {
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    unlock: unlock,

    // Soft tick when locking aim.
    aim: function () { blip(440, 0.06, 'square', 0.18); },

    // Tick when locking power.
    power: function () { blip(660, 0.07, 'square', 0.22); },

    // Kick — short noise burst + low blip.
    kick: function () {
      blip(180, 0.12, 'triangle', 0.4);
      // tiny noise click
      if (ctx) {
        var c = ctx;
        var buf = c.createBuffer(1, c.sampleRate * 0.04, c.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        var src = c.createBufferSource();
        var g = c.createGain();
        g.gain.value = 0.25;
        src.buffer = buf;
        src.connect(g);
        g.connect(master);
        src.start();
      }
    },

    goal: function () {
      blip(523.25, 0.12, 'square', 0.4);
      blip(659.25, 0.12, 'square', 0.4, ctx ? ctx.currentTime + 0.10 : null);
      blip(783.99, 0.18, 'square', 0.4, ctx ? ctx.currentTime + 0.20 : null);
    },

    saved: function () {
      blip(220, 0.18, 'sawtooth', 0.3);
      blip(165, 0.20, 'sawtooth', 0.25, ctx ? ctx.currentTime + 0.10 : null);
    },

    miss: function () {
      blip(140, 0.30, 'sawtooth', 0.3);
    },

    gameOver: function () {
      blip(392, 0.15, 'square', 0.35);
      blip(330, 0.15, 'square', 0.35, ctx ? ctx.currentTime + 0.13 : null);
      blip(262, 0.30, 'square', 0.35, ctx ? ctx.currentTime + 0.26 : null);
    }
  };

  global.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
