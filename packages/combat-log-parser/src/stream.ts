import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseLine } from './parser.js';
import { RunAggregator } from './aggregator.js';
import type { RunSummary } from './types.js';

export interface StreamOptions {
  /** Optional callback for progress reporting (bytes processed). */
  onProgress?: (linesProcessed: number) => void;
  /** Report cadence in lines. Default 10_000. */
  progressEvery?: number;
}

/**
 * Reads a WoWCombatLog.txt from disk, streaming line-by-line, and returns the
 * summary of the first completed Challenge Mode segment. Returns null if no
 * complete segment is found.
 */
export async function summarizeLogFile(
  filePath: string,
  options: StreamOptions = {},
): Promise<RunSummary | null> {
  const aggregator = new RunAggregator();
  const progressEvery = options.progressEvery ?? 10_000;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lines = 0;
  for await (const line of rl) {
    lines++;
    if (options.onProgress && lines % progressEvery === 0) {
      options.onProgress(lines);
    }
    if (!line) continue;

    const event = parseLine(line);
    if (event) aggregator.process(event);

    // Short-circuit: once we have a completed segment, we could stop.
    // For the prototype we keep reading so encounter counts stay accurate
    // (encounters inside the segment only arrive before CHALLENGE_MODE_END).
    if (aggregator.isComplete) {
      // Continue — but we've already seen the end; trailing events won't
      // contribute because the aggregator gates on (!started || ended).
    }
  }

  if (options.onProgress) options.onProgress(lines);
  return aggregator.finalize();
}

/**
 * Reads a WoWCombatLog.txt and returns summaries for EVERY completed
 * Challenge Mode segment in the file, in order. Useful for retroactive
 * enrichment when a user ran multiple keys into the same log.
 */
export async function summarizeAllSegmentsInLogFile(
  filePath: string,
  options: StreamOptions = {},
): Promise<RunSummary[]> {
  const segments: RunSummary[] = [];
  let aggregator = new RunAggregator();
  const progressEvery = options.progressEvery ?? 10_000;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lines = 0;
  for await (const line of rl) {
    lines++;
    if (options.onProgress && lines % progressEvery === 0) {
      options.onProgress(lines);
    }
    if (!line) continue;

    const event = parseLine(line);
    if (event) {
      aggregator.process(event);
      if (aggregator.isComplete) {
        const finalized = aggregator.finalize();
        if (finalized) segments.push(finalized);
        aggregator = new RunAggregator();
      }
    }
  }

  if (options.onProgress) options.onProgress(lines);
  return segments;
}
