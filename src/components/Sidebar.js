import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    Save,
    FileText,
    CreditCard,
    Package,
    TrendingUp,
    Tags,
    History
} from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/record-sale', label: 'Record Sale', icon: Save },
    { path: '/record-borrowing', label: 'Record Borrowing', icon: FileText },
    { path: '/pending-payments', label: 'Pending Payments', icon: CreditCard },
    { path: '/stock', label: 'Stock Inventory', icon: Package },
    { path: '/sales', label: 'Sales History', icon: TrendingUp },
    { path: '/bundles', label: 'Bundle Types', icon: Tags },
    { path: '/borrowings', label: 'Borrowing History', icon: History },
];

export default function Sidebar({ isOpen, onClose }) {
    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
                    onClick={onClose}
                />
            )}

            <div className={cn(
                "w-64 bg-card border-r border-border h-screen flex flex-col fixed left-0 top-0 overflow-y-auto z-50 transition-transform duration-300 ease-in-out md:translate-x-0",
                isOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="h-16 flex items-center px-6 border-b border-border mb-4">
                    <div className="flex items-center gap-2 font-bold text-xl text-primary tracking-tight">
                        <Package className="h-6 w-6" />
                        <span>StockManager</span>
                    </div>
                </div>

                <nav className="flex-1 px-3 space-y-1">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => onClose && onClose()} // Close on navigation on mobile
                            className={({ isActive }) =>
                                cn(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium",
                                    "hover:bg-accent hover:text-accent-foreground ease-in-out",
                                    isActive
                                        ? "bg-primary/10 text-primary hover:bg-primary/15"
                                        : "text-muted-foreground"
                                )
                            }
                        >
                            <item.icon className={cn("h-4 w-4", ({ isActive }) => isActive ? "text-primary" : "text-muted-foreground")} />
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="p-4 border-t border-border">
                    <div className="px-3 py-2">
                        <p className="text-xs text-muted-foreground font-medium">v1.0.0</p>
                    </div>
                </div>
            </div>
        </>
    );
}
