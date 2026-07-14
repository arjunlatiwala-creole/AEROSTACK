// import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import "@/lib/ag-grid-config";
// import { ModuleRegistry } from 'ag-grid-community';
// import { AllCommunityModule } from 'ag-grid-community';

// ModuleRegistry.registerModules([AllCommunityModule]);
import React from "react";
import ReactDOM from "react-dom/client";

import { Provider } from "react-redux";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { store } from "./store";
import "./theme/index.css";
import { AuthProvider } from "./context/auth/AuthContext";
import { configureAmplify } from "@/lib/amplify-config";
import { Toaster } from 'react-hot-toast';
import { toasterConfig } from "./lib/toasterConfig";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';


configureAmplify()

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </AuthProvider>
    <Toaster toastOptions={toasterConfig} />
  </React.StrictMode>,
);
