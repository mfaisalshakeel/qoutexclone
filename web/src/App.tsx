import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AdminLayout } from './components/admin/AdminLayout';
import { RequireArea } from './components/admin/RequireArea';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Account } from './pages/Account';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminDeposits, AdminWithdrawals } from './pages/admin/Money';
import { AdminPaymentMethods } from './pages/admin/PaymentMethods';
import { AdminLedger, AdminReferrals, AdminTrades } from './pages/admin/Activity';
import {
  AdminAssets,
  AdminAudit,
  AdminMarketplaceOrders,
  AdminPromos,
  AdminSchedules,
  AdminTournaments,
} from './pages/admin/Platform';
import { AdminContent } from './pages/admin/Content';
import { AdminBonusOffers, AdminMarketplaceItems } from './pages/admin/Growth';
import { AdminEmail } from './pages/admin/Email';
import { AdminOtcEngine } from './pages/admin/OtcEngine';
import { AdminPayouts } from './pages/admin/Payouts';
import { AdminRisk } from './pages/admin/Risk';
import { AdminSettings } from './pages/admin/Settings';
import { AdminSupport } from './pages/admin/Support';
import { AdminKyc, AdminUsers } from './pages/admin/Traders';
import { AdminUserProfile } from './pages/admin/UserProfile';
import { AdminStaff } from './pages/admin/Staff';
import { History } from './pages/History';
import { Leaderboard } from './pages/Leaderboard';
import { Landing } from './pages/Landing';
import { ForgotPassword, ResetPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Security } from './pages/Security';
import { Limits } from './pages/Limits';
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
  const favicon = useSettings((state) => state.values['general.favicon'] as string | undefined);

  useEffect(() => {
    void bootstrap();
    void loadSettings();
  }, [bootstrap, loadSettings]);

  // an operator's own icon, once the registry has loaded one — the bundled
  // mark set directly in index.html stands in until then
  useEffect(() => {
    if (!favicon) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = favicon;
  }, [favicon]);

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
            <Route path="/account/limits" element={<Limits />} />
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
            <Route index element={<RequireArea area="dashboard"><AdminDashboard /></RequireArea>} />
            <Route
              path="withdrawals"
              element={<RequireArea area="finance"><AdminWithdrawals /></RequireArea>}
            />
            <Route path="deposits" element={<RequireArea area="finance"><AdminDeposits /></RequireArea>} />
            <Route
              path="payment-methods"
              element={<RequireArea area="finance"><AdminPaymentMethods /></RequireArea>}
            />
            <Route path="users" element={<RequireArea area="users.view"><AdminUsers /></RequireArea>} />
            <Route
              path="users/:id"
              element={<RequireArea area="users.view"><AdminUserProfile /></RequireArea>}
            />
            <Route path="kyc" element={<RequireArea area="support"><AdminKyc /></RequireArea>} />
            <Route path="trades" element={<RequireArea area="risk"><AdminTrades /></RequireArea>} />
            <Route path="ledger" element={<RequireArea area="finance"><AdminLedger /></RequireArea>} />
            <Route path="referrals" element={<RequireArea area="finance"><AdminReferrals /></RequireArea>} />
            <Route path="support" element={<RequireArea area="support"><AdminSupport /></RequireArea>} />
            <Route
              path="tournaments"
              element={<RequireArea area="content"><AdminTournaments /></RequireArea>}
            />
            <Route path="content" element={<RequireArea area="content"><AdminContent /></RequireArea>} />
            <Route path="promos" element={<RequireArea area="content"><AdminPromos /></RequireArea>} />
            <Route
              path="bonus-offers"
              element={<RequireArea area="content"><AdminBonusOffers /></RequireArea>}
            />
            <Route
              path="marketplace-items"
              element={<RequireArea area="content"><AdminMarketplaceItems /></RequireArea>}
            />
            <Route
              path="marketplace-orders"
              element={<RequireArea area="finance"><AdminMarketplaceOrders /></RequireArea>}
            />
            <Route path="assets" element={<RequireArea area="risk"><AdminAssets /></RequireArea>} />
            <Route path="schedules" element={<RequireArea area="risk"><AdminSchedules /></RequireArea>} />
            <Route
              path="price-engine"
              element={<RequireArea area="risk"><AdminOtcEngine /></RequireArea>}
            />
            <Route path="payouts" element={<RequireArea area="risk"><AdminPayouts /></RequireArea>} />
            <Route path="risk" element={<RequireArea area="risk"><AdminRisk /></RequireArea>} />
            <Route path="email" element={<RequireArea area="content"><AdminEmail /></RequireArea>} />
            <Route path="staff" element={<RequireArea area="settings"><AdminStaff /></RequireArea>} />
            <Route path="settings" element={<RequireArea area="settings"><AdminSettings /></RequireArea>} />
            <Route path="audit" element={<RequireArea area="settings"><AdminAudit /></RequireArea>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}
