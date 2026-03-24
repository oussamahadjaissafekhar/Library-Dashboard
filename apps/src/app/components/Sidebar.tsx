'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Library, Settings, LogOut, LayoutDashboard, Clock, ClipboardList, Users, Boxes } from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import { motion } from 'framer-motion';

export default function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  const role = (user?.role || '').toUpperCase();
  const canManageQueue = role === 'LIBRARIAN' || role === 'ADMIN';
  const canManageInventory = role === 'LIBRARIAN';

  const navItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Stats overview',
    },
    {
      href: '/dashboard/catalog',
      label: 'Catalog',
      icon: BookOpen,
      description: 'View all books',
    },
    {
      href: '/dashboard/history',
      label: 'History',
      icon: Clock,
      description: 'Past transactions',
    },
    ...(!canManageQueue
      ? [
          {
            href: '/dashboard/loans',
            label: 'My Loans',
            icon: Library,
            description: 'Current borrowings',
          },
        ]
      : []),
    ...(canManageQueue
      ? [
          {
            href: '/dashboard/admin/queue',
            label: 'Admin Queue',
            icon: ClipboardList,
            description: 'Pickups & returns',
          },
          {
            href: '/dashboard/admin/accounts',
            label: 'Admin Accounts',
            icon: Users,
            description: 'Debug users list',
          },
        ]
      : []),
    ...(canManageInventory
      ? [
          {
            href: '/dashboard/admin/inventory',
            label: 'Inventory',
            icon: Boxes,
            description: 'Create & edit books',
          },
        ]
      : []),
    ...(canManageQueue
      ? [
          {
            href: '/dashboard/admin',
            label: 'Admin',
            icon: Settings,
            description: 'Manage Inventory',
          },
        ]
      : []),
  ];

  return (
    <motion.div
      className="flex h-screen flex-col border-r border-gray-200 bg-white"
      animate={{ width: collapsed ? 72 : 288 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
    >
      <div className={`flex h-14 items-center ${collapsed ? 'px-3' : 'px-6'}`}>
        <div className="text-sm font-semibold tracking-tight text-gray-900">Library</div>
        {!collapsed && <div className="ml-2 text-sm text-gray-500">Dashboard</div>}
      </div>
      
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
          
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`relative group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-white/90" />
              )}
              <div className={collapsed ? 'flex w-full items-center justify-center' : ''}>
                <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-gray-900'}`} />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${isActive ? 'text-white' : 'text-gray-900'}`}>{item.label}</div>
                  <div className={`text-xs ${isActive ? 'text-gray-200/90' : 'text-gray-500'}`}>{item.description}</div>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-gray-200">
        <button
          onClick={() => logout()}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-gray-700 transition-colors hover:bg-gray-100 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="h-5 w-5 text-gray-500" />
          {!collapsed && <span className="text-sm font-medium text-gray-900">Logout</span>}
        </button>
      </div>
    </motion.div>
  );
}

