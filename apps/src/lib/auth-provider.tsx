'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient, { removeToken, setToken } from '@/lib/api';
import { clearCachedProfile, getUserProfile } from '@/lib/auth';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type UserProfile = Awaited<ReturnType<typeof getUserProfile>>;

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  refreshProfile: () => Promise<void>;
  login: (params: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await getUserProfile();
      setUser(profile);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.token) {
        setToken(data.token);
      }

      clearCachedProfile();
      await refreshProfile();
      router.push('/dashboard');
    },
    [refreshProfile, router]
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }

    removeToken();
    clearCachedProfile();
    setUser(null);
    setStatus('unauthenticated');

    try {
      await apiClient.post('/auth/logout');
    } catch {
      // ignore (gateway may not implement logout)
    }

    router.push('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      refreshProfile,
      login,
      logout,
    }),
    [status, user, refreshProfile, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
