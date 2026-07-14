/**
 * Content Agent configuration — all the structured options for the
 * enterprise Strategic Content Agent pipeline.
 *
 * These map directly to the step-by-step content creator wizard
 * and feed into the Bedrock-backed content generation agents.
 */

export const PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', maxLength: 3000, hashtagLimit: 5 },
  { id: 'x', label: 'X (Twitter)', maxLength: 280, hashtagLimit: 3 },
  { id: 'facebook', label: 'Facebook', maxLength: 2000, hashtagLimit: 10 },
  { id: 'meetup', label: 'Meetup', maxLength: 4000, hashtagLimit: 5 },
  { id: 'blog', label: 'Blog Post', maxLength: 10000, hashtagLimit: 0 },
] as const;

export const TOPICS = [
  { id: 'aws_innovation', label: 'AWS Innovation' },
  { id: 'customer_success', label: 'Customer Success Story' },
  { id: 'rapid_prototyping', label: 'Rapid Prototyping' },
  { id: 'smb_modernization', label: 'SMB Modernization' },
  { id: 'genai_application', label: 'GenAI Application' },
  { id: 'community_engagement', label: 'Community Engagement' },
  { id: 'saas_development', label: 'SaaS Development' },
  { id: 'agentic_business', label: 'Agentic Business' },
  { id: 'devops_culture', label: 'DevOps Culture' },
] as const;

export const AUDIENCES = [
  { id: 'tech_leaders', label: 'Tech Leaders' },
  { id: 'smb_owners', label: 'SMB Owners' },
  { id: 'aws_sellers', label: 'AWS Sellers' },
  { id: 'potential_clients', label: 'Potential Clients' },
  { id: 'community_advocates', label: 'Community Advocates & Future Advocates' },
  { id: 'org_leaders', label: 'Organizational Leaders' },
  { id: 'tech_individuals', label: 'Tech Individuals' },
  { id: 'hobbyists', label: 'Hobbyists' },
] as const;

export const TONES = [
  { id: 'inspirational', label: 'Inspirational' },
  { id: 'informative', label: 'Informative' },
  { id: 'conversational', label: 'Conversational' },
  { id: 'formal', label: 'Formal' },
  { id: 'fun', label: 'Fun' },
] as const;

export const BRAND_VOICES = [
  { id: 'expert_authoritative', label: 'Expert & Authoritative' },
  { id: 'friendly_approachable', label: 'Friendly & Approachable' },
  { id: 'innovative_forward', label: 'Innovative & Forward-Thinking' },
  { id: 'professional_corporate', label: 'Professional & Corporate' },
  { id: 'dynamic_energetic', label: 'Dynamic & Energetic' },
] as const;

export const CTA_TYPES = [
  { id: 'learn_more', label: 'Learn More' },
  { id: 'join_us', label: 'Join Us' },
  { id: 'sign_up', label: 'Sign Up' },
  { id: 'get_in_touch', label: 'Get in Touch' },
  { id: 'read_more', label: 'Read More' },
  { id: 'none', label: 'No CTA' },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]['id'];
export type TopicId = (typeof TOPICS)[number]['id'];
export type AudienceId = (typeof AUDIENCES)[number]['id'];
export type ToneId = (typeof TONES)[number]['id'];
export type BrandVoiceId = (typeof BRAND_VOICES)[number]['id'];
export type CtaTypeId = (typeof CTA_TYPES)[number]['id'];

export type ContentStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected';

export type PipelinePhase =
  | 'strategy'
  | 'calendar'
  | 'drafting'
  | 'review'
  | 'publish';

export interface ContentBrief {
  readonly id: string;
  readonly platform: PlatformId;
  readonly topic: TopicId;
  readonly audience: AudienceId;
  readonly tone: ToneId;
  readonly brandVoice: BrandVoiceId;
  readonly ctaType: CtaTypeId;
  readonly ctaLink?: string;
  readonly customContext?: string;
  readonly storyHook?: string;
  readonly scheduledDate?: string;
  readonly status: ContentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContentDraft {
  readonly id: string;
  readonly briefId: string;
  readonly version: number;
  readonly content: string;
  readonly suggestedHashtags: readonly string[];
  readonly suggestedMedia?: string;
  readonly reviewNotes?: string;
  readonly status: ContentStatus;
  readonly createdAt: string;
}

export interface StrategicTheme {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly topics: readonly TopicId[];
  readonly audiences: readonly AudienceId[];
  readonly startDate: string;
  readonly endDate: string;
  readonly postsPlanned: number;
}

export interface CalendarSlot {
  readonly id: string;
  readonly themeId?: string;
  readonly date: string;
  readonly platform: PlatformId;
  readonly topic: TopicId;
  readonly audience: AudienceId;
  readonly briefId?: string;
  readonly status: ContentStatus;
}

export interface KnowledgeBaseEntry {
  readonly id: string;
  readonly kb: KbType;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
}

export const KB_TYPES = [
  {
    id: 'brand_voice' as const,
    label: 'Brand Voice',
    description: 'Tone guides, writing samples, approved language, style rules',
    icon: 'Palette',
  },
  {
    id: 'strategic_alignment' as const,
    label: 'Strategic Alignment',
    description: 'OKRs, ICPs, positioning, GTM motions, campaign goals',
    icon: 'Target',
  },
  {
    id: 'story_library' as const,
    label: 'Story Library',
    description: 'Case studies, customer wins, founder narratives, testimonials',
    icon: 'BookOpen',
  },
  {
    id: 'customer_star' as const,
    label: 'Customer STAR Library',
    description: 'Situation-Task-Action-Result stories for customer presentations',
    icon: 'Star',
  },
  {
    id: 'platform_playbook' as const,
    label: 'Platform Playbook',
    description: 'Per-platform best practices, templates, CTA patterns',
    icon: 'Layout',
  },
  {
    id: 'community_blocks' as const,
    label: 'Community Blocks',
    description: 'Story shapes, content blocks, meetup templates, community patterns',
    icon: 'Users',
  },
  {
    id: 'aws_accreditations' as const,
    label: 'AWS Accreditations',
    description: 'AWS certifications, partner badges, competency posts, APN content',
    icon: 'Award',
  },
  {
    id: 'prior_content' as const,
    label: 'Prior Content',
    description: 'Previously published content — auto-populated from content ledger',
    icon: 'Archive',
  },
  {
    id: 'presentation_structures' as const,
    label: 'Presentation Structures',
    description: 'enterprise.io/gdac deck structures, pitch frameworks, showcase flows',
    icon: 'Presentation',
  },
] as const;

export type KbType = (typeof KB_TYPES)[number]['id'];


export const KB_TYPE_TO_SYSTEM_ID: Record<KbType, string> = {
  brand_voice: 'system-brand-voice',
  strategic_alignment: 'system-strategic-alignment',
  story_library: 'system-story-library',
  customer_star: 'system-customer-star',
  platform_playbook: 'system-platform-playbook',
  community_blocks: 'system-community-blocks',
  aws_accreditations: 'system-aws-accreditations',
  prior_content: 'system-prior-content',
  presentation_structures: 'system-presentation-structures',
} as const;
