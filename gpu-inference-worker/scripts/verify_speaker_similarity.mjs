import fs from 'node:fs';
import { speakerSimilarity } from '../src/services/speakerSimilarity.js';

const [referencePath, takePath = referencePath] = process.argv.slice(2);
if (!referencePath) {
  console.error('Usage: node scripts/verify_speaker_similarity.mjs <reference.wav> [take.wav]');
  process.exit(2);
}

const result = await speakerSimilarity.scoreChunk(referencePath, fs.readFileSync(takePath));
if (!result || !Number.isFinite(result.similarity)) {
  console.error('Speaker similarity scoring unavailable');
  process.exit(1);
}

console.log(JSON.stringify(result));
process.exit(0);
