/* =========================================================================
 * ar-pose.js — MediaPipe Tasks Vision (PoseLandmarker) + webcam capture.
 *
 * Uses the newer @mediapipe/tasks-vision API (UMD bundle loaded via classic
 * <script> tag in index.html). This API is actively maintained and uses a
 * WASM binary compatible with current Emscripten runtimes.
 *
 * API flow:
 *   1. FilesetResolver.forVisionTasks() — loads WASM from CDN
 *   2. PoseLandmarker.createFromOptions() — creates the detector
 *   3. requestAnimationFrame loop — feeds video frames to detectForVideo()
 *
 * Produces raw 33-point landmark arrays (same format as the legacy API) so
 * ar-mapping.js and ar-input.js work unchanged.
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = global.C;

  function ArPose() {
    this._landmarker = null;
    this._video = null;
    this._ready = false;
    this._active = false;
    this._lastResults = null;
    this._onResults = null;
    this._onError = null;
    this._rafId = null;       // requestAnimationFrame handle
    this._lastFrameTime = 0;  // throttle pose inference
  }

  ArPose.prototype.init = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      // 1. Check CDN loaded the global `vision` namespace.
      if (typeof global.vision === 'undefined' || !global.vision.FilesetResolver) {
        reject(new Error('MediaPipe Tasks Vision not loaded (CDN failure)'));
        return;
      }

      // 2. Get webcam access first (needs user gesture for permission).
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject(new Error('Webcam not supported in this browser'));
        return;
      }

      navigator.mediaDevices.getUserMedia({
        video: { width: C.AR.CAPTURE_WIDTH, height: C.AR.CAPTURE_HEIGHT, facingMode: 'user' },
        audio: false
      }).then(function (stream) {
        self._video = document.createElement('video');
        self._video.setAttribute('autoplay', '');
        self._video.setAttribute('playsinline', '');
        self._video.setAttribute('muted', '');
        self._video.srcObject = stream;
        self._video.style.display = 'none';
        document.body.appendChild(self._video);
        return self._video.play();
      }).then(function () {
        // 3. Load the WASM fileset from CDN.
        return global.vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
      }).then(function (filesetResolver) {
        // 4. Create PoseLandmarker.
        return global.vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: C.AR.MIN_DETECTION_CONFIDENCE,
          minPosePresenceConfidence: C.AR.MIN_DETECTION_CONFIDENCE,
          minTrackingConfidence: C.AR.MIN_DETECTION_CONFIDENCE,
          outputSegmentationMasks: false
        });
      }).then(function (landmarker) {
        self._landmarker = landmarker;

        // 5. Start our own rAF loop for pose inference (no Camera helper).
        //    Throttle to C.AR.POSE_DETECTION_INTERVAL_MS to save CPU.
        function loop() {
          if (!self._active) return;
          self._rafId = global.requestAnimationFrame(loop);
          if (self._video.readyState < 2 || !self._landmarker) return;
          var now = performance.now();
          if (now - self._lastFrameTime < C.AR.POSE_DETECTION_INTERVAL_MS) return;
          self._lastFrameTime = now;
          try {
            var results = self._landmarker.detectForVideo(self._video, now);
            self._lastResults = results;
            if (self._onResults) self._onResults(results);
          } catch (e) {
            // WASM can throw if the module is torn down mid-frame
            if (self._onError) self._onError(e);
          }
        }
        self._rafId = global.requestAnimationFrame(loop);

        self._ready = true;
        self._active = true;
        resolve();
      }).catch(function (err) {
        reject(err || new Error('Camera or model init failed'));
      });
    });
  };

  ArPose.prototype.stop = function () {
    this._active = false;
    this._ready = false;
    if (this._rafId) {
      try { global.cancelAnimationFrame(this._rafId); } catch (e) {}
      this._rafId = null;
    }
    if (this._video && this._video.srcObject) {
      var tracks = this._video.srcObject.getTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].stop();
      this._video.srcObject = null;
    }
    if (this._video && this._video.parentNode) {
      this._video.parentNode.removeChild(this._video);
    }
    this._video = null;
    this._landmarker = null;
  };

  ArPose.prototype.isReady = function () { return this._ready; };
  ArPose.prototype.isActive = function () { return this._active; };
  ArPose.prototype.getVideo = function () { return this._video; };
  ArPose.prototype.getLastResults = function () { return this._lastResults; };

  ArPose.prototype.onResults = function (cb) { this._onResults = cb; };
  ArPose.prototype.onError = function (cb) { this._onError = cb; };

  global.ArPose = ArPose;
})(typeof window !== 'undefined' ? window : globalThis);
