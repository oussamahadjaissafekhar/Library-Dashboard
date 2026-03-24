"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ShieldAlert } from 'lucide-react';
import apiClient from '@/lib/api';
import Skeleton from '@/app/components/Skeleton';
import { useAuth } from '@/lib/auth-provider';
import { getUserId } from '@/lib/auth';

type TransactionStatus = 'REQUESTED' | 'ISSUED' | 'RETURN_PENDING' | 'RETURNED' | 'BORROWED' | string;

type HydratedUser = {
  id?: string;
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

type Book = {
  id?: string;
  title?: string;
  isbn?: string;
  authors?: string[];
};

type Transaction = {
  id?: string;
  _id?: string;
  bookId?: string;
  copyId?: string;
  userId?: string;
  status?: TransactionStatus;
  borrowDate?: string;
  returnDate?: string;
  pickedUpAt?: string;
  returnedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  user?: HydratedUser;
  book?: Book;
};

type HistoryResult = {
  rows: Transaction[];
  booksById: Record<string, Book>;
};

function getHttpErrorDetails(err: any): { status?: number; message: string } {
  const status = err?.response?.status;
  const message =
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    'Request failed';
  return { status, message: String(message) };
}

function getTransactionId(t: Transaction): string {
  return String(t.id || t._id || '');
}

function getUserDisplay(t: Transaction): string {
  const u = t.user;
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (u?.email) return u.email;
  return String(t.userId || '-');
}

function getBookDisplay(t: Transaction): string {
  if (t.book?.title) return t.book.title;
  return String(t.bookId || '-');
}

function getBookDisplayWithHydration(t: Transaction, booksById: Record<string, Book>): string {
  const hydrated = t.bookId ? booksById[t.bookId] : undefined;
  if (hydrated?.title) return hydrated.title;
  return getBookDisplay(t);
}

function getSortTime(t: Transaction): number {
  const raw = t.returnedAt || t.pickedUpAt || t.borrowDate || t.createdAt || t.updatedAt || t.returnDate;
  if (!raw) return 0;
  const d = new Date(raw);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function formatTime(t: Transaction): string {
  const raw = t.returnedAt || t.pickedUpAt || t.borrowDate || t.createdAt || t.updatedAt || t.returnDate;
  if (!raw) return '-';
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-';
}

export default function HistoryPage() {
  const { user, status } = useAuth();

  const role = (user?.role || '').toUpperCase();
  const isStaff = role === 'LIBRARIAN' || role === 'ADMIN';

  const historyQuery = useQuery({
    queryKey: ['transactions', 'history', isStaff ? 'global' : 'user'],
    enabled: status === 'authenticated',
    queryFn: async () => {
      if (isStaff) {
        const res = await apiClient.get('/transactions');
        const data = res.data;
        const rows: Transaction[] = Array.isArray(data) ? data : data?.transactions || [];
        return { rows, booksById: {} } satisfies HistoryResult;
      }

      const userId = await getUserId();
      if (!userId) return { rows: [] as Transaction[], booksById: {} } satisfies HistoryResult;
      const res = await apiClient.get(`/transactions/user/${userId}`);
      const data = res.data;
      const rows: Transaction[] = Array.isArray(data) ? data : data?.transactions || [];

      const uniqueBookIds = Array.from(
        new Set(
          rows
            .map((t) => t.bookId)
            .filter((id): id is string => Boolean(id))
        )
      );

      const bookResults = await Promise.all(
        uniqueBookIds.map(async (bookId) => {
          try {
            const bookRes = await apiClient.get(`/catalog/books/${bookId}`);
            return bookRes.data as Book;
          } catch {
            return null;
          }
        })
      );

      const booksById = bookResults.reduce<Record<string, Book>>((acc, b) => {
        if (b?.id) acc[b.id] = b;
        return acc;
      }, {});

      return { rows, booksById } satisfies HistoryResult;
    },
    retry: false,
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const sortedTransactions = useMemo(() => {
    const result = historyQuery.data;
    const rows = result?.rows || [];
    return [...rows].sort((a, b) => getSortTime(b) - getSortTime(a));
  }, [historyQuery.data]);

  const hydratedBooksById = historyQuery.data?.booksById || {};

  if (status === 'loading') {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80" />
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
        <div className="text-sm text-gray-700">Please sign in to view history.</div>
      </div>
    );
  }

  const errDetails = historyQuery.error ? getHttpErrorDetails(historyQuery.error) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">History</h1>
        <p className="text-sm text-gray-600">
          {isStaff ? 'All recent transactions (staff view).' : 'Your personal transaction history.'}
        </p>
      </div>

      {historyQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">
            Failed to load history{errDetails?.status ? ` (HTTP ${errDetails.status})` : ''}
          </div>
          <div className="mt-1 text-red-800">{errDetails?.message || 'Request failed'}</div>
          {isStaff ? (
            <div className="mt-2 text-xs text-red-700">
              Staff mode expects: <span className="font-mono">GET /api/transactions</span>
            </div>
          ) : (
            <div className="mt-2 text-xs text-red-700">
              Reader mode expects: <span className="font-mono">GET /api/transactions/user/:userId</span>
            </div>
          )}
        </div>
      ) : null}

      {historyQuery.isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : sortedTransactions.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <Clock className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-4 text-base font-medium text-gray-900">No history yet</h3>
          <p className="mt-1 text-sm text-gray-600">No transactions were found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-5 py-3">Book</th>
                {isStaff ? <th className="px-5 py-3">User</th> : null}
                <th className="px-5 py-3">Status</th>
                {isStaff ? <th className="px-5 py-3">Copy</th> : null}
                <th className="px-5 py-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedTransactions.map((t) => {
                const txId = getTransactionId(t);
                const statusValue = String(t.status || '-');

                return (
                  <tr key={txId || `${t.userId}-${t.bookId}-${t.copyId}-${formatTime(t)}`} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">
                        {isStaff ? getBookDisplay(t) : getBookDisplayWithHydration(t, hydratedBooksById)}
                      </div>
                      {t.book?.authors?.length ? (
                        <div className="mt-1 text-xs text-gray-600 line-clamp-1">{t.book.authors.join(', ')}</div>
                      ) : null}
                      {t.book?.isbn ? (
                        <div className="mt-1 text-[11px] text-gray-500">ISBN: {t.book.isbn}</div>
                      ) : null}
                    </td>

                    {isStaff ? <td className="px-5 py-4 text-gray-700">{getUserDisplay(t)}</td> : null}

                    <td className="px-5 py-4 text-gray-700">{statusValue}</td>
                    {isStaff ? <td className="px-5 py-4 text-gray-700">{t.copyId || '-'}</td> : null}
                    <td className="px-5 py-4 text-gray-600">{formatTime(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {isStaff ? (
            <div className="border-t border-gray-100 p-4 text-xs text-gray-500">
              <div className="inline-flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-gray-400" />
                <span>
                  Staff view requires a global transactions endpoint. If you see HTTP 404/403 above, ensure the gateway exposes
                  <span className="mx-1 font-mono">GET /api/transactions</span>.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
