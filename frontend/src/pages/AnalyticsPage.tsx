import { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Calendar, AlertTriangle,
  BarChart3, Clock, Eye, Activity, Minus,
} from 'lucide-react';
import api from '../lib/api';

interface WeeklyData {
  avg_fatigue_score: number;
  fatigue_change: number;
  avg_blink_rate: number;
  longest_session: number;
  total_sessions: number;
  total_minutes: number;
  daily: { date: string; avg_fatigue_score: number; avg_blink_rate: number; total_minutes: number; session_count: number }[];
}

interface MonthlyData {
  weekly_trend: { week_start: string; avg_fatigue_score: number; avg_blink_rate: number; total_minutes: number; total_sessions: number }[];
  high_fatigue_days: number;
  burnout_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  daily: { date: string; avg_fatigue_score: number; avg_blink_rate: number; total_minutes: number; session_count: number }[];
}

interface SessionRecord {
  id: number;
  session_date: string;
  duration_minutes: number;
  avg_blink_rate: number;
  fatigue_score: number;
  long_closure_events: number;
}

const burnoutColors = { LOW: 'emerald', MEDIUM: 'amber', HIGH: 'red' } as const;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-medium" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'weekly' | 'monthly'>('weekly');
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [w, m, s] = await Promise.all([
          api.get('/analytics/weekly'),
          api.get('/analytics/monthly'),
          api.get('/sessions?limit=50'),
        ]);
        setWeekly(w.data);
        setMonthly(m.data);
        setSessions(s.data.sessions);
      } catch (err) {
        console.error('Failed to load analytics', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-400" />
      </div>
    );
  }

  const burnoutRisk = monthly?.burnout_risk || 'LOW';
  const bColor = burnoutColors[burnoutRisk];

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const weeklyChartData = weekly?.daily.map(d => ({
    ...d,
    date: formatDate(d.date),
  })) || [];

  const monthlyChartData = monthly?.daily.map(d => ({
    ...d,
    date: formatDate(d.date),
  })) || [];

  const weeklyTrendData = monthly?.weekly_trend.map(w => ({
    ...w,
    week: formatDate(w.week_start),
  })) || [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-slate-400 mt-1">Track your wellness trends over time</p>
        </div>
        <div className="flex bg-white/5 rounded-xl p-1 border border-white/5">
          {(['weekly', 'monthly'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t === 'weekly' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Avg Fatigue</span>
            <Activity className="h-4 w-4 text-slate-600" />
          </div>
          <p className="text-2xl font-bold text-white">{weekly?.avg_fatigue_score ?? 0}</p>
          <div className="flex items-center gap-1 mt-1">
            {(weekly?.fatigue_change ?? 0) > 0 ? (
              <TrendingUp className="h-3 w-3 text-red-400" />
            ) : (weekly?.fatigue_change ?? 0) < 0 ? (
              <TrendingDown className="h-3 w-3 text-emerald-400" />
            ) : (
              <Minus className="h-3 w-3 text-slate-500" />
            )}
            <span className={`text-xs font-medium ${
              (weekly?.fatigue_change ?? 0) > 0 ? 'text-red-400' :
              (weekly?.fatigue_change ?? 0) < 0 ? 'text-emerald-400' : 'text-slate-500'
            }`}>
              {Math.abs(weekly?.fatigue_change ?? 0).toFixed(1)} vs last week
            </span>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Avg Blink Rate</span>
            <Eye className="h-4 w-4 text-slate-600" />
          </div>
          <p className="text-2xl font-bold text-white">{weekly?.avg_blink_rate ?? 0}<span className="text-sm text-slate-500 ml-1">/min</span></p>
        </div>

        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Longest Session</span>
            <Clock className="h-4 w-4 text-slate-600" />
          </div>
          <p className="text-2xl font-bold text-white">{Math.round(weekly?.longest_session ?? 0)}<span className="text-sm text-slate-500 ml-1">min</span></p>
        </div>

        <div className={`bg-${bColor}-500/5 border border-${bColor}-500/20 rounded-2xl p-5`}
          style={{
            backgroundColor: burnoutRisk === 'LOW' ? 'rgba(16,185,129,0.05)' : burnoutRisk === 'MEDIUM' ? 'rgba(245,158,11,0.05)' : 'rgba(239,68,68,0.05)',
            borderColor: burnoutRisk === 'LOW' ? 'rgba(16,185,129,0.2)' : burnoutRisk === 'MEDIUM' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Burnout Risk</span>
            <AlertTriangle className="h-4 w-4" style={{
              color: burnoutRisk === 'LOW' ? '#34d399' : burnoutRisk === 'MEDIUM' ? '#fbbf24' : '#f87171',
            }} />
          </div>
          <p className="text-2xl font-bold" style={{
            color: burnoutRisk === 'LOW' ? '#34d399' : burnoutRisk === 'MEDIUM' ? '#fbbf24' : '#f87171',
          }}>{burnoutRisk}</p>
          <p className="text-xs text-slate-500 mt-1">{monthly?.high_fatigue_days ?? 0} high fatigue days</p>
        </div>
      </div>

      {/* Charts */}
      {tab === 'weekly' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Fatigue Score Chart */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Daily Fatigue Score
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyChartData}>
                  <defs>
                    <linearGradient id="fatigueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="avg_fatigue_score" name="Fatigue" stroke="#f59e0b" fill="url(#fatigueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Blink Rate Chart */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
              <Eye className="h-4 w-4" /> Daily Blink Rate
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="avg_blink_rate" name="Blink Rate" fill="#34d399" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Monthly Fatigue Trend */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Monthly Fatigue Trend
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyChartData}>
                  <defs>
                    <linearGradient id="monthFatigueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="avg_fatigue_score" name="Fatigue" stroke="#f87171" fill="url(#monthFatigueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weekly Comparison */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Weekly Comparison
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="avg_fatigue_score" name="Fatigue" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 4 }} />
                  <Line type="monotone" dataKey="avg_blink_rate" name="Blink Rate" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Session History Table */}
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
        <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Session History
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">Date</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">Duration</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">Blink Rate</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">Fatigue</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">Closures</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-3 text-sm text-white">{formatDate(s.session_date)}</td>
                  <td className="py-3 px-3 text-sm text-slate-300">{Math.round(s.duration_minutes)} min</td>
                  <td className="py-3 px-3 text-sm text-slate-300">{parseFloat(String(s.avg_blink_rate)).toFixed(1)}/min</td>
                  <td className="py-3 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                      s.fatigue_score <= 40 ? 'bg-emerald-500/15 text-emerald-400' :
                      s.fatigue_score <= 70 ? 'bg-amber-500/15 text-amber-400' :
                      'bg-red-500/15 text-red-400'
                    }`}>
                      {Math.round(s.fatigue_score)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-sm text-slate-300">{s.long_closure_events}</td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                    No sessions recorded yet. Start a session from the Dashboard!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
