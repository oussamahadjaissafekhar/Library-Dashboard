"use client";

import { Settings } from 'lucide-react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';

export default function AdminPage() {
  const { user, status } = useAuth();

  const role = (user?.role || '').toUpperCase();
  const canManage = role === 'LIBRARIAN' || role === 'ADMIN';

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

  if (!canManage) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
        <p className="text-sm text-gray-600">Inventory management (coming soon).</p>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <Settings className="mx-auto h-10 w-10 text-gray-400" />
        <h3 className="mt-4 text-base font-medium text-gray-900">Coming Soon</h3>
        <p className="mt-1 text-sm text-gray-600">
          This area will include book creation, copy management, and admin-only tools.
        </p>
      </div>
    </div>
  );
}

