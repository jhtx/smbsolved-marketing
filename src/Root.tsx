import React from 'react';
import { Composition } from 'remotion';
import './reel/fonts'; // loadFont() blocks render readiness until faces exist
import { ExcelReel, type ExcelReelProps } from './reel/ExcelReel';
import { reelSchema } from './reel/schema';
import { buildTimeline } from './reel/timeline';
import { VIDEO } from './reel/theme';

// Loaded so `npm run dev` has something on screen. render.ts overrides it.
import defaultReel from '../content/reels/001-vlookup-text-numbers.json';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ExcelReel"
    component={ExcelReel}
    width={VIDEO.width}
    height={VIDEO.height}
    fps={VIDEO.fps}
    durationInFrames={900}
    defaultProps={
      {
        reel: reelSchema.parse(defaultReel),
        timing: null,
        audioSrc: null,
        showSafeArea: false,
      } satisfies ExcelReelProps
    }
    calculateMetadata={({ props }) => {
      // Duration follows the voiceover. Never hardcode it.
      const { durationInFrames } = buildTimeline(props.reel.script, props.timing);
      return { durationInFrames };
    }}
  />
);
