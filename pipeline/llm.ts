/**
 * The one place the pipeline talks to a model.
 *
 * Two callers only: script.ts (writer) and review.ts (reviewer). Both ask for
 * structured JSON against a zod schema, so there is no prose to parse and a
 * malformed answer fails loudly instead of rendering.
 */
import './env';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';

export const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

/** $ per million tokens, for the cost line in logs. Opus 5 list price. */
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-fable-5': { in: 10, out: 50 },
};

export const client = new Anthropic();

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

export async function askForJson<T>(opts: {
  label: string;
  /** stable text; cached across calls in the same loop */
  system: string;
  messages: Anthropic.MessageParam[];
  schema: ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ output: T; costUsd: number; usage: Anthropic.Usage }> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: opts.messages,
    output_config: {
      effort: opts.effort ?? 'high',
      format: zodOutputFormat(opts.schema),
    },
  });

  if (res.stop_reason === 'refusal') {
    throw new Error(`${opts.label}: model refused (${res.stop_details?.category ?? 'no category'})`);
  }
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`${opts.label}: hit max_tokens; raise maxTokens`);
  }
  if (!res.parsed_output) {
    throw new Error(`${opts.label}: response did not match the schema`);
  }

  const p = PRICE[MODEL] ?? PRICE['claude-opus-5'];
  const u = res.usage;
  const costUsd =
    (u.input_tokens * p.in +
      (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 +
      (u.cache_read_input_tokens ?? 0) * p.in * 0.1 +
      u.output_tokens * p.out) /
    1e6;

  console.log(
    `  ${opts.label}: ${u.input_tokens} in` +
      (u.cache_read_input_tokens ? ` (+${u.cache_read_input_tokens} cached)` : '') +
      ` / ${u.output_tokens} out · $${costUsd.toFixed(3)}`,
  );

  return { output: res.parsed_output as T, costUsd, usage: u };
}
