'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Users, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import Skeleton from '@/app/components/Skeleton';
import { useAuth } from '@/lib/auth-provider';

type UserRow = {
  id?: string;
  _id?: string;
  userId?: string;
  email?: string;
  role?: string;
};

function getHttpErrorDetails(err: any): { status?: number; message: string } {
  const status = err?.response?.status;
  const messageFromBody = err?.response?.data?.message;
  const message =
    typeof messageFromBody === 'string'
      ? messageFromBody
      : err?.message
        ? String(err.message)
        : 'Request failed';
  return { status, message };
}

function getUserIdValue(u: UserRow): string {
  return String(u.id || u.userId || u._id || '');
}

export default function AdminAccountsPage() {
  const { user, status } = useAuth();

  const role = (user?.role || '').toUpperCase();
  const canView = role === 'LIBRARIAN' || role === 'ADMIN';

  const usersQuery = useQuery({
    queryKey: ['admin', 'accounts', 'users'],
    enabled: status === 'authenticated' && canView,
    queryFn: async () => {
      const res = await apiClient.get('/auth/users');
      const data = res.data;
      return Array.isArray(data) ? (data as UserRow[]) : (data?.users as UserRow[]) || [];
    },
    retry: false,
  });

  const users = useMemo(() => usersQuery.data || [], [usersQuery.data]);

  if (status === 'loading') {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-sm text-gray-700">Please sign in to view accounts.</div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-red-700" />
          <div>
            <div className="text-sm font-semibold text-red-900">Access restricted</div>
            <div className="mt-1 text-sm text-red-800">
              This page is only available to librarian/admin accounts.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const errorDetails = usersQuery.error ? getHttpErrorDetails(usersQuery.error) : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gray-800" />
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Admin Accounts</h1>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Temporary debug view for demo/testing. Lists existing accounts from auth-service.
        </p>
      </div>

      {usersQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Failed to load users{errorDetails?.status ? ` (HTTP ${errorDetails.status})` : ''}</div>
          <div className="mt-1 text-red-800">{errorDetails?.message || 'Request failed'}</div>
          <div className="mt-2 text-xs text-red-700">
            Expected endpoint: <span className="font-mono">GET /auth/users</span>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-5">
          <div className="text-base font-semibold text-gray-900">Users</div>
          <div className="mt-1 text-sm text-gray-600">
            {usersQuery.isFetching ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Refreshing…
              </span>
            ) : (
              <span>{users.length} account(s)</span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Email</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Role</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {usersQuery.isLoading ? (
                <tr>
                  <td className="px-5 py-4" colSpan={3}>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-gray-600" colSpan={3}>
                    No users returned.
                  </td>
                </tr>
              ) : (
                users.map((u, idx) => {
                  const email = u.email || '-';
                  const displayRole = (u.role || '-').toUpperCase();
                  const idValue = getUserIdValue(u);

                  return (
                    <tr key={idValue || `${email}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-5 py-4 text-sm font-medium text-gray-900">{email}</td>
                      <td className="px-5 py-4 text-sm text-gray-700">{displayRole}</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!idValue) {
                              toast.error('No user ID available to copy');
                              return;
                            }

                            try {
                              await navigator.clipboard.writeText(idValue);
                              toast.success('User ID copied');
                            } catch {
                              toast.error('Failed to copy');
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                        >
                          <Copy className="h-4 w-4 text-gray-600" />
                          Copy ID
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
