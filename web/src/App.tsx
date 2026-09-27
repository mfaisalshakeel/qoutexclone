import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import i18n from './i18n';
import { applyDocumentDirection, isTranslatedRoute } from './i18n/config';
import { AdminLayout } from './components/admin/AdminLayout';
import { RequireArea } from './components/admin/RequireArea';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Landing } from './pages/Landing';
import { CookieConsent } from './components/home/CookieConsent';
import { useAuth } from './store/auth';
import { useSettings } from './store/settings';

// Every other route is its own chunk, so a visitor to the public homepage —
// the one page this task's Lighthouse budget is measured against — never
// downloads the terminal, the authenticated account pages or the entire
// admin back office just to see the marketing site.
const Account = lazy(() => import('./pages/Account').then((m) => ({ default: m.Account })));
const AdminDashboard = lazy(() =>
  import('./pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })),
);
const AdminDeposits = lazy(() => import('./pages/admin/Money').then((m) => ({ default: m.AdminDeposits })));
const AdminWithdrawals = lazy(() =>
  import('./pages/admin/Money').then((m) => ({ default: m.AdminWithdrawals })),
);
const AdminPaymentMethods = lazy(() =>
  import('./pages/admin/PaymentMethods').then((m) => ({ default: m.AdminPaymentMethods })),
);
const AdminLedger = lazy(() => import('./pages/admin/Activity').then((m) => ({ default: m.AdminLedger })));
const AdminReferrals = lazy(() =>
  import('./pages/admin/Activity').then((m) => ({ default: m.AdminReferrals })),
);
const AdminTrades = lazy(() => import('./pages/admin/Activity').then((m) => ({ default: m.AdminTrades })));
const AdminAssets = lazy(() => import('./pages/admin/Platform').then((m) => ({ default: m.AdminAssets })));
const AdminAudit = lazy(() => import('./pages/admin/Platform').then((m) => ({ default: m.AdminAudit })));
const AdminMarketplaceOrders = lazy(() =>
  import('./pages/admin/Platform').then((m) => ({ default: m.AdminMarketplaceOrders })),
);
const AdminPromos = lazy(() => import('./pages/admin/Platform').then((m) => ({ default: m.AdminPromos })));
const AdminSchedules = lazy(() =>
  import('./pages/admin/Platform').then((m) => ({ default: m.AdminSchedules })),
);
const AdminTournaments = lazy(() =>
  import('./pages/admin/Platform').then((m) => ({ default: m.AdminTournaments })),
);
const AdminContent = lazy(() => import('./pages/admin/Content').then((m) => ({ default: m.AdminContent })));
const AdminBonusOffers = lazy(() =>
  import('./pages/admin/Growth').then((m) => ({ default: m.AdminBonusOffers })),
);
const AdminMarketplaceItems = lazy(() =>
  import('./pages/admin/Growth').then((m) => ({ default: m.AdminMarketplaceItems })),
);
const AdminEmail = lazy(() => import('./pages/admin/Email').then((m) => ({ default: m.AdminEmail })));
const AdminOtcEngine = lazy(() =>
  import('./pages/admin/OtcEngine').then((m) => ({ default: m.AdminOtcEngine })),
);
const AdminPayouts = lazy(() => import('./pages/admin/Payouts').then((m) => ({ default: m.AdminPayouts })));
const AdminRisk = lazy(() => import('./pages/admin/Risk').then((m) => ({ default: m.AdminRisk })));
const AdminSettings = lazy(() =>
  import('./pages/admin/Settings').then((m) => ({ default: m.AdminSettings })),
);
const AdminSupport = lazy(() => import('./pages/admin/Support').then((m) => ({ default: m.AdminSupport })));
const AdminKyc = lazy(() => import('./pages/admin/Traders').then((m) => ({ default: m.AdminKyc })));
const AdminUsers = lazy(() => import('./pages/admin/Traders').then((m) => ({ default: m.AdminUsers })));
const AdminUserProfile = lazy(() =>
  import('./pages/admin/UserProfile').then((m) => ({ default: m.AdminUserProfile })),
);
const AdminStaff = lazy(() => import('./pages/admin/Staff').then((m) => ({ default: m.AdminStaff })));
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Legal = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Legal })));
const PublicMarkets = lazy(() =>
  import('./pages/public/Markets').then((m) => ({ default: m.PublicMarkets })),
);
const PublicTournamentsOverview = lazy(() =>
  import('./pages/public/TournamentsOverview').then((m) => ({ default: m.PublicTournamentsOverview })),
);
const PublicStatusLevels = lazy(() =>
  import('./pages/public/StatusLevels').then((m) => ({ default: m.PublicStatusLevels })),
);
const PublicAffiliate = lazy(() =>
  import('./pages/public/Affiliate').then((m) => ({ default: m.PublicAffiliate })),
);
const PublicHelp = lazy(() => import('./pages/public/Help').then((m) => ({ default: m.PublicHelp })));
const PublicContact = lazy(() =>
  import('./pages/public/Contact').then((m) => ({ default: m.PublicContact })),
);
const PublicAbout = lazy(() => import('./pages/public/About').then((m) => ({ default: m.PublicAbout })));
const NotFound = lazy(() => import('./pages/public/NotFound').then((m) => ({ default: m.NotFound })));
const ForgotPassword = lazy(() =>
  import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import('./pages/ForgotPassword').then((m) => ({ default: m.ResetPassword })),
);
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Register').then((m) => ({ default: m.Register })));
const Security = lazy(() => import('./pages/Security').then((m) => ({ default: m.Security })));
const Limits = lazy(() => import('./pages/Limits').then((m) => ({ default: m.Limits })));
const Marketplace = lazy(() => import('./pages/Marketplace').then((m) => ({ default: m.Marketplace })));
const Progress = lazy(() => import('./pages/Progress').then((m) => ({ default: m.Progress })));
const Status = lazy(() => import('./pages/Status').then((m) => ({ default: m.Status })));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then((m) => ({ default: m.VerifyEmail })));
const Terminal = lazy(() => import('./pages/Terminal').then((m) => ({ default: m.Terminal })));
const Tournaments = lazy(() => import('./pages/Tournaments').then((m) => ({ default: m.Tournaments })));
const Wallet = lazy(() => import('./pages/Wallet').then((m) => ({ default: m.Wallet })));

