import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { backendConfigured, supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(backendConfigured);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!backendConfigured) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setProfile(null);
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
      .select("id,email,display_name,role,team_id,region_scope,active")
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
    },
  }), [error, loading, profile, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
