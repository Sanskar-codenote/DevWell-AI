import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, BarChart3, LogOut, Settings } from 'lucide-react';
import brandLogo from '../assets/devwell_ai_logo.png';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
      isActive
        ? 'bg-emerald-500/15 text-emerald-400 shadow-lg shadow-emerald-500/5'
        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
    }`;

  return (
    <aside className="w-64 border-r border-white/5 bg-slate-950 flex flex-col p-4">
      <div className="flex items-center gap-3 px-4 py-5 mb-6">
        <img src={brandLogo} alt="DevWell AI logo" className="h-10 w-10 rounded-xl object-cover" />
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">DevWell</h1>
          <p className="text-[11px] text-slate-500 font-medium tracking-wider uppercase">AI Wellness</p>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        <NavLink to="/dashboard" className={linkClass}>
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </NavLink>
        <NavLink to="/analytics" className={linkClass}>
          <BarChart3 className="h-4 w-4" />
          Analytics
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </nav>

      <div className="border-t border-white/5 pt-4 mt-4">
        <div className="px-4 py-2 mb-2">
          <p className="text-xs text-slate-500 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 w-full cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
