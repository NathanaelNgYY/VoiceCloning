const BIG_BUCK_BUNNY_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const courses = [
    {
        slug: "gi-bleeding",
        title: "Gastrointestinal Bleeding 101",
        description: "Clinical overview of upper and lower GI bleeding, presentation, stabilization, and core management principles.",
        matchSummary: "Exact title match",
        videoUrl: BIG_BUCK_BUNNY_URL,
        topics: [
            { time: 0, label: "Introduction to GI Bleeding", thumbnailTime: 8 },
            { time: 90, label: "Upper vs. Lower GI Bleeding" },
            { time: 225, label: "Key Symptoms & Warning Signs", thumbnailTime: 232 },
            { time: 372, label: "Diagnostic Procedures" },
            { time: 530, label: "Active Treatments", thumbnailTime: 538 },
            { time: 675, label: "Recovery & Prevention Plan", thumbnailTime: 682 },
        ],
        transcriptSegments: [
            {
                time: 0,
                endTime: 90,
                title: "Introduction to GI Bleeding",
                text: "Gastrointestinal bleeding, or GI bleeding, is a symptom of a disorder in your digestive tract. The blood can originate in any part of the GI tract, from the mouth to the stomach, and down through the colon. In patient education, understanding the early indicators of a bleed is critical. It is essential to monitor for any gastrointestinal bleeding signs and report them immediately to clinical teams for prompt triage.",
            },
            {
                time: 90,
                endTime: 225,
                title: "Upper vs. Lower GI Bleeding",
                text: "Doctors divide GI bleeding into two categories: upper GI bleeding and lower GI bleeding. Upper GI bleeding occurs in the esophagus, stomach, or duodenum. It is most frequently caused by stomach ulcers, Mallory-Weiss tears, or esophageal varices. Lower GI bleeding originates in the small intestine, large intestine, rectum, or anus. Diverticulosis, hemorrhoids, and inflammatory bowel diseases are common culprits in the lower tract.",
            },
            {
                time: 225,
                endTime: 372,
                title: "Key Symptoms & Warning Signs",
                text: "The presentation of GI bleeding depends on the rate and location of blood loss. Bright red blood in your vomit or vomit that resembles coffee grounds suggests an upper GI source. Conversely, dark, tarry stools, or melena, are typical of bleeding that has occurred further up the tract. Bright red blood in the stool, or hematochezia, usually signifies a lower GI bleed. Watch out for signs of shock: lightheadedness, cold sweat, rapid pulse, or shortness of breath.",
            },
            {
                time: 372,
                endTime: 530,
                title: "Diagnostic Procedures",
                text: "Diagnosing GI bleeding requires visual inspection. An upper endoscopy, or EGD, is the primary method used to locate, evaluate, and treat upper GI bleeding. For lower GI tract evaluation, a colonoscopy is performed. These diagnostic procedures allow clinicians to directly view active bleeding and apply immediate treatment when needed.",
            },
            {
                time: 530,
                endTime: 675,
                title: "Active Treatments",
                text: "During an endoscopy or colonoscopy, the doctor can actively stop a bleed. They can inject medications directly into the tissue, cauterize the bleeding site with heat, or deploy mechanical devices such as bands or small metal clips to close blood vessels. If severe bleeding cannot be controlled endoscopically, surgical or interventional radiology treatment may be necessary.",
            },
            {
                time: 675,
                endTime: 9999,
                title: "Recovery & Prevention Plan",
                text: "Recovering from a GI bleed starts with resting the digestive system and treating the underlying cause. Clinical teams may use acid-reducing medications such as proton pump inhibitors to promote healing. Lifestyle adjustments, including avoiding alcohol, NSAIDs, and aspirin when inappropriate, are often advised. Follow-up care helps monitor healing and reduce the risk of recurrence.",
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

export function getMockCourseBySlug(slug) {
    return courses.find((course) => course.slug === slug) ?? null;
}
