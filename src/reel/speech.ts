/**
 * How narration is actually spoken.
 *
 * The writer writes `vo` naturally ("SUMIFS across the amounts"); this lexicon
 * rewrites it for the TTS model ("sum ifs across the amounts"), because
 * ElevenLabs reads unknown all-caps tokens as words ("SOOMIF").
 *
 * CRITICAL: timeline.ts slices the character-level alignment by the SPOKEN
 * text's character counts, so `speakable()` must be applied identically in
 * voice.ts (building the request text) and timeline.ts (slicing). Change the
 * lexicon and every cached *.timing.json still matches its own mp3 — but a
 * re-voiced reel gets the new pronunciation. Captions are untouched: they
 * render `caption ?? vo` with the real spelling.
 */

const LEXICON: [RegExp, string][] = [
  // error values — the writer writes them as Excel shows them
  [/#N\/A/g, 'N A'], // owner's call 2026-08-23: "N A", not "N slash A"
  [/#VALUE!/g, 'value error'],
  [/#REF!/g, 'ref error'],
  [/#NAME\?/g, 'name error'],
  [/#DIV\/0!/g, 'divide by zero error'],
  [/#SPILL!/g, 'spill error'],
  // lookups & matches
  [/\bVLOOKUP\b/g, 'V lookup'],
  [/\bXLOOKUP\b/g, 'X lookup'],
  [/\bHLOOKUP\b/g, 'H lookup'],
  [/\bXMATCH\b/g, 'X match'],
  // conditional aggregation
  [/\bSUMIFS\b/g, 'sum ifs'],
  [/\bSUMIF\b/g, 'sum if'],
  [/\bCOUNTIFS\b/g, 'count ifs'],
  [/\bCOUNTIF\b/g, 'count if'],
  [/\bAVERAGEIFS\b/g, 'average ifs'],
  [/\bAVERAGEIF\b/g, 'average if'],
  [/\bSUMPRODUCT\b/g, 'sum product'],
  [/\bSUBTOTAL\b/g, 'sub total'],
  // text & dates
  [/\bDATEVALUE\b/g, 'date value'],
  [/\bTIMEVALUE\b/g, 'time value'],
  [/\bTEXTSPLIT\b/g, 'text split'],
  [/\bTEXTJOIN\b/g, 'text join'],
  [/\bTEXTBEFORE\b/g, 'text before'],
  [/\bTEXTAFTER\b/g, 'text after'],
  [/\bEOMONTH\b/g, 'E O month'],
  [/\bNETWORKDAYS\b/g, 'network days'],
  [/\bIFERROR\b/g, 'if error'],
  [/\bIFNA\b/g, 'if N A'],
  // depreciation & finance
  [/\bMACRS\b/g, 'makers'],
  [/\bSLN\b/g, 'S L N'],
  [/\bDDB\b/g, 'D D B'],
  [/\bVDB\b/g, 'V D B'],
  [/\bSYD\b/g, 'S Y D'],
  [/\bNPV\b/g, 'N P V'],
  [/\bIRR\b/g, 'I R R'],
  [/\bPMT\b/g, 'P M T'],
  // accounting shorthand
  [/\bGL\b/g, 'G L'],
  [/\bTB\b/g, 'T B'],
  [/\bAP\b/g, 'A P'],
  [/\bAR\b/g, 'A R'],
  [/\bQBO\b/g, 'Q B O'],
  [/\bQBD\b/g, 'Q B D'],
  [/\bCSV\b/g, 'C S V'],
];

/** The text as it should be sent to (and heard from) the TTS model. */
export function speakable(vo: string): string {
  let s = vo;
  for (const [re, to] of LEXICON) s = s.replace(re, to);
  return s;
}
