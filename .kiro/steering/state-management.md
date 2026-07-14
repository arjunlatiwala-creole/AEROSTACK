---
title: State Management Standards
inclusion: always
---

# State Management Standards

## Decision Tree

```
Is this server data? → Use TanStack Query (React Query)
Is this client-only UI state? → Use Zustand
Is this form state? → Use React Hook Form
Is this URL state? → Use Next.js searchParams
Is this shared across 2-3 components? → Lift state up or use Context
```

## TanStack Query (React Query) - Server State

Use for ALL server data: fetching, caching, synchronization, mutations.

```tsx
// lib/queries/products.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (product: NewProduct) => {
      const res = await fetch('/api/products', {
        method: 'POST',
        body: JSON.stringify(product),
      });
      if (!res.ok) throw new Error('Failed to create product');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// components/ProductList.tsx
'use client';

export function ProductList() {
  const { data: products, isLoading, error } = useProducts();
  const createProduct = useCreateProduct();
  
  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  
  return (
    <div>
      {products.map(p => <ProductCard key={p.id} product={p} />)}
      <button onClick={() => createProduct.mutate({ name: 'New Product' })}>
        Add Product
      </button>
    </div>
  );
}
```

### Query Key Conventions

```tsx
// ✅ Good - Hierarchical, predictable
['products']                          // All products
['products', { status: 'active' }]    // Filtered products
['products', productId]               // Single product
['products', productId, 'reviews']    // Product reviews

// ❌ Bad - Inconsistent, hard to invalidate
['getProducts']
['product-123']
['reviews_for_product_123']
```

### Optimistic Updates

```tsx
export function useUpdateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: updateProductAPI,
    onMutate: async (updatedProduct) => {
      await queryClient.cancelQueries({ queryKey: ['products', updatedProduct.id] });
      
      const previous = queryClient.getQueryData(['products', updatedProduct.id]);
      
      queryClient.setQueryData(['products', updatedProduct.id], updatedProduct);
      
      return { previous };
    },
    onError: (err, updatedProduct, context) => {
      queryClient.setQueryData(['products', updatedProduct.id], context?.previous);
    },
    onSettled: (updatedProduct) => {
      queryClient.invalidateQueries({ queryKey: ['products', updatedProduct.id] });
    },
  });
}
```

## Zustand - Client State

Use for client-only state that needs to be shared across components.

```tsx
// stores/cartStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) => set((state) => ({ 
        items: [...state.items, item] 
      })),
      removeItem: (id) => set((state) => ({ 
        items: state.items.filter(i => i.id !== id) 
      })),
      clearCart: () => set({ items: [] }),
    }),
    {
      name: 'cart-storage',
    }
  )
);

// components/AddToCartButton.tsx
'use client';

export function AddToCartButton({ product }: { product: Product }) {
  const addItem = useCartStore((state) => state.addItem);
  
  return (
    <button onClick={() => addItem({ id: product.id, name: product.name })}>
      Add to Cart
    </button>
  );
}

// components/CartCount.tsx
'use client';

export function CartCount() {
  const itemCount = useCartStore((state) => state.items.length);
  return <span>{itemCount}</span>;
}
```

### Zustand Best Practices

```tsx
// ✅ Good - Selector for specific slice
const itemCount = useCartStore((state) => state.items.length);

// ❌ Bad - Subscribes to entire store
const { items } = useCartStore();
const itemCount = items.length;

// ✅ Good - Separate stores by domain
useCartStore()
useUIStore()
useAuthStore()

// ❌ Bad - One giant store
useAppStore()
```

## React Hook Form - Form State

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const productSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.number().positive('Price must be positive'),
  description: z.string().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

export function ProductForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
  });
  
  const createProduct = useCreateProduct();
  
  const onSubmit = (data: ProductFormData) => {
    createProduct.mutate(data);
  };
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}
      
      <input type="number" {...register('price', { valueAsNumber: true })} />
      {errors.price && <span>{errors.price.message}</span>}
      
      <button type="submit">Create</button>
    </form>
  );
}
```

## URL State - Search Params

```tsx
// app/products/page.tsx
import { Suspense } from 'react';

export default function ProductsPage({
  searchParams,
}: {
  searchParams: { category?: string; sort?: string };
}) {
  return (
    <Suspense fallback={<ProductListSkeleton />}>
      <ProductList category={searchParams.category} sort={searchParams.sort} />
    </Suspense>
  );
}

// components/ProductFilters.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    router.push(`/products?${params.toString()}`);
  };
  
  return (
    <select onChange={(e) => updateFilter('category', e.target.value)}>
      <option value="all">All Categories</option>
      <option value="electronics">Electronics</option>
    </select>
  );
}
```

## Context - Scoped State

Use Context sparingly, only for truly global app state or theme/i18n.

```tsx
// contexts/ThemeContext.tsx
'use client';

import { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
```

## Anti-Patterns

❌ Don't use Zustand for server data (use TanStack Query)
❌ Don't use TanStack Query for client-only UI state (use Zustand)
❌ Don't use Context for frequently changing state (causes re-renders)
❌ Don't use localStorage directly (use Zustand persist middleware)
❌ Don't mix state management solutions for the same data
❌ Don't store derived state (compute it from source of truth)
