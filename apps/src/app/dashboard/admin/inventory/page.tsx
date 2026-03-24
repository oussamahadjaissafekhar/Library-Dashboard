'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Loader2, Plus, Pencil, ShieldAlert, X, Minus } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import Skeleton from '@/app/components/Skeleton';
import { useAuth } from '@/lib/auth-provider';

type Book = {
  id: string;
  title: string;
  isbn?: string;
  authors?: string[];
  category?: string;
  description?: string;
  introduction?: string;
};

type AvailabilityResponse = {
  bookId: string;
  availableCopies: number;
  totalCopies: number;
};

type BookWithInventory = Book & {
  availability?: {
    availableCopies: number;
    totalCopies: number;
  };
};

type FormState = {
  title: string;
  author: string;
  isbn: string;
  category: string;
  description: string;
  initialCopies: string;
};

const emptyForm: FormState = {
  title: '',
  author: '',
  isbn: '',
  category: '',
  description: '',
  initialCopies: '1',
};

function isValidIsbn(v: string): boolean {
  const s = v.replace(/[-\s]/g, '').toUpperCase();
  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const n = Number(s[i]);
      if (!Number.isFinite(n)) return false;
      sum += (10 - i) * n;
    }
    const last = s[9] === 'X' ? 10 : Number(s[9]);
    if (!Number.isFinite(last)) return false;
    sum += last;
    return sum % 11 === 0;
  }

  if (s.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const n = Number(s[i]);
      if (!Number.isFinite(n)) return false;
      sum += i % 2 === 0 ? n : n * 3;
    }
    return sum % 10 === 0;
  }

  return false;
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

function normalizeAuthors(authorInput: string): string[] {
  const parts = authorInput
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [];
}