/** A route chunk is on its way in; kept blank rather than a spinner so a fast
 *  load never flashes a loading state the eye can barely register. */
function RouteFallback() {
  return <div className="min-h-dvh bg-ink-900" />;
}

/** Keeps the document's text direction correct as the trader moves between the
 *  translated public site and the pages that stay English-only regardless of
 *  the language they picked (see `isTranslatedRoute`). */
function DirectionSync() {
  const location = useLocation();
  useEffect(() => {
    applyDocumentDirection(isTranslatedRoute(location.pathname) ? i18n.language : 'en');
  }, [location.pathname]);
  return null;
}

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
        <DirectionSync />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={ready && user ? <Navigate to="/trade" replace /> : <Landing />} />
            <Route path="/legal/:slug" element={<Legal />} />
            <Route path="/markets" element={<PublicMarkets />} />
            <Route path="/tournaments/overview" element={<PublicTournamentsOverview />} />
            <Route path="/status" element={<PublicStatusLevels />} />
            <Route path="/affiliate" element={<PublicAffiliate />} />
            <Route path="/help" element={<PublicHelp />} />
            <Route path="/contact" element={<PublicContact />} />
            <Route path="/about" element={<PublicAbout />} />
            <Route path="/login" element={ready && user ? <Navigate to="/trade" replace /> : <Login />} />
            <Route
              path="/register"
              element={ready && user ? <Navigate to="/trade" replace /> : <Register />}
            />
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
              <Route
                index
                element={
                  <RequireArea area="dashboard">
                    <AdminDashboard />
                  </RequireArea>
                }
              />
              <Route
                path="withdrawals"
                element={
                  <RequireArea area="finance">
                    <AdminWithdrawals />
                  </RequireArea>
                }
              />
              <Route
                path="deposits"
                element={
                  <RequireArea area="finance">
                    <AdminDeposits />
                  </RequireArea>
                }
              />
              <Route
                path="payment-methods"
                element={
                  <RequireArea area="finance">
                    <AdminPaymentMethods />
                  </RequireArea>
                }
              />
              <Route
                path="users"
                element={
                  <RequireArea area="users.view">
                    <AdminUsers />
                  </RequireArea>
                }
              />
              <Route
                path="users/:id"
                element={
                  <RequireArea area="users.view">
                    <AdminUserProfile />
                  </RequireArea>
                }
              />
              <Route
                path="kyc"
                element={
                  <RequireArea area="support">
                    <AdminKyc />
                  </RequireArea>
                }
              />
              <Route
                path="trades"
                element={
                  <RequireArea area="risk">
                    <AdminTrades />
                  </RequireArea>
                }
              />
              <Route
                path="ledger"
                element={
                  <RequireArea area="finance">
                    <AdminLedger />
                  </RequireArea>
                }
              />
              <Route
                path="referrals"
                element={
                  <RequireArea area="finance">
                    <AdminReferrals />
                  </RequireArea>
                }
              />
              <Route
                path="support"
                element={
                  <RequireArea area="support">
                    <AdminSupport />
                  </RequireArea>
                }
              />
              <Route
                path="tournaments"
                element={
                  <RequireArea area="content">
                    <AdminTournaments />
                  </RequireArea>
                }
              />
              <Route
                path="content"
                element={
                  <RequireArea area="content">
                    <AdminContent />
                  </RequireArea>
                }
              />
              <Route
                path="promos"
                element={
                  <RequireArea area="content">
                    <AdminPromos />
                  </RequireArea>
                }
              />
              <Route
                path="bonus-offers"
                element={
                  <RequireArea area="content">
                    <AdminBonusOffers />
                  </RequireArea>
                }
              />
              <Route
                path="marketplace-items"
                element={
                  <RequireArea area="content">
                    <AdminMarketplaceItems />
                  </RequireArea>
                }
              />
              <Route
                path="marketplace-orders"
                element={
                  <RequireArea area="finance">
                    <AdminMarketplaceOrders />
                  </RequireArea>
                }
              />
              <Route
                path="assets"
                element={
                  <RequireArea area="risk">
                    <AdminAssets />
                  </RequireArea>
                }
              />
              <Route
                path="schedules"
                element={
                  <RequireArea area="risk">
                    <AdminSchedules />
                  </RequireArea>
                }
              />
              <Route
                path="price-engine"
                element={
                  <RequireArea area="risk">
                    <AdminOtcEngine />
                  </RequireArea>
                }
              />
              <Route
                path="payouts"
                element={
                  <RequireArea area="risk">
                    <AdminPayouts />
                  </RequireArea>
                }
              />
              <Route
                path="risk"
                element={
                  <RequireArea area="risk">
                    <AdminRisk />
                  </RequireArea>
                }
              />
              <Route
                path="email"
                element={
                  <RequireArea area="content">
                    <AdminEmail />
                  </RequireArea>
                }
              />
              <Route
                path="staff"
                element={
                  <RequireArea area="settings">
                    <AdminStaff />
                  </RequireArea>
                }
              />
              <Route
                path="settings"
                element={
                  <RequireArea area="settings">
                    <AdminSettings />
                  </RequireArea>
                }
              />
              <Route
                path="audit"
                element={
                  <RequireArea area="settings">
                    <AdminAudit />
                  </RequireArea>
                }
              />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <CookieConsent />
      </ErrorBoundary>
    </Router>
  );
}
