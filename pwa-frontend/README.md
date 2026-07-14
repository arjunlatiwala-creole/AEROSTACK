# Aerostack PWA Frontend

**React PWA frontend for the Aerostack (Agentic Execution Operating System)**

Built with React 18, TypeScript, Vite, and Redux Toolkit.

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

**Access:** http://localhost:5173

## 📋 Dashboard Tabs

### **Core Aerostack Dashboards:**
- **🏢 Org** - Overview of all loops, people, and organizational metrics
- **🎯 Opportunities** - BD/GTM/ADVISORY loops with weighted prioritization
- **🚀 Delivery** - ENG/MSP loops in progress with delivery tracking
- **📚 Learning** - Completed loops with captured lessons
- **👤 Person** - Individual dashboard with velocity and performance metrics
- **⚙️ Setup** - RevOps configuration and data import tools

### **🜂 BFPM System (NEW)**
**Beacon → Focus → Perspex → Move** - Facilitated sessions for moving from emergence vision to coordinated action.

#### **What is BFPM?**
- **🧭 Beacon**: Define "what should emerge if we succeed"
- **🎯 Focus**: Align on current challenge "what must we solve today?"
- **🔍 Perspex**: Synthesize perspectives and identify tensions
- **🚀 Move**: Generate action plan with concrete objectives

#### **Features:**
- **✅ Session Management** - Create and manage facilitated sessions
- **✅ Progressive Stages** - Visual flow through all 4 stages
- **✅ AI Synthesis** - Intelligent processing at each stage
- **✅ Context Awareness** - Each stage builds on previous outputs
- **✅ Session History** - Track and revisit past sessions

#### **Usage:**
1. **Navigate to BFPM tab**
2. **Create new session** (Strategic/Tactical/Operational)
3. **Work through stages:**
   - Beacon: Collect future visions → AI synthesizes emergence anchor
   - Focus: Define challenges → AI creates unified problem statement
   - Perspex: Gather perspectives → AI identifies patterns and tensions
   - Move: Plan actions → AI generates objectives with owners

## 🏗️ Architecture

```
src/
├── components/          # Reusable UI components
│   └── aerostack/           # Aerostack-specific components
├── pages/              # Dashboard pages
│   ├── DashboardBfpm.tsx    # BFPM system interface
│   ├── DashboardOrg.tsx     # Organization dashboard
│   ├── DashboardRevOps.tsx  # RevOps dashboard
│   └── ...
├── lib/                # API clients and utilities
│   ├── bfpmClient.ts   # BFPM API client
│   ├── aerostackClient.ts   # Aerostack API client
│   └── squidClient.ts  # Squid backend client
├── features/           # Redux features
├── store/              # Redux store configuration
├── theme/              # CSS styling
└── routes.tsx          # Main app routing
```

## 🔌 API Integration

### **BFPM Client (`lib/bfpmClient.ts`)**
```typescript
// Session Management
await bfpmClient.createSession(title, sessionType)
await bfpmClient.listSessions()
await bfpmClient.getSessionData(sessionId)

// Stage Operations
await bfpmClient.createBeacon(request)
await bfpmClient.createFocus(request)
await bfpmClient.addPerspexInput(request)
await bfpmClient.createPerspexSummary(request)
await bfpmClient.createActionPlan(request)
```

### **Aerostack Client (`lib/aerostackClient.ts`)**
```typescript
// Loop Management
await aerostackClient.createLoop(request)
await aerostackClient.listLoops(params)
await aerostackClient.scoreOutcome(request)
```

## 🎨 Styling

- **CSS Variables** - Brand colors and design tokens in `theme/index.css`
- **Component Styles** - Scoped styling for each component
- **BFPM Styles** - Dedicated styling for BFPM system interface
- **Responsive Design** - Mobile-first responsive layout

### **Brand Colors:**
- `--color-ink: #002D43` (Primary text)
- `--color-blue: #0096FF` (Innovation)
- `--color-orange: #FF9900` (Execution)
- `--color-green: #B6FFBB` (Managed)
- `--color-pink: #FF66B2` (Optimization)

## 🛠️ Development

### **Commands:**
```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm preview      # Preview production build
pnpm typecheck    # Run TypeScript checks
```

### **Environment:**
- **Node.js 20+** required
- **Vite** for fast development and building
- **TypeScript** for type safety
- **Redux Toolkit** for state management

## 📦 Dependencies

### **Core:**
- `react` - UI library
- `react-dom` - DOM rendering
- `@reduxjs/toolkit` - State management
- `@squidcloud/client` - Backend integration

### **UI Components:**
- `ag-grid-react` - Data grids
- `reactflow` - Flow diagrams

### **Development:**
- `vite` - Build tool
- `typescript` - Type checking
- `@vitejs/plugin-react` - React support

## 🔗 Backend Integration

The frontend connects to the Squid backend via the `@squidcloud/client` library. All API calls are wrapped in client classes for type safety and error handling.

**Backend Services:**
- `AerostackService` - Core Aerostack functionality
- `BfpmService` - BFPM system functionality
- `RevOpsService` - RevOps data management

## 📱 PWA Features

- **Offline Support** - Service worker for offline functionality
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Fast Loading** - Optimized bundle splitting and caching
- **Modern UI** - Clean, professional interface design

## 🚀 Deployment

The frontend is containerized with Docker and deployed to Kubernetes:

```bash
# Build Docker image
docker build -t aerostack-frontend .

# Run locally
docker run -p 3000:80 aerostack-frontend
```

See [../k8s/README.md](../k8s/README.md) for Kubernetes deployment details.