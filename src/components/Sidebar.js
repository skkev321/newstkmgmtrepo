import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
    LayoutDashboard,
    Save,
    FileText,
    CreditCard,
    Package,
    TrendingUp,
    Tags,
    History,
    LogOut,
    User
} from 'lucide-react';

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
    const { user, signOut } = useAuth();

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

                <div className="p-4 border-t border-border space-y-4">
                    {user && (
                        <div className="flex items-center gap-3 px-3 py-2 border rounded-lg bg-muted/30">
                            <div className="bg-primary/10 p-1.5 rounded-full">
                                <User className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <div className="overflow-hidden">
                                <p className="text-xs font-medium text-foreground truncate">{user.email}</p>
                                <p className="text-[10px] text-muted-foreground">Admin Access</p>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => signOut()}
                        className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors duration-200"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                    </button>

                    <div className="px-3">
                        <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            System v2.0 Ready
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
