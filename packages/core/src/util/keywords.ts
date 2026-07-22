import type { Kind } from "../types/item";

/**
 * Deterministic keyword dictionaries — MVP enrichment.
 * These are deliberately small seed lists; growing them is a data change,
 * not a code change. LLM enrichment is a later provider swap.
 */

/** tag -> patterns that imply it (matched case-insensitively on title+body). */
export const TOPIC_KEYWORDS: Record<string, RegExp[]> = {
  llm: [/\bllms?\b/i, /large language model/i],
  agents: [/\bagents?\b/i, /agentic/i],
  "image-gen": [/diffusion/i, /text-to-image/i, /image generation/i],
  video: [/text-to-video/i, /video generation/i, /\bsora\b/i],
  "open-source": [/open[- ]source/i, /open[- ]weights?/i, /\bapache[- ]2\b/i, /\bmit license\b/i],
  "product-launch": [/\blaunch(es|ed)?\b/i, /\brelease[sd]?\b/i, /now available/i, /\bv\d+(\.\d+)+\b/i],
  research: [/\bpaper\b/i, /arxiv/i, /\bbenchmarks?\b/i, /state[- ]of[- ]the[- ]art/i],
  prompting: [/\bprompts?\b/i, /prompt engineering/i],
  "fine-tuning": [/fine[- ]tun/i, /\blora\b/i, /\bqlora\b/i],
  "local-inference": [/\bollama\b/i, /llama\.cpp/i, /\bggufs?\b/i, /on[- ]device/i, /local(ly)? run/i],
  coding: [/\bcoding\b/i, /code generation/i, /copilot/i, /\bide\b/i],
  robotics: [/\brobots?\b/i, /robotics/i, /humanoid/i],
};

/** canonical entity -> alias patterns. Kept tiny on purpose; grows with use. */
export const ENTITY_KEYWORDS: Record<string, RegExp[]> = {
  OpenAI: [/\bopenai\b/i, /\bgpt-?\d/i, /\bchatgpt\b/i, /\bsora\b/i],
  Anthropic: [/\banthropic\b/i, /\bclaude\b/i],
  Google: [/\bgoogle\b/i, /\bdeepmind\b/i, /\bgemini\b/i, /\bgemma\b/i],
  Meta: [/\bmeta ai\b/i, /\bllama[- ]?\d/i],
  Mistral: [/\bmistral\b/i, /\bmixtral\b/i],
  DeepSeek: [/\bdeepseek\b/i],
  Qwen: [/\bqwen\b/i],
  xAI: [/\bxai\b/i, /\bgrok\b/i],
  "Hugging Face": [/hugging ?face\b/i],
  Microsoft: [/\bmicrosoft\b/i, /\bcopilot\b/i, /\bphi-?\d/i],
  NVIDIA: [/\bnvidia\b/i, /\bcuda\b/i],
  Perplexity: [/\bperplexity\b/i],
  "Stability AI": [/\bstability ai\b/i, /stable diffusion/i],
  Ollama: [/\bollama\b/i],
  ComfyUI: [/\bcomfyui\b/i],
};

/**
 * Kind classification rules, checked in order — first match wins.
 * The source's default_kind_hint is a PRIOR; these rules refine it.
 */
export const KIND_RULES: Array<{ kind: Kind; patterns: RegExp[] }> = [
  {
    kind: "tip",
    patterns: [/\bhow to\b/i, /\btips?\b/i, /\btricks?\b/i, /\bguide\b/i, /\btutorial\b/i, /\bworkflow\b/i, /\bprompt(s| engineering)?\b/i],
  },
  {
    kind: "research",
    patterns: [/\bpaper\b/i, /arxiv/i, /\bstudy\b/i, /\bbenchmarks?\b/i, /we (propose|introduce|present)\b/i],
  },
  {
    kind: "launch",
    patterns: [/\blaunch(es|ed)?\b/i, /\brelease[sd]?\b/i, /\bintroducing\b/i, /\bannounc(es|ed|ing)\b/i, /now available/i, /\bv\d+(\.\d+)+\b/i, /\bunveil(s|ed)?\b/i],
  },
  {
    kind: "opinion",
    patterns: [/\bwhy i\b/i, /\bhot take\b/i, /\bopinion\b/i, /\bthoughts on\b/i, /\bunpopular\b/i, /\boverrated\b/i, /\bunderrated\b/i],
  },
  {
    kind: "tool",
    patterns: [/\btools?\b/i, /\bapp\b/i, /\bextension\b/i, /\bplugin\b/i, /\bcli\b/i, /i (built|made|created)\b/i, /\bshow hn\b/i],
  },
  {
    kind: "discussion",
    patterns: [/\bdiscussion\b/i, /\bwhat (do you|are you)\b/i, /\banyone else\b/i, /\bquestion\b/i, /\bama\b/i],
  },
];

/**
 * Broad AI filter — used by adapters over general-purpose feeds
 * (Product Hunt global feed, HN topstories) to keep only AI items.
 */
export const AI_FILTER_KEYWORDS: RegExp[] = [
  /\bai\b/i, /\bartificial intelligence\b/i, /\bllms?\b/i, /\bgpt\b/i, /\bchatgpt\b/i,
  /\bclaude\b/i, /\bgemini\b/i, /\bmistral\b/i, /\bllama\b/i, /\bdeepseek\b/i, /\bqwen\b/i,
  /\bdiffusion\b/i, /\bagents?\b/i, /\bmachine learning\b/i, /\bneural\b/i, /\bcopilot\b/i,
  /\bopenai\b/i, /\banthropic\b/i, /\bgen(erative)?[- ]?ai\b/i,
];

export function matchesAiFilter(text: string): boolean {
  return AI_FILTER_KEYWORDS.some((re) => re.test(text));
}
