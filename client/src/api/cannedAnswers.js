const cannedAnswers = [
    {
        keywords: ["what is gi bleeding", "gi bleeding", "gastrointestinal bleeding"],
        answer: "GI bleeding refers to bleeding anywhere along the gastrointestinal tract, from the esophagus and stomach down to the intestines. Common causes include peptic ulcers. This is a demo answer running locally in your browser.",
        sources: ["GI-Bleeding_Script.docx"],
    },
    {
        keywords: ["ppi", "proton pump inhibitor", "omeprazole"],
        answer: "Proton pump inhibitors such as omeprazole are commonly used after endoscopic treatment of a bleeding ulcer. High-dose intravenous omeprazole after successful endoscopic therapy reduces the risk of recurrent bleeding. This is a demo answer running locally in your browser.",
        sources: ["GI-Bleeding_Script.docx"],
    },
    {
        keywords: ["aspirin", "clopidogrel", "antiplatelet"],
        answer: "After recovering from a bleeding peptic ulcer, many patients still need aspirin for heart disease. Aspirin combined with a proton pump inhibitor caused fewer recurrent bleeds than clopidogrel alone — never stop or restart aspirin without consulting your doctor. This is a demo answer running locally in your browser.",
        sources: ["GI-Bleeding_Script.docx"],
    },
];
const fallbackAnswer = "I can only answer questions from the approved GI bleeding education material. In this local demo I couldn't match your question to a known topic — try asking about GI bleeding, proton pump inhibitors, or aspirin after a bleeding ulcer.";
export function findAnswer(question) {
    const normalized = question.toLowerCase();
    const match = cannedAnswers.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
    return match ?? { answer: fallbackAnswer };
}
export const demoTranscripts = [
    "What is GI bleeding?",
    "Why are proton pump inhibitors used after endoscopic treatment?",
    "When would aspirin be discussed after a bleeding ulcer?",
];
