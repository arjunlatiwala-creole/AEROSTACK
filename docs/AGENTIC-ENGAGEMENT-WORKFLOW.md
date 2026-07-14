# Agentic Engagement Workflow

A guide for the enterprise team on using the AI-powered content creation and engagement system in Aerostack.

---

## Overview

The Agentic Engagement Workflow is a strategic content pipeline that uses AWS Bedrock (Claude Sonnet) to automate content planning, generation, and publishing. It turns organizational strategy into platform-specific content across LinkedIn, X (Twitter), Facebook, Meetup, and Blog.

**High-level flow:**

```
Strategic Context --> Content Brief --> AI Draft Generation --> Review & Approval --> Publishing --> Feedback Loop
```

Published content is automatically fed back into the knowledge base so future content generation improves over time.

---

## Getting Started

1. Navigate to the **Engagement & Content** dashboard (`/engagement`)
2. You'll see three main tabs:
   - **Content Agent** -- The AI-powered content creation wizard
   - **Comms & Syndication** -- Communication templates and toolkits
   - **Websites** -- Builder.io integration for web publishing

---

## Content Agent: Step-by-Step

The Content Agent tab provides a guided wizard for creating AI-generated content. Here's each step:

### Step 1: Select Platforms

Choose one or more target platforms for your content:

| Platform | Best For |
|----------|----------|
| **LinkedIn** | Professional thought leadership, case studies, partner updates |
| **X (Twitter)** | Quick insights, community engagement, event promotion |
| **Facebook** | Community building, event promotion, broader reach |
| **Meetup** | Event descriptions, community meetup content |
| **Blog** | Long-form thought leadership, technical deep-dives |

### Step 2: Choose a Topic

Select the strategic theme for your content:

- **AWS Innovation** -- AWS services, features, and cloud innovation
- **Customer Success** -- Client wins, outcomes, and testimonials
- **Rapid Prototyping** -- Speed-to-value, POCs, and fast iteration
- **SMB Modernization** -- Small/mid-business cloud transformation
- **GenAI Application** -- Generative AI use cases and implementations
- **Community Engagement** -- Meetups, events, developer advocacy
- **SaaS Development** -- SaaS architecture, multi-tenancy, platform building
- **Agentic Business** -- AI agents, automation, agentic workflows
- **DevOps Culture** -- CI/CD, infrastructure as code, team practices

### Step 3: Select Target Audiences

Choose one or more audiences you're writing for:

- **Tech Leaders** -- CTOs, VPs of Engineering, technical decision-makers
- **SMB Owners** -- Small/mid-business owners and operators
- **AWS Sellers** -- AWS account teams and partner managers
- **Potential Clients** -- Prospective customers evaluating enterprise
- **Community Advocates** -- Developer community members and organizers
- **Org Leaders** -- C-suite and organizational leadership
- **Tech Individuals** -- Individual developers and engineers
- **Hobbyists** -- Side-project builders and tech enthusiasts

### Step 4: Set the Tone

Pick the voice for this piece:

| Tone | When to Use |
|------|-------------|
| **Inspirational** | Rallying the community, celebrating wins |
| **Informative** | Technical content, how-tos, explainers |
| **Conversational** | Social posts, casual engagement |
| **Formal** | Press releases, partner announcements |
| **Fun** | Event promos, community engagement |

### Step 5: Choose Brand Voice

Select the brand personality:

- **Expert & Authoritative** -- Data-driven, credible, thought leadership
- **Friendly & Approachable** -- Warm, inclusive, human
- **Innovative & Forward-Thinking** -- Cutting-edge, visionary
- **Professional & Corporate** -- Polished, business-appropriate
- **Dynamic & Energetic** -- High-energy, action-oriented

### Step 6: Select CTA Type

What action should readers take?

- **Learn More** -- Drive to a resource or page
- **Join Us** -- Community/event registration
- **Sign Up** -- Product/service signup
- **Get in Touch** -- Contact or consultation
- **Read More** -- Link to full article/blog
- **No CTA** -- Awareness-only content

### Optional Fields

- **Custom Context** -- Add specific details, data points, or angles the AI should incorporate
- **Story Hook** -- Provide a narrative framing or specific story to anchor the content
- **Scheduled Date** -- Set a future publish date for editorial calendar planning

### Submitting and Generating

1. Click **Submit Brief** to save your content brief
2. Click **Generate Draft** to have the AI create platform-specific content
3. The AI will:
   - Pull context from relevant knowledge bases (brand voice, strategy, story library, etc.)
   - Generate platform-appropriate copy
   - Suggest hashtags based on your topic
   - Recommend media types (image, video, carousel, infographic) with descriptions and stock search terms

---

## Content Ledger: Managing Your Content

After generating drafts, use the Content Ledger to manage the content lifecycle:

### Status Flow

```
draft --> review --> approved --> scheduled --> published
                \-> rejected
```

| Status | Meaning |
|--------|---------|
| **Draft** | AI-generated content, not yet reviewed |
| **Review** | Under team review |
| **Approved** | Approved for publishing |
| **Scheduled** | Queued for a specific publish date |
| **Published** | Live on the target platform |
| **Rejected** | Did not pass review |

### Actions Available

