/**
 * Generates the voiceover and, critically, the character-level alignment that
 * drives every animation beat. Use the with-timestamps endpoint, never plain
 * TTS — the timestamps are the reason we never hand-time anything.
 *
 * Endpoint and model names move. If this 404s, check the current docs at
 * elevenlabs.io/docs before assuming the key is wrong.
 */
import './env';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { reelSchema } from '../src/reel/schema';
import { speakable } from '../src/reel/speech';
import type { Timing } from '../src/reel/timeline';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';

export async function generateVoice(reelPath: string): Promise<{
  audioSrc: string;
  timing: Timing;
}> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set');

  const reel = reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8')));

  // One request for the whole script. Splitting per line would drift the
  // prosody between beats and give us no gap timing.
  // speakable() rewrites function names for the model ("SUMIFS" → "sum ifs");
  // timeline.ts slices the alignment by the same speakable text, so the two
  // must never diverge.
  const text = reel.script.map((l) => speakable(l.vo.trim())).join(' ');

  const res = await fetch(`${API}/${voice}/with-timestamps`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      // turbo_v2_5 is deprecated; multilingual_v2 is the stable, default
      // model for /with-timestamps. Never flash_v2_5 here — it does not
      // normalise numbers by default and we narrate account codes.
      model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
      // Best-effort determinism so a regenerated line sounds like the rest.
      seed: Number(process.env.ELEVENLABS_SEED ?? 4242),
      voice_settings: {
        // Steady over expressive. Consistency across the channel matters more
        // than any single read. Pinned: changing these changes the voice.
        stability: 0.55,
        similarity_boost: 0.8,
        style: 0,
        use_speaker_boost: true,
        speed: 1.0,
      },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    audio_base64: string;
    alignment: Timing;
    normalized_alignment?: Timing;
  };

  const stem = basename(reelPath).replace(/\.json$/, '');
  const audioSrc = `audio/${stem}.mp3`;

  writeFileSync(`public/${audioSrc}`, Buffer.from(data.audio_base64, 'base64'));

  // `alignment` is keyed to the ORIGINAL input text; `normalized_alignment` is
  // keyed to ElevenLabs' expanded text ("1042" -> "one thousand forty-two"),
  // which has a different character count. timeline.ts slices the stream by
  // the input text's non-whitespace character count, so it must be `alignment`
  // — otherwise every beat after the first expanded token drifts.
  // (Scripts are already written phonetically, so there is nothing to gain
  // from the normalized stream anyway.)
  const timing = data.alignment;
  writeFileSync(`content/reels/${stem}.timing.json`, JSON.stringify(timing));

  return { audioSrc, timing };
}

// CLI: npx tsx pipeline/voice.ts content/reels/001-*.json
if (process.argv[1]?.endsWith('voice.ts')) {
  generateVoice(process.argv[2])
    .then(({ audioSrc }) => console.log(`wrote public/${audioSrc}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
