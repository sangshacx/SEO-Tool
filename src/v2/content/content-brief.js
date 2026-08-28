export const CONTENT_BRIEF_VERSION = "content-brief-v0.1";

const INTENT_PROFILES = {
  transactional: {
    pageType: "Product / Landing Page",
    funnel: "Bottom",
    titleSuffix: "Applications, Specifications & Supplier Guide",
    cta: "Request a technical quote and product recommendation.",
    angle: "Lead with application fit, measurable performance, proof, and a clear enquiry path.",
  },
  commercial: {
    pageType: "Comparison / Buyer Guide",
    funnel: "Middle",
    titleSuffix: "Types, Performance, Cost & Selection Guide",
    cta: "Compare suitable systems and request samples or pricing.",
    angle: "Help technical buyers compare options, trade-offs, standards, and total installed value.",
  },
  navigational: {
    pageType: "Reference / Solution Page",
    funnel: "Middle",
    titleSuffix: "Solutions, Technical Data & Resources",
    cta: "View technical resources or contact a waterproofing specialist.",
    angle: "Make the expected destination obvious and provide fast paths to specifications and support.",
  },
  informational: {
    pageType: "Topic Guide",
    funnel: "Top / Middle",
    titleSuffix: "Uses, Types, Benefits & Best Practices",
    cta: "Download the specification guide or discuss the right system for your project.",
    angle: "Answer the core question first, then guide readers from education to product evaluation.",
  },
};

function titleCase(value) {
  return value
    .split(/\s+/)
    .map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function metaDescription(keyword, intent) {
  const lead = intent === "transactional" ? "Explore specifications, applications and selection criteria for" : "Learn how to evaluate";
  return `${lead} ${keyword}. Compare options, performance factors and practical guidance for waterproofing projects.`.slice(0, 155);
}

function outlineFor(keyword, intent) {
  if (intent === "transactional") {
    return [
      ["Product overview", `Define ${keyword}, the problem it solves, and the ideal project profile.`],
      ["Applications and substrates", "Cover compatible substrates, environments, and common use cases."],
      ["Key performance specifications", "Present measurable properties, standards, certifications, and limitations."],
      ["System components and options", "Explain primers, membranes, accessories, packaging, and available variants."],
      ["Installation and quality control", "Summarize preparation, application steps, curing, inspection, and maintenance."],
      ["Proof and next step", "Add project evidence, FAQs, technical downloads, and a prominent quotation CTA."],
    ];
  }

  return [
    [`What is ${keyword}?`, "Give a direct definition, primary use cases, and the problem this topic solves."],
    ["Main types and material options", "Compare the common systems, formats, and where each option fits."],
    ["Benefits and limitations", "Explain performance advantages, constraints, and realistic expectations."],
    ["Selection criteria", "Cover substrate, exposure, movement, climate, compliance, lifecycle, and budget."],
    ["Application and installation", "Outline preparation, installation stages, quality control, and common mistakes."],
    ["Cost, maintenance, and next steps", "Address cost drivers, service life, maintenance, FAQs, and the conversion CTA."],
  ];
}

function faqFor(keyword) {
  return [
    `What is ${keyword} used for?`,
    `How do you choose the right ${keyword} system?`,
    `How long does ${keyword} last?`,
    `What affects ${keyword} cost?`,
    `What installation mistakes should be avoided?`,
  ];
}

export function generateContentBrief(input) {
  const keyword = input.keyword.trim().replace(/\s+/g, " ");
  const intent = INTENT_PROFILES[input.intent] ? input.intent : "informational";
  const profile = INTENT_PROFILES[intent];
  const subject = titleCase(keyword);
  const pageType = input.page_type || profile.pageType;
  const funnel = input.funnel || profile.funnel;
  const workingTitle = `${subject}: ${profile.titleSuffix}`;

  return {
    version: CONTENT_BRIEF_VERSION,
    target_keyword: keyword,
    slug: slugify(keyword),
    search_intent: intent,
    page_type: pageType,
    funnel_stage: funnel,
    priority_score: Number.isFinite(input.priority) ? Math.round(input.priority) : null,
    content_angle: input.angle || profile.angle,
    working_title: workingTitle,
    title_options: [
      workingTitle,
      `How to Choose ${subject} for Long-Term Performance`,
      `${subject}: Technical Guide for Specifiers and Buyers`,
    ],
    meta_title: workingTitle.slice(0, 60),
    meta_description: metaDescription(keyword, intent),
    primary_cta: profile.cta,
    outline: outlineFor(keyword, intent).map(([heading, goal], index) => ({ order: index + 1, heading, goal })),
    faq_questions: faqFor(keyword),
    internal_link_ideas: ["Waterproofing systems overview", "Application guide", "Technical data sheets", "Project case studies"],
    source: input.source || "content-plan",
    competitor_reference_url: input.competitor_url || null,
    generated_at: new Date().toISOString(),
  };
}
