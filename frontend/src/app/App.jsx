import { Link, NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';
import CreateMigration from './CreateMigration.jsx';
import MigrationDetail from './MigrationDetail.jsx';
import { EmptyState } from '../components/ui.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-[#F8F6F1]">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-6 items-center justify-center rounded bg-accent text-white" aria-hidden="true">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h8M8 5l3 3-3 3" /></svg>
            </span>
            Migration Workbench
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" end className={({ isActive }) => `rounded px-3 py-1.5 ${isActive ? 'bg-paper font-medium' : 'text-muted hover:text-ink'}`}>Dashboard</NavLink>
            <NavLink to="/new" className={({ isActive }) => `rounded px-3 py-1.5 ${isActive ? 'bg-paper font-medium' : 'text-muted hover:text-ink'}`}>New migration</NavLink>
          </nav>
        </div>
      </header>
      

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<CreateMigration />} />
          <Route path="/migrations/:id" element={<MigrationDetail />} />
          <Route path="*" element={<EmptyState title="Page not found">Check the address or go back to the dashboard.</EmptyState>} />
        </Routes>
      </main>
      
    </div>
  );
}
