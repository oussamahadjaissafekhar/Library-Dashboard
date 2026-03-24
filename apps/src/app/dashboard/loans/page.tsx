"use client";

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library, Loader2 } from 'lucide-react';
import { ShieldAlert } from 'lucide-react';
import axios from 'axios';
import Cookies from 'js-cookie';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { getUserId } from '@/lib/auth';
import Skeleton from '@/app/components/Skeleton';
import { useAuth } from '@/lib/auth-provider';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

function getTokenForFallback(): string | null {
  if (typeof window === 'undefined') return null;

  const cookieToken = Cookies.get('token');
  if (cookieToken) return cookieToken;

  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

function getHttpErrorDetails(err: any): { status?: number; message: string } {
  const status = err?.response?.status;
  const message =
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    'Request failed';
  return { status, message: String(message) };
}

type TransactionStatus = 'REQUESTED' | 'ISSUED' | 'RETURN_PENDING' | 'RETURNED' | 'BORROWED' | string;

type Transaction = {
  id?: string;
  _id?: string;
  bookId: string;
  copyId: string;
  userId: string;
  status: TransactionStatus;
  borrowDate?: string;
  returnDate?: string;
  pickedUpAt?: string;
  returnedAt?: string;
};

type Book = {
  id: string;
  title: string;
};

function getTransactionId(t: Transaction): string {
  return String(t.id || t._id || '');
}

export default function LoansPage() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();

  const role = (user?.role || '').toUpperCase();
  const isStaff = role === 'LIBRARIAN' || role === 'ADMIN';

  const canViewLoans = status === 'authenticated' && !isStaff;

  const loansQuery = useQuery({
    queryKey: ['transactions', 'user'],
    enabled: canViewLoans,
    queryFn: async () => {
      const userId = await getUserId();
      if (!userId) return { active: [] as Transaction[], booksById: {} as Record<string, Book> };

      const res = await apiClient.get(`/transactions/user/${userId}`);
      const transactions: Transaction[] = Array.isArray(res.data) ? res.data : res.data?.transactions || [];
      const active = transactions.filter(
        (t) =>
          t.status === 'REQUESTED' ||
          t.status === 'ISSUED' ||
          t.status === 'RETURN_PENDING' ||
          t.status === 'BORROWED'
      );

      const uniqueBookIds = Array.from(new Set(active.map((t) => t.bookId)));
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

      return { active, booksById };
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const returnMutation = useMutation({
    mutationFn: async (params: { transactionId: string; copyId: string }) => {
      const userId = await getUserId();
      if (!userId) throw new Error('User ID not found. Please log in again.');

      try {
        // New flow: user requests a return; librarian confirms later
        await apiClient.patch(`/transactions/${params.transactionId}/request-return`, {
          transactionId: params.transactionId,
          userId,
        });
      } catch (err: any) {
        // Backward-compatible fallback for older backend versions without request-return
        if (err?.response?.status === 404 || err?.response?.status === 405) {
          try {
            await apiClient.post('/transactions/return', { transactionId: params.transactionId, userId });
            return;
          } catch (innerErr: any) {
            // Older backend may only accept copyId
            if (innerErr?.response?.status === 400 || innerErr?.response?.status === 404) {
              await apiClient.post('/transactions/return', { copyId: params.copyId, userId });
              return;
            }

            // Gateway path mismatch fallback: /api may not exist in some runs
            if (innerErr?.response?.status === 404 || innerErr?.response?.status === 405) {
              const token = getTokenForFallback();
              await axios.post(
                `${GATEWAY_URL}/transactions/return`,
                { transactionId: params.transactionId, userId },
                {
                  withCredentials: true,
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                }
              );
              return;
            }

            throw innerErr;
          }
        }

        throw err;
      }
    },
    onSuccess: async () => {
      toast.success('Return requested');
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'user'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
    },
    onError: (err: any) => {
      const d = getHttpErrorDetails(err);
      toast.error(`${d.message}${d.status ? ` (HTTP ${d.status})` : ''}`);
    },
  });

  if (status === 'loading') {
    return null;
  }

  if (status !== 'authenticated') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="text-sm text-gray-700">Please sign in to view this page.</div>
      </div>
    );
  }

  if (isStaff) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-red-700" />
          <div>
            <div className="text-sm font-semibold text-red-900">Access restricted</div>
            <div className="mt-1 text-sm text-red-800">My Loans is not available for librarian/admin accounts.</div>
          </div>
        </div>
      </div>
    );
  }

  if (loansQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    );
  }

  const active = loansQuery.data?.active || [];
  const booksById = loansQuery.data?.booksById || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">My Loans</h1>
        <p className="text-sm text-gray-600">Current active borrowings</p>
      </div>

      {loansQuery.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load loans
        </div>
      )}

      {active.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <Library className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-4 text-base font-medium text-gray-900">No active loans</h3>
          <p className="mt-1 text-sm text-gray-600">You don't have any active loans at the moment.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Issued</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {active.map((t) => {
                const title = booksById[t.bookId]?.title || `Book ${t.bookId}`;
                const issuedAtRaw = t.pickedUpAt || t.borrowDate;
                const issuedAt = issuedAtRaw ? new Date(issuedAtRaw).toLocaleDateString() : '-';
                const txId = getTransactionId(t);
                const isReturning = returnMutation.isPending && returnMutation.variables?.transactionId === txId;
                const isIssued = t.status === 'ISSUED' || t.status === 'BORROWED';
                const isReturnPending = t.status === 'RETURN_PENDING';

                const statusLabel =
                  t.status === 'REQUESTED'
                    ? 'Requested'
                  : t.status === 'ISSUED'
                      ? 'Issued'
                      : t.status === 'RETURN_PENDING'
                        ? 'Return Pending'
                      : t.status === 'BORROWED'
                        ? 'Issued'
                        : t.status === 'RETURNED'
                          ? 'Returned'
                          : t.status;

                const statusTone =
                  t.status === 'REQUESTED'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : t.status === 'ISSUED' || t.status === 'BORROWED'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : t.status === 'RETURN_PENDING'
                        ? 'bg-purple-50 text-purple-800 border-purple-200'
                      : t.status === 'RETURNED'
                        ? 'bg-green-50 text-green-800 border-green-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200';

                return (
                  <tr key={txId || `${t.userId}-${t.bookId}-${t.copyId}`} className="hover:bg-gray-50">
                    <td className="px-5 py-4 font-medium text-gray-900">{title}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-2">
                        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone}`}>
                          {statusLabel}
                        </span>
                        {t.status === 'REQUESTED' && (
                          <span className="text-xs text-gray-600">
                            Please visit the library to collect your book.
                          </span>
                        )}
                        {t.status === 'RETURN_PENDING' && (
                          <span className="text-xs text-gray-600">
                            Return requested. Please hand the book to the librarian for confirmation.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{issuedAt}</td>
                    <td className="px-5 py-4 text-right">
                      {isIssued ? (
                        <button
                          onClick={() => {
                            if (!txId) {
                              toast.error('Missing transaction id');
                              return;
                            }
                            returnMutation.mutate({ transactionId: txId, copyId: t.copyId });
                          }}
                          disabled={isReturning || !txId}
                          className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isReturning ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Requesting...
                            </>
                          ) : (
                            'Request Return'
                          )}
                        </button>
                      ) : isReturnPending ? (
                        <span className="text-xs text-gray-500">Awaiting librarian</span>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

