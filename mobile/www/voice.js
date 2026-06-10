// voice.js — speech-to-text input
// Uses Capacitor SpeechRecognition plugin when running as a native app,
// falls back to the Web Speech API in the browser.
//
// Usage:
//   const v = new VoiceInput({ onResult: text => ... });
//   await v.start();  // returns a promise that resolves when the user
//                       // grants permission and recognition starts
//   v.stop();          // commits the final transcript
//   v.cancel();        // discards

const cap = () => (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;

export class VoiceInput {
  constructor({ onPartial = () => {}, onResult = () => {}, onError = () => {}, lang = 'en-US' } = {}) {
    this.onPartial = onPartial;
    this.onResult = onResult;
    this.onError = onError;
    this.lang = lang;
    this.active = false;
    this._rec = null;       // browser SpeechRecognition instance
    this._plugin = null;    // Capacitor plugin
  }

  isNative() {
    return !!cap() && !!cap().SpeechRecognition;
  }

  isSupported() {
    return this.isNative() || !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async start() {
    if (this.active) return;
    if (!this.isSupported()) {
      this.onError(new Error('Speech recognition not supported in this browser. Try Chrome or Edge.'));
      return;
    }
    this.active = true;
    if (this.isNative()) {
      await this._startNative();
    } else {
      this._startWeb();
    }
  }

  async _startNative() {
    this._plugin = cap().SpeechRecognition;
    try {
      const perm = await this._plugin.requestPermissions();
      if (perm.speechRecognition !== 'granted') {
        this.active = false;
        this.onError(new Error('Microphone permission denied. Allow it in Settings to use voice.'));
        return;
      }
      await this._plugin.start({
        language: this.lang,
        partialResults: true,
        popup: false,
      });
      this._plugin.addListener('partialResults', (data) => {
        if (data.matches && data.matches.length) this.onPartial(data.matches[0]);
      });
      this._plugin.addListener('result', (data) => {
        const text = (data.matches && data.matches[0]) || '';
        this.onResult(text);
        this._stopListening();
      });
      this._plugin.addListener('error', (e) => {
        this.onError(new Error(e.error || 'Speech recognition error'));
        this._stopListening();
      });
    } catch (e) {
      this.active = false;
      this.onError(e);
    }
  }

  _startWeb() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._rec = new SR();
    this._rec.lang = this.lang;
    this._rec.interimResults = true;
    this._rec.continuous = true;
    this._rec.onresult = (e) => {
      let final = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) this.onPartial(interim);
      if (final) this.onResult(final);
    };
    this._rec.onerror = (e) => {
      this.onError(new Error(e.error || 'speech error'));
      this._stopListening();
    };
    this._rec.onend = () => { this._stopListening(true); };
    this._rec.start();
  }

  stop() {
    if (!this.active) return;
    if (this.isNative() && this._plugin) {
      this._plugin.stop();
    } else if (this._rec) {
      this._rec.stop();
    }
    this._stopListening();
  }

  cancel() {
    if (!this.active) return;
    if (this.isNative() && this._plugin) {
      this._plugin.stop();
    } else if (this._rec) {
      this._rec.abort();
    }
    this._stopListening();
  }

  _stopListening(silent) {
    this.active = false;
    this._rec = null;
    if (this._plugin && !silent) {
      try { this._plugin.removeAllListeners(); } catch {}
    }
    this._plugin = null;
  }
}

// Text-to-speech — speaks the AI companion's reply.
// Uses Capacitor TextToSpeech when native, falls back to browser SpeechSynthesis.
export async function speak(text, { rate = 1.0, pitch = 1.0, lang = 'en-US' } = {}) {
  if (!text) return;
  const plugins = cap();
  if (plugins && plugins.TextToSpeech) {
    try {
      await plugins.TextToSpeech.speak({
        text,
        lang,
        rate,
        pitch,
        category: 'playback',
      });
      return;
    } catch (e) {
      // fall through to web
    }
  }
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = pitch;
  u.lang = lang;
  // prefer a female voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /female|samantha|google.*us english/i.test(v.name + v.voiceURI));
  if (preferred) u.voice = preferred;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  const plugins = cap();
  if (plugins && plugins.TextToSpeech) {
    plugins.TextToSpeech.stop().catch(() => {});
    return;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
