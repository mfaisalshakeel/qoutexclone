import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AdminLayout } from './components/admin/AdminLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Account } from './pages/Account';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminDeposits, AdminWithdrawals } from './pages/admin/Money';
import {
  AdminAssets,
  AdminAudit,
  AdminPromos,
  AdminSchedules,
  AdminTournaments,
} from './pages/admin/Platform';
import { AdminEmail } from './pages/admin/Email';
import { AdminOtcEngine } from './pages/admin/OtcEngine';
import { AdminPayouts } from './pages/admin/Payouts';
import { AdminRisk } from './pages/admin/Risk';
import { AdminSettings } from './pages/admin/Settings';
import { AdminSupport } from './pages/admin/Support';
import { AdminKyc, AdminUsers } from './pages/admin/Traders';
import { History } from './pages/History';
import { Leaderboard } from './pages/Leaderboard';
import { Landing } from './pages/Landing';
import { ForgotPassword, ResetPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Security } from './pages/Security';
import { Marketplace } from './pages/Marketplace';
import { Progress } from './pages/Progress';
import { Status } from './pages/Status';
import { VerifyEmail } from './pages/VerifyEmail';
import { Terminal } from './pages/Terminal';
import { Tournaments } from './pages/Tournaments';
import { Wallet } from './pages/Wallet';
import { useAuth } from './store/auth';
import { useSettings } from './store/settings';

export default function App() {
  const { bootstrap, user, ready } = useAuth();
  const loadSettings = useSettings((state) => state.load);

  useEffect(() => {
    void bootstrap();
    void loadSettings();
  }, [bootstrap, loadSettings]);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={ready && user ? <Navigate to="/trade" replace /> : <Landing />} />
          <Route path="/login" element={ready && user ? <Navigate to="/trade" replace /> : <Login />} />
          <Route path="/register" element={ready && user ? <Navigate to="/trade" replace /> : <Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* the token is the proof, so this one works signed in or out */}
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/trade" element={<Terminal />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/history" element={<History />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/account" element={<Account />} />
            <Route path="/account/security" element={<Security />} />
            <Route path="/account/status" element={<Status />} />
            <Route path="/account/progress" element={<Progress />} />
            <Route path="/marketplace" element={<Marketplace />} />
          </Route>

          {/* back office has its own shell: sidebar navigation, no trading chrome */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="withdrawals" element={<AdminWithdrawals />} />
            <Route path="deposits" element={<AdminDeposits />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="kyc" element={<AdminKyc />} />
            <Route path="support" element={<AdminSupport />} />
            <Route path="tournaments" element={<AdminTournaments />} />
            <Route path="promos" element={<AdminPromos />} />
            <Route path="assets" element={<AdminAssets />} />
            <Route path="schedules" element={<AdminSchedules />} />
            <Route path="price-engine" element={<AdminOtcEngine />} />
            <Route path="payouts" element={<AdminPayouts />} />
            <Route path="risk" element={<AdminRisk />} />
            <Route path="email" element={<AdminEmail />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}
