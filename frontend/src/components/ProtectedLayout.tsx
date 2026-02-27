import { useEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SessionProvider, useSession } from '../context/SessionContext';
import Sidebar from './Sidebar';

export default function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-400" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <SessionProvider>
      <LayoutShell />
    </SessionProvider>
  );
}

function LayoutShell() {
  const { videoRef } = useSession();
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);

  // Assign the persistent video element to the context ref on mount
  useEffect(() => {
    if (hiddenVideoRef.current) {
      videoRef.current = hiddenVideoRef.current;
    }
  }, [videoRef]);

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      {/* Persistent video element — moved into Dashboard when visible, hidden otherwise */}
      <video
        ref={hiddenVideoRef}
        className="w-full h-full object-cover rounded-xl"
        playsInline
        muted
        style={{ transform: 'scaleX(-1)', display: 'none' }}
      />
    </div>
  );
}
