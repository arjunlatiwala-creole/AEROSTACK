---
title: Next.js & React Standards
inclusion: always
---

# Next.js & React Standards

## App Router (Next.js 14+)

Default to Server Components for all new components unless client interactivity is required.

```tsx
// ✅ Good - Server Component by default
export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await fetchProduct(params.id);
  return <ProductDetails product={product} />;
}

// ✅ Good - Client Component only when needed
'use client';
export function InteractiveCart() {
  const [items, setItems] = useState([]);
  return <CartUI items={items} onUpdate={setItems} />;
}
```

## When to Use Client Components

Use `'use client'` directive ONLY when you need:
- React hooks (useState, useEffect, useContext)
- Browser APIs (localStorage, window, document)
- Event handlers (onClick, onChange)
- Third-party libraries that require client-side execution

## Server Actions

Prefer Server Actions over API routes for mutations:

```tsx
// app/actions.ts
'use server';

export async function createProduct(formData: FormData) {
  const name = formData.get('name') as string;
  await db.products.create({ name });
  revalidatePath('/products');
}

// app/products/new/page.tsx
export default function NewProduct() {
  return (
    <form action={createProduct}>
      <input name="name" required />
      <button type="submit">Create</button>
    </form>
  );
}
```

## Routing Conventions

```
app/
├── (auth)/              # Route group (doesn't affect URL)
│   ├── login/
│   └── register/
├── dashboard/
│   ├── layout.tsx       # Shared layout
│   ├── page.tsx         # /dashboard
│   └── settings/
│       └── page.tsx     # /dashboard/settings
├── api/                 # API routes (use sparingly)
│   └── webhook/
│       └── route.ts
└── layout.tsx           # Root layout
```

## Data Fetching

```tsx
// ✅ Good - Fetch in Server Component
async function ProductList() {
  const products = await fetch('https://api.example.com/products', {
    next: { revalidate: 3600 } // ISR
  }).then(r => r.json());
  
  return products.map(p => <ProductCard key={p.id} product={p} />);
}

// ✅ Good - Parallel data fetching
async function Dashboard() {
  const [user, stats, notifications] = await Promise.all([
    fetchUser(),
    fetchStats(),
    fetchNotifications()
  ]);
  
  return <DashboardUI user={user} stats={stats} notifications={notifications} />;
}
```

## Component Organization

```tsx
// components/ProductCard/ProductCard.tsx
interface ProductCardProps {
  product: Product;
  onAddToCart?: (id: string) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  return (
    <article className="rounded-lg border p-4">
      <h3>{product.name}</h3>
      <p>{product.price}</p>
      {onAddToCart && (
        <button onClick={() => onAddToCart(product.id)}>
          Add to Cart
        </button>
      )}
    </article>
  );
}

// components/ProductCard/index.ts
export { ProductCard } from './ProductCard';
export type { ProductCardProps } from './ProductCard';
```

## Error Handling

```tsx
// app/products/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}

// app/products/loading.tsx
export default function Loading() {
  return <ProductListSkeleton />;
}
```

## Metadata

```tsx
// app/products/[id]/page.tsx
import { Metadata } from 'next';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const product = await fetchProduct(params.id);
  return {
    title: product.name,
    description: product.description,
    openGraph: {
      images: [product.imageUrl],
    },
  };
}
```

## Anti-Patterns

❌ Don't use `useEffect` for data fetching in Server Components
❌ Don't pass Server Components as props to Client Components
❌ Don't use API routes when Server Actions suffice
❌ Don't fetch data in Client Components when it can be done server-side
❌ Don't use `'use client'` at the root when only a child needs it
