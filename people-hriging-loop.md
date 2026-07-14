File: Untitled Document 2
Page 1 of 4
Here's the report ready to send to Will:
---
## People Ops Hiring Loop — Research & Assessment Report
Hi Will,
Following up on our conversation about tracking the hiring process in Aerostack. I've done the
research on the HubSpot side and mapped out how this would work end-to-end. Here's what I
found and the plan I'm proposing.
---
### HubSpot Pipeline — Current State
I pulled up the HubSpot pipeline configuration. There's one pipeline called **"hiring"**
with these stages:
```
╔══════════════════════════════════════════════════════╗
║
HUBSPOT "hiring" PIPELINE
║
╠══════════════════════════════════════════════════════╣
║
║
║ STAGE NAME
PROBABILITY
TYPE
║
║ ────────────────────────── ───────────
──────
║
║ 1st Contact
10%
Open
║
║ Applied
20%
Open
║
║ First Interview
40%
Open
║
║ Second Interview
60%
Open
║
║ Presentation scheduled
80%
Open
║
║ Offer Letter Sent
90%
Open
║
║ Hired/Onboarding
100%
Won
║
║ Exited
0%
Lost
║
║
║
╚══════════════════════════════════════════════════════╝
```
---
### Proposed Aerostack Hiring Loop — Stage Mapping with Checklists
Here's how each HubSpot stage maps to an Aerostack loop stage, and what checklist items Aerostack
would track at each step:
```
╔═══════════════════════════════════════════════════════════════════════════════╗
║ HUBSPOT STAGE
→ Aerostack STAGE
→ Aerostack CHECKLIST
║
╠═══════════════════════════════════════════════════════════════════════════════╣
║
║
║ 1st Contact (10%)
→ SOURCING
□ Initial call completed ║
║ Applied (20%)
→
□ NDA sent
║
║
□ NDA signed
║
║
□ Candidate qualified
║
║
║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║
║
║ First Interview (40%)
→ INTERVIEWING
□ Interview 1 completed ║
║ Second Interview (60%)
→
□ Interview 2 completed ║
║ Presentation sched. (80%) →
□ Presentation done
║
║
□ Team feedback recorded ║
║
□ Comp plan shared
║
║
□ Comp plan agreed
║
║
║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║
║File: Untitled Document 2
Page 2 of 4
║ Offer Letter Sent (90%)
→ OFFER
□ Offer letter sent
║
║
□ Offer letter signed
║
║
□ Deel record created
║
║
║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║
║
║ Hired/Onboarding (Won)
→ ONBOARDING
□ Google Workspace
║
║
□ Slack access
║
║
□ Moodle enrolled
║
║
□ Role-based tools
║
║
□ State compliance
║
║
║
║ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ║
║
║
║ All checklist done
→ ACTIVE
Employee ready to start ║
║
║
║ Exited (Lost)
→ CLOSED
Loop archived
║
║
║
╚═══════════════════════════════════════════════════════════════════════════════╝
```
---
### Step-by-Step Flow — How It Works
```
STEP 1: TRIGGER
═══════════════════════════════════════════════════════════════
Someone creates a deal in HubSpot "hiring" pipeline
at "1st Contact" stage
│
▼
HubSpot fires a webhook to Aerostack
│
▼
Aerostack receives candidate data (name, email, deal ID, owner)
and auto-creates a Hiring Loop in SOURCING stage
with the checklist items for that stage
STEP 2: TWO-WAY SYNC (HubSpot ↔ Aerostack)
═══════════════════════════════════════════════════════════════
┌──────────────┐
┌──────────────┐
│
│
deal stage
│
│
│
HUBSPOT
│ ──── moves ──────► │
Aerostack
│
│
│
│
│
│ "hiring"
│
webhook fires
│ Hiring Loop │
│
pipeline
│ ──────────────────►│ stage auto- │
│
│
│ advances
│
│
│
│
│
│
│
checklist item
│
│
│
│ ◄── completed ─────│ Team ticks │
│
│
Aerostack writes
│ checklist
│
│
│
back to deal
│ items in
│
│
│
properties
│ Aerostack UI
│
└──────────────┘
└──────────────┘
Direction 1: HubSpot → Aerostack
When deal stage changes in HubSpot (e.g. "First Interview" →
"Second Interview"), webhook fires and Aerostack loop stage
updates automatically.
Direction 2: Aerostack → HubSpot
When team completes checklist items in Aerostack (e.g. "NDA signed",
"Comp plan agreed"), Aerostack writes those updates back to theFile: Untitled Document 2
Page 3 of 4
HubSpot deal as custom properties so both systems stay in sync.
STEP 3: STAGE PROGRESSION
═══════════════════════════════════════════════════════════════
HubSpot: 1st Contact
│
│ deal moves to
│ "First Interview"
▼
HubSpot: First Interview
│
│ deal moves to
│ "Offer Letter Sent"
▼
HubSpot: Offer Letter Sent
│
│ deal moves to
│ "Hired/Onboarding"
▼
HubSpot: Hired/Onboarding
│
│
│
▼
HubSpot: Won (100%)
Aerostack: SOURCING
│
│ checklist items
│ getting ticked
▼
Aerostack: INTERVIEWING
│
│ more checklist
│ items ticked
▼
Aerostack: OFFER
│
│ offer signed,
│ Deel record created
▼
Aerostack: ONBOARDING
│
│ Google, Slack, Moodle
│ (future implementation)
▼
Aerostack: ACTIVE
"Brandon can start today"
STEP 4: WHAT THE TEAM SEES IN Aerostack
═══════════════════════════════════════════════════════════════
People Ops Dashboard:
┌─────────────────────────────────────────────────────────┐
│ HIRING LOOPS
│
│
│
│ SOURCING (2)
INTERVIEWING (1)
OFFER (1)
│
│ ┌──────────┐
┌──────────────┐
┌──────────┐
│
│ │ Jane D. │
│ Mike R.
│
│ Sarah K. │
│
│ │ 2/4 done │
│ 4/6 done
│
│ 1/3 done │
│
│ ├──────────┤
└──────────────┘
└──────────┘
│
│ │ Tom S.
│
│
│ │ 1/4 done │
ONBOARDING (1)
ACTIVE (3)
│
│ └──────────┘
┌──────────────┐
┌──────────┐
│
│
│ Brandon P.
│
│ Kyle
│
│
│
│ 3/5 done
│
│ Paige
│
│
│
│ ⚠ Missing:
│
│ Alex
│
│
│
│ Slack access│
└──────────┘
│
│
└──────────────┘
│
└─────────────────────────────────────────────────────────┘
```
---
### Future Implementation (Separate Phase)
The following integrations are scoped for a later phase and are not part of the initial
build:
```
• Google Workspace auto-provisioning
• Slack auto-invite
• GitHub org auto-add
• Linear access provisioningFile: Untitled Document 2
Page 4 of 4
• Moodle enrollment API
• State compliance research agent (Bedrock)
• Tech Shift pipeline (1099 → W2 conversion)
```
Phase 1 focuses purely on: HubSpot ↔ Aerostack sync + manual checklist tracking in Aerostack.
---
### Questions for You, Will
1. **Onboarding starts in HubSpot, correct?** My understanding is that every new hire
begins as a deal in the HubSpot "hiring" pipeline at "1st Contact" stage, and that's the
trigger point for Aerostack to pick it up. Can you confirm this is the starting point, or is
there a step before HubSpot where candidates are identified?
2. **Are there custom properties on the HubSpot deal** that we should pull into Aerostack?
Specifically:
- Candidate's department/role (TechOps vs RevOps) — this determines which tools they'll
need later
- Expected start date
- Assigned recruiter/owner
3. **Where do the NDA and comp plan documents live?** Are they stored as HubSpot document
links on the deal, Google Drive URLs, or somewhere else? We need to know so Aerostack can link
to them in the checklist.
4. **For the two-way sync — what should Aerostack write back to HubSpot?** I'm thinking
checklist completion status (e.g. "NDA signed = yes", "comp plan agreed = yes") as custom
deal properties. Does that make sense, or do you want something different?
5. **The Tech Shift pipeline** — you mentioned a separate pipeline for 1099 → W2
conversions. I only see the "hiring" pipeline in HubSpot right now. Is the Tech Shift
pipeline something that needs to be created, or does it already exist under a different
name?
---
Let me know your thoughts on these and I'll start building.