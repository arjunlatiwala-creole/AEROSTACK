## 🚀 Project Readme: PWA Frontend

Welcome to the `pwa-frontend` repository documentation! This guide provides a comprehensive overview of the project’s architecture, core technologies, and essential development practices to help you get started and contribute effectively.

-----

### 📦 Folder Structure Overview

The project adopts a modular React application structure, promoting scalability and maintainability. Key directories under `src/` are organized as follows:

| Directory | Purpose | Key Files/Examples |
| :--- | :--- | :--- |
| **`src/pages`** | Contains top-level page components rendered by the router. Each file typically represents a route in the application. | `Dashboard.tsx`, `DashboardPerson.tsx` |
| **`src/components`** | Houses reusable UI components. The `components/ui` subfolder contains **Shadcn** UI primitives for consistent design. | `ErrorComponent.tsx`, `ui/button.tsx` |
| **`src/layouts`** | Defines the overall page structure and layout wrappers (e.g., authentication or protected routes). | `AuthLayout.tsx`, `ProtectedRouteLayout.tsx` |
| **`src/context`** | Contains React Context definitions for global state management and shared logic. | `AuthContext.tsx` |
| **`src/schemas`** | Stores data validation schemas, primarily using **Zod** for type-safe validation. | `auth/index.ts` |
| **`src/lib`** | Utility functions, custom hooks, and helper modules to support business logic. | `use-mobile.ts` (hooks), `auth/forgetPassword.ts` (helpers) |
| **`src/assets`** | Static assets such as images, icons, and fonts used throughout the app. | Images folder |
| **`public`** | Global static assets served directly, including favicons and logos. | Favicon, logos |

-----

### 🗺️ Routing & Navigation

Navigation is managed with **React Router 7** using `createBrowserRouter`, enabling declarative and dynamic routing.

  * **Router Instance:** The router is instantiated with `createBrowserRouter` for seamless navigation.
  * **Route Categories:** Routes are logically grouped for clarity and access control:
      * **Auth Routes:** Handle authentication flows (Login, Signup, etc.).
      * **Private Routes:** Restricted to authenticated users (e.g., Dashboard, user-specific pages).
      * **Public Routes:** Accessible to all users (future expansion planned).
      * **Error Routes:** Display error or fallback pages for invalid routes or exceptions.

-----

### 🔒 Authentication (AWS Cognito)

User authentication is powered by **AWS Cognito**, ensuring secure and scalable identity management.

1.  **Signup:** Users register and receive a confirmation email for account activation.
2.  **Confirmation:** Users verify their email address via a secure link.
3.  **Login:** Authenticated access is granted upon successful login with email and password.
4.  **Redirection:** Authenticated users are redirected to protected areas such as the dashboard.

-----

### 📝 Form Handling & Validation

Robust form management is achieved with **React Hook Form** and **Zod** for seamless user input and validation.

  * **Form Library:** **React Hook Form** efficiently manages form state, submissions, and error handling.
  * **Validation:** **Zod** schemas define strict validation rules, ensuring data integrity. Integration with `@hookform/resolvers` connects Zod to React Hook Form for real-time validation.
  * **Schema Location:** All validation schemas are organized in the **`src/schemas`** directory for easy maintenance and reuse.

-----

### 🎨 Styling & Theming

The application’s visual design leverages **Tailwind CSS** for utility-first, responsive styling.

  * **Configuration:** Global theme settings and customizations can be managed in the **`index.css`** file.
  * **Documentation:**
      * Tailwind CSS with Vite: [https://tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite)
      * Explore and customize themes: [https://tweakcn.com/editor/theme](https://tweakcn.com/editor/theme)

#### 🧩 Shadcn Components

Reusable UI elements are built with **Shadcn UI**, ensuring a consistent and modern user experience.

  * **Location:** All Shadcn components are located in **`src/components/ui`**.
  * **Installation:** To add a new component, run the following command in the `pwa-frontend` directory:
    ```bash
    pnpm dlx shadcn@latest add <component-name>
    ```
    **Example:**
    ```bash
    pnpm dlx shadcn@latest add button
    pnpm dlx shadcn@latest add input
    ```
  * **Documentation:** [https://ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components)

-----

### 🛠️ Development Conventions (Creation Steps)

Follow these standardized steps to create new elements, ensuring consistency and code quality:

| Element | Steps to Create | Directory |
| :--- | :--- | :--- |
| **Components** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the component as a function or class.<br>4. Export the component. | `src/components` |
| **Pages** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the page component.<br>4. Export the page. | `src/pages` |
| **Layouts** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the layout component.<br>4. Export the layout. | `src/layouts` |
| **Contexts** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the context.<br>4. Export the context. | `src/context` |
| **Schemas** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the schema.<br>4. Export the schema. | `src/schemas` |
| **Helpers / Utilities** | 1. Create a new file.<br>2. Import dependencies.<br>3. Define the helper or utility.<br>4. Export the helper. | `src/lib` |

-----

### 📊 Other Key Information

  * **Charts:** Data visualization is handled with **Recharts**, providing interactive and customizable charts and graphs.
  * **Error Handling Flow:**
    1. Users receive clear error messages upon encountering issues.
    2. Users are redirected to a dedicated error page for context.
    3. Users are prompted to retry the action or contact support for assistance.

-----