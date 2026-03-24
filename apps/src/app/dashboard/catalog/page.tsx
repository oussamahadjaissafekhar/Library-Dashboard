'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, User, Search, Loader2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import apiClient from '@/lib/api';
import { getUserId } from '@/lib/auth';
import { useAuth } from '@/lib/auth-provider';
import Skeleton from '@/app/components/Skeleton';
import { toast } from 'sonner';

interface BookAvailability {
  availableCopies: number;
  totalCopies: number;
}

interface Book {
  id: string;
  isbn: string;
  title: string;
  authors: string[];
  coverImage?: string;
  category?: string;
  description?: string;
  intro?: string;
  introduction?: string;
  coverImageUrl?: string;
  publishedYear?: number;
  publisher?: string;
  language?: string;
  availability?: BookAvailability;
}

interface CopyInfo {
  copyId: string;
  status: string;
}

interface AvailabilityResponse {
  bookId: string;
  availableCopies: number;
  totalCopies: number;
  copies?: CopyInfo[];
}

interface Transaction {
  id: string;
  status?: string;
}

export default function CatalogPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [filteredBooks, setFilteredBooks] = useState<Book[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'title-asc' | 'availability-desc'>('relevance');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const role = (user?.role || '').toUpperCase();
  const canRequestBorrow = role !== 'LIBRARIAN' && role !== 'ADMIN';

  const getCoverUrl = (book: Book): string => {
    if (book.coverImage && book.coverImage.trim()) return book.coverImage;
    if (book.coverImageUrl && book.coverImageUrl.trim()) return book.coverImageUrl;
    if (book.isbn && book.isbn.trim()) {
      return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(book.isbn)}-L.jpg`;
    }
    return '';
  };

  const getLongDescription = (book: Book): string => {
    const v = book.description || book.intro || book.introduction;
    return v?.trim() ? v : '';
  };

  const categories = useMemo((): string[] => {
    const set = new Set(
      books
        .map((b) => b.category)
        .filter((c): c is string => Boolean(c && c.trim()))
        .map((c) => c.trim())
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books]);

  // Filter books based on search query + filters
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();

    let next = books;

    if (query) {
      next = next.filter((book) => {
        const titleMatch = book.title.toLowerCase().includes(query);
        const authorMatch = book.authors.some((author) => author.toLowerCase().includes(query));
        const isbnMatch = (book.isbn || '').toLowerCase().includes(query);
        return titleMatch || authorMatch || isbnMatch;
      });
    }

    if (selectedCategory !== 'all') {
      next = next.filter((b) => (b.category || '').trim() === selectedCategory);
    }

    if (onlyAvailable) {
      next = next.filter(
        (b) => (b.availability?.availableCopies || 0) > 0 && (b.availability?.totalCopies || 0) > 0
      );
    }

    if (sortBy === 'title-asc') {
      next = [...next].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'availability-desc') {
      next = [...next].sort(
        (a, b) => (b.availability?.availableCopies || 0) - (a.availability?.availableCopies || 0)
      );
    }

    setFilteredBooks(next);
  }, [searchQuery, books, selectedCategory, onlyAvailable, sortBy]);

  const booksQuery = useQuery({
    queryKey: ['catalog', 'books'],
    queryFn: async () => {
      const response = await apiClient.get('/catalog/books');
      const booksData: Book[] = response.data || [];

      const availabilityResponses = await Promise.all(
        booksData.map(async (book) => {
          try {
            const res = await apiClient.get<AvailabilityResponse>(`/inventory/copies/book/${book.id}`);
            return res.data;
          } catch {
            return null;
          }
        })
      );

      return booksData.map((book) => {
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
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (booksQuery.data) {
      setBooks(booksQuery.data);
      setFilteredBooks(booksQuery.data);
    }
  }, [booksQuery.data]);

  const getAvailableCopyId = async (bookId: string): Promise<string | null> => {
    try {
      const response = await apiClient.get<AvailabilityResponse>(
        `/inventory/copies/book/${bookId}`
      );
      const availableCopy = response.data.copies?.find(
        (copy) => copy.status === 'AVAILABLE'
      );
      return availableCopy?.copyId || null;
    } catch (err) {
      console.error('Error fetching available copies:', err);
      return null;
    }
  };

  const borrowMutation = useMutation({
    mutationFn: async (bookId: string) => {
      const userId = await getUserId();
      if (!userId) {
        throw new Error('User ID not found. Please log in again.');
      }

      try {
        const txRes = await apiClient.get(`/transactions/user/${userId}`);
        const transactions: Transaction[] = Array.isArray(txRes.data)
          ? txRes.data
          : txRes.data?.transactions || [];
        const activeCount = transactions.filter(
          (t) =>
            t.status === 'REQUESTED' ||
            t.status === 'ISSUED' ||
            t.status === 'RETURN_PENDING' ||
            t.status === 'BORROWED'
        ).length;
        if (activeCount >= 3) {
          throw new Error('Borrow limit reached (max 3). Return a book before borrowing another.');
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message;
        if (msg) {
          throw new Error(msg);
        }
      }

      const copyId = await getAvailableCopyId(bookId);
      if (!copyId) {
        throw new Error('No available copies found');
      }

      await apiClient.post('/transactions/borrow', {
        bookId,
        copyId,
        userId,
      });
    },
    onSuccess: async () => {
      toast.success('Book borrowed successfully');
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'books'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions', 'user'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to borrow book');
    },
  });

  const isBookAvailable = (book: Book): boolean => {
    return (
      book.availability !== undefined &&
      book.availability.availableCopies > 0 &&
      book.availability.totalCopies > 0
    );
  };

  if (booksQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-start justify-between">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <div className="mt-6 space-y-3">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Catalog</h1>
            <p className="text-sm text-gray-600">Browse and borrow books</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by title or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">Category</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
              >
                <option value="all">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-gray-900"
              />
              <span className="text-xs font-medium">Only available</span>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
              >
                <option value="relevance">Relevance</option>
                <option value="title-asc">Title (A-Z)</option>
                <option value="availability-desc">Availability</option>
              </select>
            </div>

            {(selectedCategory !== 'all' || onlyAvailable || sortBy !== 'relevance') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('all');
                  setOnlyAvailable(false);
                  setSortBy('relevance');
                }}
                className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 hover:bg-gray-50"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {booksQuery.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to fetch books
        </div>
      )}

      {filteredBooks.length === 0 && !booksQuery.isLoading && (
        <div className="text-center py-12">
          <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {searchQuery ? 'No books found matching your search' : 'No books found'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchQuery
              ? 'Try adjusting your search terms'
              : 'There are no books in the catalog yet.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredBooks.map((book) => {
          const isAvailable = isBookAvailable(book);
          const isBorrowing = borrowMutation.isPending && borrowMutation.variables === book.id;
          const canBorrow = isAvailable && !isBorrowing;
          const coverUrl = getCoverUrl(book);
          const canRequestThis = canRequestBorrow && canBorrow;

          return (
            <motion.div
              key={book.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedBook(book)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedBook(book);
              }}
              className="group bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="relative">
                <div className="aspect-[3/4] bg-gradient-to-br from-gray-50 to-gray-100">
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl}
                      alt={book.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <BookOpen className="h-10 w-10 text-gray-400" />
                    </div>
                  )}
                </div>

                <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/90 backdrop-blur px-3 py-1 text-xs font-medium text-gray-700 border border-white/60 shadow-sm">
                    <BookOpen className="h-3.5 w-3.5 text-gray-700" />
                    <span className="line-clamp-1">Book</span>
                  </div>

                  {book.availability && (
                    <div
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border shadow-sm backdrop-blur ${
                        book.availability.availableCopies > 0
                          ? 'bg-green-50/90 text-green-800 border-green-200'
                          : 'bg-red-50/90 text-red-800 border-red-200'
                      }`}
                    >
                      {book.availability.availableCopies}/{book.availability.totalCopies}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5 flex flex-col flex-1">
                <h3 className="text-base font-semibold text-gray-900 line-clamp-2">
                  {book.title}
                </h3>

                {book.authors && book.authors.length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center text-xs text-gray-500">
                      <User className="h-3.5 w-3.5 mr-1" />
                      <span className="font-medium">
                        Author{book.authors.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 line-clamp-2">
                      {book.authors.join(', ')}
                    </div>
                  </div>
                )}

                {getLongDescription(book) ? (
                  <p className="mt-3 text-sm text-gray-600 line-clamp-3">
                    {getLongDescription(book)}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-gray-500 line-clamp-3">
                    Click to view full details.
                  </p>
                )}

                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-gray-500 truncate">ISBN: {book.isbn}</p>
                    <span className="text-[11px] text-gray-500">Details</span>
                  </div>

                  {canRequestBorrow ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        borrowMutation.mutate(book.id);
                      }}
                      disabled={!canRequestThis}
                      className={`mt-3 w-full py-2.5 px-4 rounded-xl font-medium transition-colors flex items-center justify-center ${
                        canRequestThis
                          ? 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:ring-offset-2'
                          : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {isBorrowing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Requesting...
                        </>
                      ) : isAvailable ? (
                        'Request Borrow'
                      ) : (
                        'Not Available'
                      )}
                    </button>
                  ) : (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      Librarian accounts can’t request borrows.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedBook && (
          <motion.div
            className="fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            onClick={() => setSelectedBook(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
            <div className="absolute inset-0 overflow-y-auto">
              <div className="min-h-full flex items-end sm:items-center justify-center p-4">
                <motion.div
                  className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                  initial={{ opacity: 0, y: 18, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 18, scale: 0.985 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-gray-900 line-clamp-2">
                        {selectedBook.title}
                      </h2>
                      {selectedBook.authors?.length ? (
                        <p className="mt-1 text-sm text-gray-600 line-clamp-1">
                          {selectedBook.authors.join(', ')}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedBook(null)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-[220px,1fr] gap-5">
                      <div>
                        <div className="aspect-[3/4] rounded-xl overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-100">
                          {getCoverUrl(selectedBook) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={getCoverUrl(selectedBook)}
                              alt={selectedBook.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <BookOpen className="h-10 w-10 text-gray-400" />
                            </div>
                          )}
                        </div>

                        {selectedBook.availability && (
                          <div className="mt-3">
                            <div
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${
                                selectedBook.availability.availableCopies > 0
                                  ? 'bg-green-50 text-green-800 border-green-200'
                                  : 'bg-red-50 text-red-800 border-red-200'
                              }`}
                            >
                              {selectedBook.availability.availableCopies}/{selectedBook.availability.totalCopies} available
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                            <div className="text-xs font-medium text-gray-500">ISBN</div>
                            <div className="mt-1 text-sm text-gray-900 break-words">{selectedBook.isbn}</div>
                          </div>
                          <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                            <div className="text-xs font-medium text-gray-500">Publisher</div>
                            <div className="mt-1 text-sm text-gray-900 break-words">{selectedBook.publisher || '—'}</div>
                          </div>
                          <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                            <div className="text-xs font-medium text-gray-500">Published Year</div>
                            <div className="mt-1 text-sm text-gray-900 break-words">
                              {selectedBook.publishedYear ? String(selectedBook.publishedYear) : '—'}
                            </div>
                          </div>
                          <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                            <div className="text-xs font-medium text-gray-500">Language</div>
                            <div className="mt-1 text-sm text-gray-900 break-words">{selectedBook.language || '—'}</div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="text-sm font-semibold text-gray-900">Description</div>
                          {getLongDescription(selectedBook) ? (
                            <p className="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                              {getLongDescription(selectedBook)}
                            </p>
                          ) : (
                            <p className="mt-2 text-sm text-gray-500">
                              No description available for this book yet.
                            </p>
                          )}
                        </div>

                        <div className="mt-5">
                          {canRequestBorrow ? (
                            <button
                              onClick={() => borrowMutation.mutate(selectedBook.id)}
                              disabled={!isBookAvailable(selectedBook) || (borrowMutation.isPending && borrowMutation.variables === selectedBook.id)}
                              className={`w-full py-2.5 px-4 rounded-xl font-medium transition-colors flex items-center justify-center ${
                                isBookAvailable(selectedBook)
                                  ? 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:ring-offset-2'
                                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              {borrowMutation.isPending && borrowMutation.variables === selectedBook.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Requesting...
                                </>
                              ) : isBookAvailable(selectedBook) ? (
                                'Request Borrow'
                              ) : (
                                'Not Available'
                              )}
                            </button>
                          ) : (
                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                              Librarian accounts can’t request borrows.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
