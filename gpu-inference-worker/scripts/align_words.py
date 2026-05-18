import sys
import json


def main():
    if len(sys.argv) < 2:
        print("Usage: align_words.py <wav_path> [model_size]", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "tiny"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _ = model.transcribe(wav_path, word_timestamps=True)

    words = []
    for segment in segments:
        for word in (segment.words or []):
            words.append({
                "word": word.word.strip(),
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
            })

    print(json.dumps(words))


if __name__ == "__main__":
    main()