- **View Brief** -- See the original brief parameters
- **View Draft** -- Read the generated content
- **Copy to Clipboard** -- Grab the content for pasting into your platform
- **Update Status** -- Move content through the approval pipeline

When content is marked **Published**, it is automatically added to the `system-prior-content` knowledge base so future content generation can reference your publishing history.

---

## Comms & Syndication Toolkit

The second tab provides structured communication templates across five categories:

### Visibility Posts

Generate posts targeting specific audiences on specific platforms. Configure audience, platform, and tone, then use the output as a starting point or feed it into the Content Agent.

### Announcements

Create structured announcements for multiple channels simultaneously:

- **Website** -- Formatted for web publishing
- **LinkedIn** -- Professional network announcement
- **Press Release** -- Formal PR format
- **Newsletter** -- Email-ready format

### Customer Stories

Build STAR-format narratives (Situation, Task, Action, Result) for:

- **GDAC Deck** -- Partner presentation slides
- **Case Study** -- Detailed written case study
- **Pitch Slide** -- Sales-ready single slide
- **showcase Flow** -- Live showcase script

### Team Communications

Internal communication templates:

- **Shoutouts** -- Recognize team achievements
- **Standups** -- Daily standup updates
- **Blockers** -- Escalate blockers with context
- **Retrospectives** -- Sprint/project retros

### Community Blocks

Reusable content building blocks:

- **Story Shapes** -- Narrative frameworks
- **Content Blocks** -- Modular content components
- **Meetup Templates** -- Event description templates
- **Community Patterns** -- Engagement patterns
- **AWS Accreditations** -- Certification and badge announcements

---

## Knowledge Bases

The system uses 9 built-in knowledge bases that provide context for AI content generation. Richer knowledge bases produce better content.

| Knowledge Base | Purpose | How to Populate |
|----------------|---------|-----------------|
| **Brand Voice** | Tone guides, writing samples, approved language | Add style guides and example copy |
| **Strategic Alignment** | OKRs, ICPs, positioning, GTM motions | Add strategy documents and objectives |
| **Story Library** | Case studies, customer wins, narratives | Add customer stories and success narratives |
| **Customer STAR** | STAR-format customer stories | Use the Customer Stories tool in Comms tab |
| **Platform Playbook** | Per-platform best practices | Add platform-specific posting guides |
| **Community Blocks** | Reusable story shapes and content modules | Use the Community Blocks tool in Comms tab |
| **AWS Accreditations** | Certifications, badges, partner achievements | Add certification announcements |
| **Prior Content** | Archive of published content | Auto-populated when content is marked Published |
| **Presentation Structures** | Deck structures and pitch frameworks | Add slide templates and frameworks |

### Managing Knowledge Bases

Access knowledge bases through the KB panel in the Content Agent. You can:

- **Browse entries** in any knowledge base
- **Search** for specific content using semantic search
- **Add entries** with title, content, tags, and entry type (note, reference, or example)
- **Auto-classify** new entries to automatically tag and categorize them

---

## The Three Agents

Behind the scenes, three specialized agents power the workflow:

### 1. Content Strategy Agent

Converts your OKRs and ICP definitions into strategic themes and editorial calendar blocks. This agent ensures content aligns with organizational goals.

### 2. Content Creator Agent

The primary workhorse. Takes your brief, pulls context from the relevant knowledge bases, and generates platform-specific drafts using Claude Sonnet via AWS Bedrock. It handles:

- Platform-appropriate formatting and length
- Hashtag suggestions
- Media recommendations
- Brand voice consistency

### 3. Content Publisher Agent

Transforms approved content into publishable formats, including Builder.io models for website publishing.

---

## Best Practices

### Writing Better Briefs

- **Be specific in Custom Context** -- The more detail you provide, the more targeted the output. Include specific metrics, customer names (if approved), or event details.
- **Use Story Hooks** -- A strong narrative hook produces more engaging content than a generic brief.
- **Match tone to platform** -- Conversational works well on X, Formal suits LinkedIn announcements, Informative fits Blog posts.

### Building Better Knowledge Bases

- **Seed the Brand Voice KB** with actual examples of content your team has written and approved.
- **Keep Strategic Alignment current** with your latest OKRs and ICP definitions.
- **Add every customer win** to the Story Library, even small ones. The AI draws on these for authentic storytelling.
- **Review Prior Content periodically** to ensure quality -- everything published feeds back into future generation.

### Editorial Workflow Tips

- Use **Scheduled Date** to plan content around events, launches, and campaigns.
- Always move content through the full status flow (`draft` -> `review` -> `approved`) rather than publishing directly.
- Use **Rejected** status with notes so the team can learn what doesn't pass review.
- Generate multiple drafts for the same brief across different platforms to create a coordinated multi-channel campaign.

---

## Quick Reference

| Action | Where |
|--------|-------|
| Create new content | Engagement tab > Content Agent |
| View content pipeline | Content Agent > Content Ledger |
| Generate comms templates | Engagement tab > Comms & Syndication |
| Manage knowledge bases | Content Agent > KB panel |
| Schedule content | Set Scheduled Date in brief, then approve |
| Publish to website | Engagement tab > Websites (Builder.io) |
