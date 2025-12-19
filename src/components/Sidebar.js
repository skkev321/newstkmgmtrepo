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
    { path: '/', label: 'Business Dashboard', icon: LayoutDashboard },
    { path: '/record-sale', label: 'Record Sale', icon: Save },
    { path: '/record-borrowing', label: 'Record Borrowing', icon: FileText },
    { path: '/pending-payments', label: 'Pending Payments', icon: CreditCard },
    { path: '/stock', label: 'View Stock', icon: Package },
    { path: '/sales', label: 'View Sales', icon: TrendingUp },
    { path: '/bundles', label: 'Manage Bundle Types', icon: Tags },
    { path: '/borrowings', label: 'View Borrowings', icon: History },
];

export default function Sidebar() {
    return (
        <div className="w-64 bg-card border-r h-screen p-4 flex flex-col fixed left-0 top-0 overflow-y-auto">
            <div className="mb-8 px-2">
                <h1 className="text-xl font-bold text-primary">Stock Manager</h1>
            </div>
            <nav className="space-y-2">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                                isActive
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )
                        }
                    >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                    </NavLink>
                ))}
            </nav>
        </div>
    );
}
