'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageCheck, Undo2, ShieldAlert } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import Skeleton from '@/app/components/Skeleton';
import { useAuth } from '@/lib/auth-provider';

type TransactionStatus = 'REQUESTED' | 'ISSUED' | 'RETURN_PENDING' | 'RETURNED' | string;

type HydratedUser = {
  id?: string;
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

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
  user?: HydratedUser;
  book?: Book;
};

type Book = {
  id: string;
  title: string;
  isbn?: string;
  authors?: string[];
};

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

type QueueApiBase = 'api_prefix' | 'no_prefix';

async function getTransactionsViaApiPrefix(status: TransactionStatus): Promise<Transaction[]> {
  const res = await apiClient.get('/transactions', { params: { status } });
  const data = res.data;
  return Array.isArray(data) ? (data as Transaction[]) : (data?.transactions as Transaction[]) || [];
}

async function getTransactionsViaNoPrefix(status: TransactionStatus): Promise<Transaction[]> {
  const res = await axios.get(`${GATEWAY_URL}/transactions`, {
    params: { status },
    withCredentials: true,
  });
  const data = res.data;
  return Array.isArray(data) ? (data as Transaction[]) : (data?.transactions as Transaction[]) || [];
}

async function fetchTransactionsByStatus(
  status: TransactionStatus
): Promise<{ base: QueueApiBase; transactions: Transaction[] }> {
  try {
    const transactions = await getTransactionsViaApiPrefix(status);
    return { base: 'api_prefix', transactions };
  } catch (err: any) {
    if (err?.response?.status === 404) {
      const transactions = await getTransactionsViaNoPrefix(status);
      return { base: 'no_prefix', transactions };
    }
    throw err;
  }
}

function getUserDisplay(t: Transaction): string {
  const u = t.user;
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (u?.email) return u.email;
  return t.userId;
}