function validateForm(values: FormState): string | null {
  if (!values.title.trim()) return 'Title is required.';
  if (!values.author.trim()) return 'Author is required.';
  if (!values.isbn.trim()) return 'ISBN is required.';
  if (!isValidIsbn(values.isbn)) return 'ISBN is not valid (ISBN-10 or ISBN-13).';
  if (!values.category.trim()) return 'Category is required.';
  if (!values.description.trim()) return 'Description is required.';

  const n = Number(values.initialCopies);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return 'Number of initial copies must be a whole number (0 or more).';
  }

  return null;
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="text-base font-semibold text-gray-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();

  const role = (user?.role || '').toUpperCase();
  const canManageInventory = role === 'LIBRARIAN';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<BookWithInventory | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const booksQuery = useQuery({
    queryKey: ['admin', 'inventory', 'books'],
    enabled: status === 'authenticated' && canManageInventory,
    queryFn: async () => {
      const response = await apiClient.get('/catalog/books');
      const books: Book[] = response.data || [];

      const availabilityResponses = await Promise.all(
        books.map(async (book) => {
          try {
            const res = await apiClient.get<AvailabilityResponse>(`/inventory/copies/book/${book.id}`);
            return res.data;
          } catch {
            return null;
          }
        })
      );

      return books.map<BookWithInventory>((book) => {
        const availability = availabilityResponses.find((a) => a?.bookId === book.id);
        if (!availability) return book;
        return {
          ...book,
          availability: {
            availableCopies: availability.availableCopies,
            totalCopies: availability.totalCopies,
          },
        };
      });
    },
    retry: false,
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const books = useMemo(() => booksQuery.data || [], [booksQuery.data]);

  const openCreate = () => {
    setMode('create');
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (book: BookWithInventory) => {
    setMode('edit');
    setEditing(book);
    setForm({
      title: book.title || '',
      author: (book.authors || []).join(', '),
      isbn: book.isbn || '',
      category: book.category || '',
      description: (book.description || book.introduction || '').trim(),
      initialCopies: String(book.availability?.totalCopies ?? 0),
    });
    setOpen(true);
  };

  const createBookMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const error = validateForm(values);
      if (error) throw new Error(error);

      const createRes = await apiClient.post('/catalog/books', {
        title: values.title.trim(),
        isbn: values.isbn.replace(/[\s-]/g, ''),
        authors: normalizeAuthors(values.author),
        category: values.category.trim(),
        description: values.description.trim(),
      });

      const created = createRes.data;
      const bookId: string = created?.id || created?.bookId;
      if (!bookId) {
        throw new Error('Book created but no bookId returned from backend.');
      }

      const count = Number(values.initialCopies);
      if (Number.isFinite(count) && count > 0) {
        for (let i = 0; i < count; i++) {
          await apiClient.post(`/inventory/copies/${bookId}`);
        }
      }

      return bookId;
    },
    onSuccess: async () => {
      toast.success('Book added successfully');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'books'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to add book');
    },
  });

  const updateBookMutation = useMutation({
    mutationFn: async (values: FormState) => {
      if (!editing?.id) throw new Error('No book selected for editing.');

      const baseError = (() => {
        if (!values.title.trim()) return 'Title is required.';
        if (!values.author.trim()) return 'Author is required.';
        if (!values.isbn.trim()) return 'ISBN is required.';
        if (!isValidIsbn(values.isbn)) return 'ISBN is not valid (ISBN-10 or ISBN-13).';
        if (!values.category.trim()) return 'Category is required.';
        if (!values.description.trim()) return 'Description is required.';
        return null;
      })();
      if (baseError) throw new Error(baseError);

      await apiClient.patch(`/catalog/books/${editing.id}`, {
        title: values.title.trim(),
        isbn: values.isbn.replace(/[\s-]/g, ''),
        authors: normalizeAuthors(values.author),
        category: values.category.trim(),
        description: values.description.trim(),
      });

      const desiredTotal = Number(values.initialCopies);
      const currentTotal = Number(editing.availability?.totalCopies ?? 0);

      if (Number.isFinite(desiredTotal) && Number.isInteger(desiredTotal) && desiredTotal > currentTotal) {
        const toAdd = desiredTotal - currentTotal;
        for (let i = 0; i < toAdd; i++) {
          await apiClient.post(`/inventory/copies/${editing.id}`);
        }
      } else if (
        Number.isFinite(desiredTotal) &&
        Number.isInteger(desiredTotal) &&
        desiredTotal < currentTotal
      ) {
        throw new Error(
          'Decreasing total copies is not supported by the current Inventory API (no LOST/REMOVED status).'
        );
      }

      return true;
    },
    onSuccess: async () => {
      toast.success('Book updated');
      setOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'books'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to update book');
    },
  });

  const addCopyMutation = useMutation({
    mutationFn: async (bookId: string) => {
      await apiClient.post(`/inventory/copies/${bookId}`);
    },
    onSuccess: async () => {
      toast.success('Copy added');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'books'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to add copy');
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

  if (!canManageInventory) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-red-700" />
          <div>
            <div className="text-sm font-semibold text-red-900">Access restricted</div>
            <div className="mt-1 text-sm text-red-800">This page is only available to librarian accounts.</div>
          </div>
        </div>
      </div>
    );
  }

  const errDetails = booksQuery.error ? getHttpErrorDetails(booksQuery.error) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-gray-800" />
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Inventory</h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">Create and edit books and manage physical copies.</p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" />
          Add Book
        </button>
      </div>

      {booksQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Failed to load catalog{errDetails?.status ? ` (HTTP ${errDetails.status})` : ''}</div>
          <div className="mt-1 text-red-800">{errDetails?.message || 'Request failed'}</div>
        </div>
      ) : null}

      {booksQuery.isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
              <tr>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Author(s)</th>
                <th className="px-5 py-3">ISBN</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Available</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {books.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-gray-600" colSpan={7}>
                    No books found.
                  </td>
                </tr>
              ) : (
                books.map((b) => {
                  const total = b.availability?.totalCopies ?? 0;
                  const available = b.availability?.availableCopies ?? 0;
                  const isAdding = addCopyMutation.isPending && addCopyMutation.variables === b.id;

                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 font-medium text-gray-900">{b.title}</td>
                      <td className="px-5 py-4 text-gray-700">{(b.authors || []).join(', ') || '-'}</td>
                      <td className="px-5 py-4 text-gray-700">{b.isbn || '-'}</td>
                      <td className="px-5 py-4 text-gray-700">{b.category || '-'}</td>
                      <td className="px-5 py-4 text-gray-700">
                        <div className="inline-flex items-center gap-2">
                          <span className="min-w-[2ch] text-gray-900">{total}</span>
                          <button
                            type="button"
                            onClick={() => addCopyMutation.mutate(b.id)}
                            disabled={isAdding}
                            className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1.5 text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Add copy"
                            title="Add copy"
                          >
                            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => toast.error('Decreasing total copies is not supported by the current Inventory API.')}
                            className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1.5 text-gray-400"
                            aria-label="Remove copy"
                            title="Remove copy (not supported)"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{available}</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(b)}
                          className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                        >
                          <Pencil className="mr-2 h-4 w-4 text-gray-600" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title={mode === 'create' ? 'Add Book' : 'Edit Book'}
        onClose={() => {
          if (createBookMutation.isPending || updateBookMutation.isPending) return;
          setOpen(false);
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'create') {
              createBookMutation.mutate(form);
            } else {
              updateBookMutation.mutate(form);
            }
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-900">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="The Pragmatic Programmer"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-900">Author</label>
              <input
                value={form.author}
                onChange={(e) => setForm((p) => ({ ...p, author: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="Andy Hunt, Dave Thomas"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-900">ISBN</label>
              <input
                value={form.isbn}
                onChange={(e) => setForm((p) => ({ ...p, isbn: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="9780135957059"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-900">Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
                placeholder="Software Engineering"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-900">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="min-h-28 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
              placeholder="Short summary of the book…"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-900">
                {mode === 'create' ? 'Number of initial copies' : 'Total copies'}
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.initialCopies}
                onChange={(e) => setForm((p) => ({ ...p, initialCopies: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-900"
              />
              {mode === 'edit' ? (
                <div className="text-xs text-gray-500">
                  Lowering total is not supported by the current Inventory API.
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={createBookMutation.isPending || updateBookMutation.isPending}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createBookMutation.isPending || updateBookMutation.isPending}
              className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createBookMutation.isPending || updateBookMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                'Create Book'
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
