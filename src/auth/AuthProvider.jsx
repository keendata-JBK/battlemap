import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clearAuthCallbackUrl } from "./authCallback.js";
import { backendConfigured, initialAuthCallbackType, supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(backendConfigured);
  const [error, setError] = useState("");
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(
    initialAuthCallbackType === "invite" || initialAuthCallbackType === "recovery",
  );

  useEffect(() => {
    if (!backendConfigured) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession((current) => {
        const sameUser = current?.user?.id && current.user.id === nextSession?.user?.id;
        if (sameUser && ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) return current;
        return nextSession;
      });
      if (event === "PASSWORD_RECOVERY") setPasswordSetupRequired(true);
      if (!nextSession) {
        setProfile(null);
        if (event === "SIGNED_OUT") setPasswordSetupRequired(false);
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!backendConfigured || !session?.user?.id) return undefined;
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("id,email,display_name,role,team_id,region_scope,active,password_change_required")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error: profileError }) => {
        if (!active) return;
        if (profileError) {
          setError(profileError.message);
          setProfile(null);
        } else {
          setError("");
          setProfile(data);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const value = useMemo(() => ({
    backendConfigured,
    session,
    profile,
    loading,
    error,
    passwordSetupRequired,
    async signIn(email, password) {
      setError("");
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }
    },
    async signOut() {
      await supabase.auth.signOut();
      setProfile(null);
      setPasswordSetupRequired(false);
    },
    async requestPasswordReset(email) {
      setError("");
      const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetError) {
        setError(resetError.message);
        throw resetError;
      }
    },
    async completePasswordSetup(password) {
      setError("");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        throw updateError;
      }
      if (profile?.password_change_required) {
        const { error: completeError } = await supabase.rpc("complete_password_change");
        if (completeError) {
          setError(completeError.message);
          throw completeError;
        }
        setProfile((current) => current ? { ...current, password_change_required: false } : current);
      }
      clearAuthCallbackUrl();
      setPasswordSetupRequired(false);
    },
  }), [error, loading, passwordSetupRequired, profile, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
