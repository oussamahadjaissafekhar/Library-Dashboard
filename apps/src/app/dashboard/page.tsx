"use client";

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { getUserId } from '@/lib/auth';
import Skeleton from '@/app/components/Skeleton';

export default function DashboardPage() {
  const statsQuery = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const [booksRes, userId] = await Promise.all([
        apiClient.get('/catalog/books'),
        getUserId().catch(() => ''),
      ]);

      const books = booksRes.data || [];
      let activeLoans = 0;

      if (userId) {
        const txRes = await apiClient.get(`/transactions/user/${userId}`);
        const txs = Array.isArray(txRes.data) ? txRes.data : txRes.data?.transactions || [];
        activeLoans = txs.filter((t: any) => t.status === 'BORROWED').length;
      }

      return {
        booksCount: Array.isArray(books) ? books.length : 0,
        activeLoans,
      };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-600">Stats overview</p>
      </div>

      {statsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-9 w-16" />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-9 w-16" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Books</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
              {statsQuery.data?.booksCount ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Active loans</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
              {statsQuery.data?.activeLoans ?? 0}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Use the sidebar to browse the catalog and manage your loans.
      </div>
    </div>
  );
}

