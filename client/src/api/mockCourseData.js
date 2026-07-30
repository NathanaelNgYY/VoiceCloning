// Per-word start/end times so the transcript can reveal itself in step with
// playback instead of sitting there as finished paragraphs.
//
// Produced once, offline, from the lesson audio (OpenAI whisper-1 with
// timestamp_granularities:["word"] — the only model that returns word-level
// timings). The WORDING stays the curated transcript below; only the timings
// come from ASR, because raw ASR drops punctuation and mangles exactly the
// terms this lesson turns on ("melena", "ligament of Treitz"). 96% of curated
// words matched an ASR word directly; the rest are interpolated from their
// neighbours so every word has a monotonic timing and the reveal never stalls.
//
// Each entry is [word, startSeconds, endSeconds]; segments are keyed by `time`.
// Regenerate only if the video changes — see docs/lesson-transcript-timings.md.
import GI_BLEEDING_WORD_TIMINGS from "./giBleedingWordTimings.json";

// Served same-origin so the player and the Content Outline thumbnails work
// without CORS — both set crossOrigin="anonymous", and the thumbnail hook reads
// pixels back off a canvas, which a cross-origin source would taint.
//
// In production CloudFront maps /videos/* to s3://interns2026-small-projects-
// bucket-shared/gi-bleeding/videos/. Locally, vite.config.js proxies /videos to
// the same distribution. Deliberately NOT under the app's deploy prefix — both
// deploy scripts run `s3 sync --delete` there and would wipe it each deploy.
const GI_BLEEDING_VIDEO_URL = "/videos/gi-bleeding.mp4";

