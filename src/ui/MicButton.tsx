// Talk instead of typing: Chrome's speech recognition (laptop and Android), in Québec French or English.
// Chrome sends the audio to Google's speech service, so it needs an internet connection.

import { useEffect, useRef, useState } from 'react';
import { store, useStore } from './store';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
const RecognitionCtor: (new () => Recognition) | undefined =
  (globalThis as { SpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

export type VoiceLang = 'fr-CA' | 'en-CA';

const ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it for this site in Chrome (the icon left of the address).',
  'service-not-allowed': 'The microphone is blocked. Allow it for this site in Chrome (the icon left of the address).',
  'audio-capture': 'No microphone found.',
  network: 'Voice input needs an internet connection.',
  'language-not-supported': 'This language is not available for voice input here.',
};

/**
 * Mic button plus FR/EN switch (remembered). While you talk, onInterim gets the words so far;
 * when you stop, onText gets the final sentence.
 */
export function MicButton({ onText, onInterim }: { onText: (text: string) => void; onInterim?: (text: string) => void }) {
  const lang = useStore((s) => s.settings.voiceLang ?? 'fr-CA');
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.abort(), []);
  if (!RecognitionCtor) return null;

  const start = () => {
    const r = new RecognitionCtor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let final = '';
      let interim = '';
      for (const res of Array.from(e.results)) {
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (final.trim()) onText(final.trim());
      else if (interim.trim()) onInterim?.(interim.trim());
    };
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') store.toast(ERRORS[e.error] ?? `Voice input stopped (${e.error}).`, 'error');
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  const stop = () => rec.current?.abort();

  return (
    <span className="mic">
      <button
        type="button"
        className="btn mic-btn"
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Talk instead of typing'}
        title={listening ? 'Listening… tap to stop' : 'Talk instead of typing'}
        onClick={listening ? stop : start}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z" />
        </svg>
      </button>
      <button
        type="button"
        className="btn mic-lang"
        disabled={listening}
        title={lang === 'fr-CA' ? 'Talking in French (Québec): tap for English' : 'Talking in English: tap for French (Québec)'}
        onClick={() => store.updateSettings({ voiceLang: lang === 'fr-CA' ? 'en-CA' : 'fr-CA' })}
      >
        {lang === 'fr-CA' ? 'FR' : 'EN'}
      </button>
    </span>
  );
}
