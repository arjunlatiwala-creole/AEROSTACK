# Aerostack V1 Squid Backend

This is the Squid-powered backend for the Aerostack V1 prioritization and learning system. It uses Squid's built-in real-time database and executable functions.

## Architecture

- **Real-time Database**: Uses Squid's built-in database collections
- **Frontend Direct Access**: Frontend can read/write directly to collections with security rules
- **Executable Functions**: Backend functions for complex operations and integrations
- **Real-time Sync**: All data automatically syncs in real-time across all clients

## Collections

### **Aerostack Core Collections:**
- `people` - Team members and users
- `loops` - Work loops (Objectives and Key Results)
- `loop_ownership` - Ownership and contributor relationships
- `lessons` - Lessons learned from completed loops
- `resume_items` - Auto-generated achievement records
- `velocity_snapshots` - Performance velocity tracking

### **BFPM System Collections:**
- `bfpm_sessions` - Facilitated session management
- `beacon_sessions` - Emergence anchor definitions
- `focus_sessions` - Challenge alignment statements
- `perspex_inputs` - Individual perspective inputs
- `perspex_summaries` - Synthesized perspective analysis
- `action_plans` - Generated action plans with objectives

## Executable Functions

### **AerostackService**
- `createLoop()` - Create new loop with auto-pillar mapping and ownership
- `scoreOutcome()` - Score loop completion with contributors and lessons
- `calculateVelocity()` - Calculate person's velocity score
- `createPerson()` - Add new team member
- `listLoops()`, `listOpportunityPrioritization()`, `listDeliveryStatus()`, `listLearningLoops()`
- `getPersonDashboardByEmail()` - Individual performance metrics

### **BfpmService (NEW)**
**Beacon → Focus → Perspex → Move facilitated sessions**

**Session Management:**
- `createSession(title, sessionType)` - Create new facilitated session
- `getSession(sessionId)` - Get session details
- `listSessions()` - List all sessions
- `getSessionData(sessionId)` - Complete session state with all stages

**Stage Operations:**
- `createBeacon(request)` - Define emergence anchor ("what should emerge")
- `createFocus(request)` - Align on challenge ("what must we solve")
- `addPerspexInput(request)` - Add individual perspective
- `createPerspexSummary(request)` - Synthesize all perspectives
- `createActionPlan(request)` - Generate coordinated action plan

### **SlackService**
- `handleSlashCommand()` - Process Slack slash commands
- `handleModalSubmission()` - Process Slack modal interactions

### **DatabaseInitializer**
- `initializeDatabase()` - Set up initial data
- `getCategoryPillarMapping()` - Get category→pillar mappings
- `getCollectionCounts()` - Get current data counts

## Security Rules

Collections have security rules to control access:

```javascript
{
  loops: {
    read: 'auth.userId != null',    // Authenticated users can read
    write: 'auth.userId != null',   // Authenticated users can write
  },
  resume_items: {
    read: 'resource.person_id == auth.userId || auth.claims.role == "admin"',
    write: 'auth.claims.role == "admin"', // Only admins can create
  }
}
```

## Frontend Integration

The frontend can:

1. **Direct Database Access**: Read/write to collections using Squid SDK
2. **Real-time Updates**: Subscribe to collection changes
3. **Call Executables**: Invoke backend functions for complex operations

Example frontend usage:
```typescript
// Direct collection access
const loops = await squid.collection('loops').query().eq('status', 'IN_PROGRESS').snapshot();

// Real-time subscription
squid.collection('loops').query().subscribe((loops) => {
  // Handle real-time updates
});

// Call executable
const result = await squid.executable('AerostackService', 'createLoop')(loopData);
```

## Data Flow

### **Aerostack Core Flow:**
1. **Loop Creation**: Frontend calls `createLoop()` executable → Creates loop + ownership
2. **Real-time Updates**: Frontend writes directly to `loops` collection
3. **Scoring**: Frontend calls `scoreOutcome()` → Creates lessons + resume items
4. **Velocity**: Calculated on-demand via `calculateVelocity()` executable

### **BFPM System Flow:**
1. **Session Creation**: `createSession()` → Creates session with initial state
2. **Beacon Stage**: `createBeacon()` → AI synthesis of emergence anchor + context vector
3. **Focus Stage**: `createFocus()` → Challenge alignment using beacon context
4. **Perspex Stage**: `addPerspexInput()` → Individual perspectives → `createPerspexSummary()` → AI synthesis
5. **Move Stage**: `createActionPlan()` → Generate objectives with owners and timelines
6. **Session State**: `getSessionData()` → Complete session with all stage outputs

## Deployment

```bash
# Build and deploy
npm run build
npm run deploy

# Development
npm run dev
```

The backend will automatically scale and handle real-time synchronization across all connected clients.

## Environment Variables

Configure in `.env`:
- `SQUID_APP_ID` - Your Squid application ID
- `SQUID_REGION` - Squid region (e.g., us-east-1.aws)
- `SQUID_API_KEY` - Squid API key
- `SQUID_ENVIRONMENT_ID` - Environment (dev/prod)
- `SQUID_DEVELOPER_ID` - Your developer ID

## Integrations

### Slack (Planned)
- Slash commands for creating/scoring loops
- Modal interfaces for data entry
- Real-time notifications

### Jira (Planned)
- Auto-create Epics for new loops
- Webhook sync for status updates
- Bidirectional sync between Aerostack and Jira

### AWS Cognito (Future)
- User authentication and authorization
- Role-based access control
- SSO integration