const courses = [
    {
        slug: "gi-bleeding",
        title: "Gastrointestinal Bleeding 101",
        description: "Clinical overview of upper and lower GI bleeding, presentation, stabilization, and core management principles.",
        matchSummary: "Exact title match",
        videoUrl: GI_BLEEDING_VIDEO_URL,
        topics: [
            { time: 0, label: "Introduction & Overview", thumbnailTime: 6 },
            { time: 65.14, label: "Presentation & Epidemiology", thumbnailTime: 71.14 },
            { time: 136.92, label: "Initial Assessment & Stabilization", thumbnailTime: 142.92 },
            { time: 187.5, label: "Upper GI Bleeding: Causes", thumbnailTime: 193.5 },
            { time: 279.64, label: "Upper GI Bleeding: Management", thumbnailTime: 285.64 },
            { time: 355.51, label: "Endoscopy: Timing & Therapy", thumbnailTime: 361.51 },
            { time: 505.88, label: "Lower GI Bleeding", thumbnailTime: 511.88 },
            { time: 624.42, label: "Key Messages", thumbnailTime: 630.42 },
        ],
        transcriptSegments: [
            {
                time: 0,
                endTime: 23.45,
                title: "Introduction",
                text: "Good morning everyone. Today we will discuss gastrointestinal bleeding, an important and common clinical emergency encountered in medical practice. We will cover the basic concepts, clinical presentation, and management principles of both upper and lower gastrointestinal bleeding.",
            },
            {
                time: 23.45,
                endTime: 65.14,
                title: "Defining Upper vs. Lower GI Bleeding",
                text: "Gastrointestinal bleeding refers to bleeding originating anywhere along the gastrointestinal tract. Clinically, we divide GI bleeding anatomically into upper GI bleeding and lower GI bleeding. Upper GI bleeding occurs proximal to the ligament of Treitz involving the esophagus, stomach or duodenum. The ligament of Treitz is a suspensory muscle of the duodenum, a thin band of muscle and tissue that anchors the junction of the duodenum and jejunum. Lower GI bleeding occurs distal to the ligament of Treitz and usually arises from the small intestine, colon or rectum.",
            },
            {
                time: 65.14,
                endTime: 108.02,
                title: "How Patients Present",
                text: "Patients with GI bleeding may present in different ways, depending on the site and severity of bleeding. Hematemesis refers to vomiting fresh blood, while coffee ground vomiting represents altered blood exposed to gastric acid. It occurs predominantly from upper GI source of bleeding. Melena describes black tarry stool, also usually indicating an upper GI source. Hematochezia refers to fresh blood per rectum and usually suggests lower GI bleeding, although massive upper GI bleeding can occasionally present this way. Significant blood loss may lead to dizziness, tachycardia, hypotension, pallor or even syncope.",
            },
            {
                time: 108.02,
                endTime: 136.92,
                title: "Epidemiology & Changing Patterns",
                text: "Upper GI bleeding is generally more common than lower GI bleeding worldwide. Mortality remains significant, particularly among elderly patients and those with multiple comorbidities. However, the incidence and pattern of GI bleeding is changing because of aging populations, reducing use of NSAIDs and increasing use of COX-2 inhibitors, and widespread use of different antiplatelet agents and anticoagulants.",
            },
            {
                time: 136.92,
                endTime: 163.66,
                title: "Initial Stabilization",
                text: "When we encounter a patient with acute GI bleeding, the first priority is stabilization. We always begin with the ABC approach, airway, breathing and circulation. Patients may require large bore intravenous access, fluid resuscitation and sometimes blood transfusion. Monitoring vital signs and urine output is essential to assess hemodynamic stability.",
            },
            {
                time: 163.66,
                endTime: 187.5,
                title: "Investigations & Risk Stratification",
                text: "Initial blood investigations include full blood count, renal function, coagulation profile, liver function tests and group and crossmatch. Risk stratification tools such as the Glasgow-Blatchford score help determine severity and guide management decisions. Early endoscopy, after stabilization, plays a central role in diagnosis and therapy.",
            },
            {
                time: 187.5,
                endTime: 212.58,
                title: "Upper GI Bleeding: Overview",
                text: "We will now focus on upper gastrointestinal bleeding, which is the more common form of GI bleeding encountered in clinical practice. Upper GI bleeding refers to bleeding proximal to the ligament of Treitz. Common sources include the esophagus, stomach and duodenum. The presentation can range from mild occult bleeding to massive life-threatening hemorrhage.",
            },
            {
                time: 212.58,
                endTime: 279.64,
                title: "Causes of Upper GI Bleeding",
                text: "The most common cause of upper GI bleeding is peptic ulcer disease, including both gastric and duodenal ulcers. Important risk factors include Helicobacter pylori infection, NSAID use and antiplatelet or anticoagulant therapy. The following articles provide further evidence and discussion regarding the risk factors and management of peptic ulcer disease. Students interested in learning more may refer to these sources. Another important cause of upper GI bleeding is esophageal varices, which develop due to portal hypertension commonly in patients with liver cirrhosis. Other causes include gastritis and erosions, often related to NSAID use. Mallory-Weiss tears occur at the gastroesophageal junction, usually after forceful vomiting or retching. Malignancies such as gastric cancer and esophageal cancer may also present with bleeding, particularly in older patients or those with alarm symptoms.",
            },
            {
                time: 279.64,
                endTime: 301.78,
                title: "Presentation of Upper GI Bleeding",
                text: "The classic presentations of upper GI bleeding are hematemesis and melena. Massive upper GI bleeding can also present with hematochezia if intestinal transit is rapid. In patients with variceal bleeding, we may observe signs of chronic liver disease, such as jaundice, ascites, spider naevi or splenomegaly.",
            },
            {
                time: 301.78,
                endTime: 355.51,
                title: "Management of Upper GI Bleeding",
                text: "Management begins with resuscitation and stabilization. Blood transfusion is usually given using a restrictive strategy unless patients are at particularly high cardiovascular risk. Pharmacologic therapy includes intravenous proton pump inhibitors for suspected peptic ulcer bleeding. In suspected variceal bleeding, vasoactive agents such as terlipressin or octreotide are administered, together with intravenous antibiotics to reduce infectious complications. A study published in the New England Journal of Medicine found that patients with bleeding peptic ulcers who received intravenous omeprazole after successful endoscopic treatment had a significantly lower risk of recurrent bleeding. Therefore, IV proton pump inhibitors play an important role in the management of peptic ulcer bleeding.",
            },
            {
                time: 355.51,
                endTime: 399.94,
                title: "Timing of Endoscopy: The Evidence",
                text: "Endoscopy should generally be performed within 24 hours and earlier in unstable patients. A study published in the New England Journal of Medicine compared endoscopy performed within six hours with endoscopy performed between six and 24 hours in patients with acute upper gastrointestinal bleeding. The study found that earlier endoscopy did not reduce 30-day mortality compared with endoscopy performed within 24 hours. Therefore, current practice recommends endoscopic therapy within 24 hours after stabilization, while unstable patients may require more urgent endoscopy.",
            },
            {
                time: 399.94,
                endTime: 467.12,
                title: "Endoscopic Hemostatic Therapy",
                text: "Endoscopic treatment options include injection therapy, thermal coagulation, hemostatic clips and topical hemostatic powders. Variceal bleeding is treated with endoscopic band ligation. The study evaluated a hemostatic powder used during endoscopy to control active peptic ulcer bleeding. According to the study, the powder is a topical mineral agent delivered through a catheter via an endoscope. As shown in panel A, an actively bleeding peptic ulcer is identified during endoscopy. In panels B and C, the hemostatic powder is sprayed directly onto the bleeding site, where it adheres to the tissue and forms a protective mechanical barrier. Finally, Panel D demonstrates successful hemostasis with the ulcer covered by powder and the bleeding controlled. The study reported that immediate hemostasis was achieved in 90.9% of patients, demonstrating the effectiveness of hemostatic powder therapy for active peptic ulcer bleeding.",
            },
            {
                time: 467.12,
                endTime: 505.88,
                title: "Treating the Underlying Cause",
                text: "After stopping the bleeding, we must address the underlying cause. Patients should be tested for Helicobacter pylori and treated if positive. NSAIDs should be discontinued whenever possible. Secondary prevention strategies include long-term PPI therapy and surveillance for recurrent varices. A key teaching point from landmark studies is that acid suppression stabilizes clots and reduces recurrent bleeding. Similarly, eradication of Helicobacter pylori dramatically reduces ulcer recurrence in future bleeding episodes.",
            },
            {
                time: 505.88,
                endTime: 520.12,
                title: "Lower GI Bleeding: Overview",
                text: "We will now move on to lower gastrointestinal bleeding. Lower GI bleeding refers to bleeding distal to the ligament of Treitz and most commonly originates from the colon.",
            },
            {
                time: 520.12,
                endTime: 572.23,
                title: "Causes of Lower GI Bleeding",
                text: "One of the most common causes in elderly patients is diverticular disease, which often causes painless but large volume bleeding. Hemorrhoids typically present with fresh blood coating the stool and are usually mild. Colorectal cancer is another important cause and may present with occult bleeding, anemia, weight loss or altered bowel habits. Angiodysplasia refers to vascular malformations that commonly occur in older adults. Inflammatory bowel disease, including ulcerative colitis and Crohn's disease, may present with bloody diarrhea and abdominal pain. Infectious colitis should also be considered, especially in patients with fever, diarrhea or relevant travel and food exposure history.",
            },
            {
                time: 572.23,
                endTime: 588.74,
                title: "Presentation of Lower GI Bleeding",
                text: "Lower GI bleeding most commonly presents with hematochezia or maroon-colored stools. Melena may occur with right-sided colonic bleeding. Unlike upper GI bleeding, hematemesis is usually absent.",
            },
            {
                time: 588.74,
                endTime: 624.42,
                title: "Management of Lower GI Bleeding",
                text: "The initial stabilization principles are the same as in upper GI bleeding. Once the patient is stable, colonoscopy is usually the main diagnostic investigation. CT angiography may help localize active bleeding. If the source remains uncertain, upper endoscopy may still be necessary. Therapeutic options include endoscopic clipping, injection therapy and coagulation. Interventional radiology techniques such as angioembolization are increasingly important for ongoing bleeding. Surgery is reserved for severe uncontrolled hemorrhage.",
            },
            {
                time: 624.42,
                endTime: 673.04,
                title: "Key Messages",
                text: "The key messages are always stabilize the patient first before focusing on diagnosis or rushing to endoscopy. Upper GI bleeding is more common and peptic ulcer disease remains a common cause. Variceal bleeding requires urgent therapy. Lower GI bleeding is commonly caused by diverticular disease and colorectal pathology. Endoscopy is central to both diagnosis and treatment. Finally, elderly patients and those receiving anticoagulants are at particularly high risk of severe bleeding and adverse outcomes. Thank you very much for your attention.",
            },
        ],
    },
];

