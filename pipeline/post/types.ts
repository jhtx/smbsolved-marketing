/** Shared shape of a platform poster. Kept separate so the registry in
 * index.ts and the platform modules do not import each other in a circle. */
import type { Reel } from '../../src/reel/schema';
import type { Platform, PostResult } from '../delivery';

export type PostInput = {
  reel: Reel;
  mp4: string;
  stills: string[];
  /**
   * A public HTTPS URL for the MP4. Lazy and memoised by the caller: only
   * Instagram needs one, so nothing is uploaded anywhere unless it posts.
   */
  publicUrl: () => Promise<string>;
};

export type Poster = {
  name: Platform;
  /** env vars that must be set before this platform can post */
  needs: string[];
  post: (input: PostInput) => Promise<PostResult>;
};

const tags = (reel: Reel) =>
  (reel.post?.hashtags ?? []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');

/** Title for platforms that have one. */
export const postTitle = (reel: Reel) => reel.post?.title ?? reel.title;

/** Body copy: the search phrase first, then the explanation, then the tags. */
export const postBody = (reel: Reel) => [reel.post?.description ?? reel.title, '', tags(reel)].join('\n').trim();

export const now = () => new Date().toISOString();
