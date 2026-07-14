import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import {
  signUp as amplifySignUp,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  confirmSignUp as amplifyConfirmSignUp,
  getCurrentUser,
  resendSignUpCode as amplifyResendSignUpCode,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
  AuthUser,
  fetchAuthSession,
  signInWithRedirect,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import toast from "react-hot-toast";
import { logError } from "@/lib/logger";

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signUp: (email: string, password: string, attributes: any) => Promise<any>;
  confirmSignUp: (email: string, code: string) => Promise<any>;
  resendSignUp: (email: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<any>;
  checkUser: () => Promise<void>;
  isEmailVerified: boolean;
  confirmResetPassword: (email: string, code: string, newPassword: string) => Promise<any>;
  resetPassword: (email: string) => Promise<any>;
  signInWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Tracks whether we've already auto-retried a Google sign-in after account
  // linking — prevents an infinite retry loop.
  const linkingRetried = useRef(false);

  useEffect(() => {
    checkUser();

    // Listen for OAuth redirect events so we can handle the "Already_Linked"
    // case: the Pre-SignUp trigger links the Google identity to the existing
    // email/password account and throws to prevent a duplicate, which Cognito
    // surfaces as an OAuth error.  We auto-retry once; on the second attempt
    // Cognito recognises the linked identity and signs the user in normally.
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signInWithRedirect") {
        linkingRetried.current = false;
        checkUser();
      }

      if (payload.event === "signInWithRedirect_failure") {
        const msg: string =
          (payload.data as any)?.message ?? (payload.data as any)?.error ?? "";

        if (msg.includes("Already_Linked") && !linkingRetried.current) {
          linkingRetried.current = true;
          toast.success("Account linked! Signing you in…");
          signInWithRedirect({ provider: "Google" });
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const checkUser = async () => {
    try {
      // Skip auth check in local dev if Amplify is not configured
      if (import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX') {
        console.log('Local dev mode: Skipping auth check (no Cognito credentials)');
        setUser(null);
        setLoading(false);
        return;
      }

      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (error: any) {
      // User is not authenticated - this is expected behavior, not an error
      if (error.name === "UserUnAuthenticatedException") {
        setUser(null);
      } else {
        logError(error);
        setUser(null);
      }
    }
    setLoading(false);
  };

  const signUp = async (email: string, password: string, attributes: any) => {

    try {
      const result = await amplifySignUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            ...attributes,
          },
          autoSignIn: true,
        },
      });

      return { success: true, result };
    } catch (error: any) {

      return { success: false, error: error.message };
    }
  };

  const confirmSignUp = async (email: string, code: string) => {
    try {
      const result = await amplifyConfirmSignUp({
        username: email,
        confirmationCode: code,
      });

      console.log("Confirm sign up result: ", result);


      return { success: true, result };
    } catch (error: any) {
      logError("confirm sign up error ", error);
      return { success: false, error: error.message };
    }
  };

  const resendSignUp = async (email: string) => {
    try {
      const result = await amplifyResendSignUpCode({ username: email });

      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {

      const { isSignedIn, nextStep } =await amplifySignIn({ username: email, password });
      if (isSignedIn) {

        const currentUser = await getCurrentUser();
        await isVerified()
        setUser(currentUser);
        return { success: true, user: currentUser };
      }
      else if (nextStep.signInStep == "CONFIRM_SIGN_UP") {
        // send user to register
       // Redirect to /register
        return { success: false, message: nextStep.signInStep };


      }
      return { success: true, nextStep };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const isVerified = async () => {
    try {
      const session = await fetchAuthSession();
      const verified = session.tokens?.idToken?.payload?.email_verified === true;
      setIsEmailVerified(verified);
      return { success: true, isVerified };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
    };


  const resetPassword = async (email: string) => {
    try {
      await amplifyResetPassword({ username: email });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const signInWithGoogle = async () => {
    try {
      await signInWithRedirect({ provider: "Google" });
    } catch (error: any) {
      logError("Google sign in error", error);
      toast.error(error?.message || "Google sign-in failed. Check the console for details.");
    }
  };

  const confirmResetPassword = async (email: string, code: string, newPassword: string) => {
    try {
      await amplifyConfirmResetPassword({ username: email, confirmationCode: code, newPassword });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };



  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signUp,
        confirmSignUp,
        resendSignUp,
        signIn,
        signOut,
        checkUser,
        isEmailVerified,
        confirmResetPassword,
        resetPassword,
        signInWithGoogle,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
