import React from 'react';
import { Link } from 'react-router-dom';

export const PUBLIC_FONT = "'Plus Jakarta Sans', var(--font-sans)";

export const PublicNav: React.FC = () => (
  <nav className="border-b border-white/10 bg-[#1B1A33]">
    <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-8">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-violet-600 via-indigo-600 to-blue-500 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/30">
          H
        </span>
        <span className="text-base font-bold tracking-tight text-white">HireNest</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          to="/jobs"
          className="hidden rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:text-white sm:inline-block"
        >
          All jobs
        </Link>
        <Link
          to="/signin"
          className="rounded-lg border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
        >
          Sign in
        </Link>
      </div>
    </div>
  </nav>
);
