---
title: Component Library Standards
inclusion: fileMatch
fileMatchPattern: "*.tsx,*.jsx,*component*,*shadcn*"
---

# enterprise Component Library Standards

## Stack: shadcn/ui + Radix UI Primitives + Tailwind CSS

### Why This Stack
- **Auditable** — Components are copied into `src/components/ui/`, not hidden in node_modules. GRC clients can audit every line.
- **Accessible** — Radix primitives provide WCAG 2.1 AA compliance (keyboard navigation, screen reader support, focus management) out of the box.
- **Brandable** — Tailwind theming via CSS variables means one component library works across client brands.
- **No vendor lock-in** — You own the code. No breaking changes from upstream.

## Setup
```bash
npx shadcn@latest init
# Select: New York style, Tailwind CSS, CSS variables, src/ alias
```

## Component Organization
```
src/components/
├── ui/                     # shadcn/ui generated components — DO NOT MANUALLY EDIT
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── input.tsx
│   └── ...
├── forms/                  # Form-specific compositions
│   ├── search-input.tsx    # Composed from ui/input + ui/button
│   └── date-range-picker.tsx
├── layouts/                # Layout compositions
│   ├── page-header.tsx
│   ├── sidebar-nav.tsx
│   └── data-table.tsx
└── [feature]/              # Feature-specific components
    ├── pipeline-card.tsx
    └── compliance-badge.tsx
```

## Rules

### shadcn/ui Components (`components/ui/`)
- Generated via CLI: `npx shadcn@latest add [component]`
- **Do NOT manually edit** these files — customization happens via Tailwind theme or wrapper components
- If you need custom behavior, create a wrapper in `components/` that composes the ui/ primitive
- Update via CLI when shadcn/ui releases improvements

### Custom Components
- Always compose from shadcn/ui primitives when possible
- Use Radix primitives directly only when shadcn/ui doesn't have the pattern
- Every interactive component must be keyboard navigable
- Every component with visual meaning must have appropriate ARIA attributes

### Theming
```css
/* app/globals.css — define theme via CSS variables */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    /* Client-specific overrides go in separate theme files */
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
  }
}
```

- Theme tokens defined as CSS variables in `globals.css`
- Client-specific themes as separate CSS files loaded conditionally
- Never hardcode colors in components — always use theme tokens via Tailwind (`bg-primary`, `text-foreground`)
- Dark mode support required for all dashboard/internal tool projects

### Tailwind Usage
- Use Tailwind utility classes directly — no CSS modules, no styled-components, no emotion
- Extract repeated patterns into Tailwind `@apply` ONLY in `globals.css` for true design tokens
- Use `cn()` utility (from shadcn/ui) for conditional class merging
- Never use inline `style={{}}` except for truly dynamic values (calculated positions, etc.)

```typescript
// ✅ Good — cn() for conditional classes
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      status === 'active' && 'bg-green-100 text-green-800',
      status === 'inactive' && 'bg-gray-100 text-gray-800',
    )}>
      {status}
    </span>
  );
}

// ❌ Bad — inline styles
function StatusBadge({ status }) {
  return <span style={{ color: status === 'active' ? 'green' : 'gray' }}>{status}</span>;
}
```

## Accessibility Requirements (Non-Negotiable)
These are enforced for GRC/compliance clients and should be default practice:

1. **All interactive elements must be keyboard accessible** — Tab, Enter, Escape, Arrow keys
2. **Focus indicators must be visible** — Never remove `outline` without providing an alternative
3. **Color is never the only indicator** — Use icons, text, or patterns alongside color
4. **Images have alt text** — Decorative images use `alt=""`
5. **Form inputs have associated labels** — Use `htmlFor` or wrap in `<label>`
6. **Error messages are associated with inputs** — Use `aria-describedby`
7. **Modals trap focus** — Radix Dialog does this automatically
8. **Live regions for dynamic content** — Use `aria-live="polite"` for status updates
9. **Minimum contrast ratio** — 4.5:1 for normal text, 3:1 for large text (WCAG AA)
10. **Touch targets minimum 44x44px** — For mobile/tablet interfaces

## Component Patterns

### Data Tables
- Use `@tanstack/react-table` with shadcn/ui Table components
- Server-side sorting and pagination by default
- Client-side only for datasets < 100 rows
- Always include: column visibility toggle, export capability, empty state

### Forms
- `react-hook-form` + Zod + shadcn/ui Form components
- Validation schemas in `lib/validators/`
- Submit via Server Actions
- Show inline errors, not toast-only

### Modals / Dialogs
- Use shadcn/ui Dialog (Radix-based)
- Confirmation dialogs for destructive actions
- Never nest modals
- Close on Escape key (Radix default)

### Toast / Notifications
- Use shadcn/ui Sonner integration
- Success: auto-dismiss after 3s
- Error: persist until dismissed
- Never use toast as the only feedback for form errors