function normalize(value) {
    return value.trim().toLowerCase();
}

export function searchMockCourses(query) {
    const normalizedQuery = normalize(query);
    return courses
        .filter((course) => {
            const haystack = normalize(`${course.title} ${course.description} ${course.slug}`);
            return haystack.includes(normalizedQuery);
        })
        .map(({ slug, title, description, matchSummary }) => ({
            slug,
            title,
            description,
            matchSummary,
        }));
}

// Join the timings onto the curated segments by start time. Kept out of the
// literal above so the transcript stays readable — 1290 inline word tuples
// would bury it. A segment with no timings simply renders as plain text, which
// is what happens to any lesson that has not been through the offline pass.
const WORD_TIMINGS_BY_SLUG = {
    "gi-bleeding": GI_BLEEDING_WORD_TIMINGS,
};

function withWordTimings(course) {
    const timings = WORD_TIMINGS_BY_SLUG[course.slug];
    if (!timings) return course;

    const byTime = new Map(timings.map((entry) => [entry.time, entry.words]));
    return {
        ...course,
        transcriptSegments: course.transcriptSegments.map((segment) => {
            const words = byTime.get(segment.time);
            if (!words) return segment;
            return {
                ...segment,
                words: words.map(([text, start, end]) => ({ text, start, end })),
            };
        }),
    };
}

export function getMockCourseBySlug(slug) {
    const course = courses.find((item) => item.slug === slug) ?? null;
    return course ? withWordTimings(course) : null;
}
