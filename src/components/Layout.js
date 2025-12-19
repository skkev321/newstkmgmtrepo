import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
    return (
        <div className="min-h-screen bg-background font-sans text-foreground">
            <Sidebar />
            <main className="pl-64">
                <div className="container mx-auto p-8 max-w-7xl">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
