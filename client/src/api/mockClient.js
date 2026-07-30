import { demoTranscripts, findAnswer } from "./cannedAnswers";
import { getMockCourseBySlug, searchMockCourses } from "./mockCourseData";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export const mockClient = {
    async chat(req) {
        await sleep(900);
        return findAnswer(req.message);
    },
    async getCourse(req) {
        await sleep(300);
        const course = getMockCourseBySlug(req.slug);
        if (!course) {
            throw new Error("Course was not found.");
        }
        return course;
    },
    async searchCourses(req) {
        await sleep(250);
        return {
            results: searchMockCourses(req.query),
        };
    },
    async transcribe() {
        await sleep(1200);
        const transcript = demoTranscripts[Math.floor(Math.random() * demoTranscripts.length)];
        return { transcript };
    },
    async avatarSession() {
        await sleep(200);
        return { sessionId: `demo-${Math.random().toString(36).slice(2, 10)}` };
    },
    async avatarSpeak(req) {
        // ~55ms per character approximates speech duration for the demo
        const durationMs = Math.min(8000, Math.max(1500, req.text.length * 55));
        await sleep(durationMs);
        return { ok: true, durationMs };
    },
    async voiceOptions() {
        await sleep(120);
        return {
            defaultVoiceId: "demo-voice-1",
            voices: [
                { id: "demo-voice-1", label: "Demo Voice One" },
                { id: "demo-voice-2", label: "Demo Voice Two" },
            ],
        };
    },
    async ttsSession(req) {
        await sleep(120);
        return {
            voiceId: req.voiceId,
            websocketUrl: "wss://example.invalid/demo-tts",
            modelId: "demo-tts-model",
            outputFormat: "mp3_44100_128",
            voiceSettings: {
                stability: 0.45,
                similarityBoost: 0.8,
                style: 0,
                useSpeakerBoost: true,
                speed: 1,
            },
            generationConfig: {
                chunkLengthSchedule: [120, 160, 250, 290],
            },
        };
    },
    async realtimeSession() {
        await sleep(150);
        return {
            sessionId: `demo-rt-${Math.random().toString(36).slice(2, 10)}`,
            clientSecret: "demo-client-secret",
            expiresAt: Math.floor(Date.now() / 1000) + 60,
            model: "demo-realtime",
            voice: "demo",
        };
    },
};