function getTransactionId(t: Transaction): string {
  return String(t.id || t._id || '');
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

function TransactionsTable({
  title,
  subtitle,
  transactions,
  actionLabel,
  onAction,
  isActing,
}: {
  title: string;
  subtitle: string;
  transactions: Transaction[];
  actionLabel: ReactNode;
  onAction: (t: Transaction) => void;
  isActing: (t: Transaction) => boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-5">
        <div className="text-base font-semibold text-gray-900">{title}</div>
        <div className="mt-1 text-sm text-gray-600">{subtitle}</div>
      </div>

      {transactions.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-600">Nothing in the queue.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-5 py-3">Book</th>
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Copy</th>
              <th className="px-5 py-3">Time</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {transactions.map((t) => {
              const book = t.book;
              const timeRaw = t.pickedUpAt || t.returnedAt || t.borrowDate || t.returnDate;
              const time = timeRaw ? new Date(timeRaw).toLocaleString() : '-';
              const pending = isActing(t);
              const txId = getTransactionId(t);

              return (
                <tr key={txId || `${t.userId}-${t.bookId}-${t.copyId}`} className="hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-900">{book?.title || `Book ${t.bookId}`}</div>
                    {book?.authors?.length ? (
                      <div className="mt-1 text-xs text-gray-600 line-clamp-1">{book.authors.join(', ')}</div>
                    ) : null}
                    {book?.isbn ? (
                      <div className="mt-1 text-[11px] text-gray-500">ISBN: {book.isbn}</div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-gray-700">{getUserDisplay(t)}</td>
                  <td className="px-5 py-4 text-gray-700">{t.copyId}</td>
                  <td className="px-5 py-4 text-gray-600">{time}</td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => {
                        if (!txId) {
                          toast.error('Missing transaction id');
                          return;
                        }
                        onAction(t);
                      }}
                      disabled={pending || !txId}
                      className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Working...
                        </>
                      ) : (
                        actionLabel
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminQueuePage() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();

  const role = (user?.role || '').toUpperCase();
  const canManageQueue = role === 'LIBRARIAN' || role === 'ADMIN';

  const requestedQuery = useQuery({
    queryKey: ['transactions', 'queue', 'requested'],
    enabled: status === 'authenticated' && canManageQueue,
    queryFn: () => fetchTransactionsByStatus('REQUESTED'),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const issuedQuery = useQuery({
    queryKey: ['transactions', 'queue', 'return-pending'],
    enabled: status === 'authenticated' && canManageQueue,
    queryFn: () => fetchTransactionsByStatus('RETURN_PENDING'),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const confirmIssueMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      await apiClient.patch(`/transactions/${transactionId}/confirm-issue`);
    },
    onSuccess: async () => {
      toast.success('Handover confirmed');
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'queue'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'user'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to confirm handover');
    },
  });

  const confirmReturnMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      await apiClient.patch(`/transactions/${transactionId}/confirm-return`);
    },
    onSuccess: async () => {
      toast.success('Return checked in');
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'queue'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'user'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to check in return');
    },
  });

  const pendingPickups = useMemo(() => requestedQuery.data?.transactions || [], [requestedQuery.data]);
  const pendingReturns = useMemo(() => issuedQuery.data?.transactions || [], [issuedQuery.data]);
  const queueBase: QueueApiBase | null = requestedQuery.data?.base || issuedQuery.data?.base || null;

  if (status === 'loading') {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
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

  const requestedErr = requestedQuery.error;
  const issuedErr = issuedQuery.error;
  const errDetails = requestedErr ? getHttpErrorDetails(requestedErr) : issuedErr ? getHttpErrorDetails(issuedErr) : null;
  const isAuthError = errDetails?.status === 401 || errDetails?.status === 403;

  if (isAuthError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Queue</h1>
          <p className="text-sm text-gray-600">Librarian confirmations for pickups and returns</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-700 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-amber-900">Access restricted</div>
              <div className="mt-1 text-sm text-amber-800">
                Backend rejected this request ({errDetails?.status}). {errDetails?.message}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!canManageQueue) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Queue</h1>
          <p className="text-sm text-gray-600">Librarian confirmations for pickups and returns</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-700 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-amber-900">Access restricted</div>
              <div className="mt-1 text-sm text-amber-800">You need the Librarian role to manage the queue.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isLoading = requestedQuery.isLoading || issuedQuery.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin Queue</h1>
          <p className="text-sm text-gray-600">Librarian confirmations for pickups and returns</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin Queue</h1>
        <p className="text-sm text-gray-600">Librarian confirmations for pickups and returns</p>
      </div>

      {(requestedQuery.isError || issuedQuery.isError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load queue
          {errDetails?.status ? <span className="ml-2">(HTTP {errDetails.status})</span> : null}
          {errDetails?.message ? <div className="mt-1 text-xs text-red-700">{errDetails.message}</div> : null}
        </div>
      )}

      <TransactionsTable
        title="Pending Pickups"
        subtitle="Status: REQUESTED"
        transactions={pendingPickups}
        actionLabel="Confirm Handover"
        onAction={(t) => {
          const txId = getTransactionId(t);
          if (!txId) {
            toast.error('Missing transaction id');
            return;
          }
          confirmIssueMutation.mutate(txId);
        }}
        isActing={(t) => {
          const txId = getTransactionId(t);
          return confirmIssueMutation.isPending && confirmIssueMutation.variables === txId;
        }}
      />

      <TransactionsTable
        title="Pending Returns"
        subtitle="Status: RETURN_PENDING"
        transactions={pendingReturns}
        actionLabel={
          <span className="inline-flex items-center">
            <Undo2 className="mr-2 h-4 w-4" />
            Check In
          </span>
        }
        onAction={(t) => {
          const txId = getTransactionId(t);
          if (!txId) {
            toast.error('Missing transaction id');
            return;
          }
          confirmReturnMutation.mutate(txId);
        }}
        isActing={(t) => {
          const txId = getTransactionId(t);
          return confirmReturnMutation.isPending && confirmReturnMutation.variables === txId;
        }}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <PackageCheck className="h-5 w-5 text-gray-700 mt-0.5" />
          <div className="text-sm text-gray-700">
            Powered by:
            <span className="ml-1 font-medium text-gray-900">GET /transactions?status=...</span>
            <span className="mx-1 text-gray-400">and</span>
            <span className="font-medium text-gray-900">PATCH /transactions/:id/confirm-issue</span>
            <span className="mx-1 text-gray-400">/</span>
            <span className="font-medium text-gray-900">confirm-return</span>.
            {queueBase ? (
              <div className="mt-1 text-xs text-gray-500">
                Using route base: {queueBase === 'api_prefix' ? '/api/transactions' : '/transactions'}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
