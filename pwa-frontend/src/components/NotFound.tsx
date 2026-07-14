import { ROUTES } from "@/lib/routes-config";
import { useNavigate } from "react-router";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main
      className="min-h-screen flex items-center justify-center bg-gray-50"
      role="main"
      tabIndex={-1} // Allows programmatic focus or keyboard skip focus
      aria-labelledby="not-found-heading"
    >
      <div className="text-center" aria-label="404 Page Not Found">
        <h1
          id="not-found-heading"
          tabIndex={0}
          className="text-6xl font-bold text-gray-900 mb-4 focus:outline-none focus:ring-4 focus:ring-blue-500 rounded"
          aria-level={1}
          aria-live="polite"
        >
          404
        </h1>
        <h2 className="text-2xl font-semibold text-gray-700 mb-2" aria-level={2} role="heading">
          Page Not Found
        </h2>
        <p className="text-gray-600 mb-6">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <button
          onClick={() => navigate(ROUTES.APP.HOME.path)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          aria-label="Go to home page"
        >
          Go Home
        </button>
      </div>
    </main>
  );
}
