import { useEffect } from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';
import { History } from './pages/History';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Terminal } from './pages/Terminal';
import { Wallet } from './pages/Wallet';
import { useAuth } from './store/auth';

export default function App() {
  const { bootstrap, user, ready } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <Router>
      <Routes>
        <Route path="/" element={ready && user ? <Navigate to="/trade" replace /> : <Landing />} />
        <Route path="/login" element={ready && user ? <Navigate to="/trade" replace /> : <Login />} />
        <Route path="/register" element={ready && user ? <Navigate to="/trade" replace /> : <Register />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/trade" element={<Terminal />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/history" element={<History />} />
          <Route path="/account" element={<Account />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <Admin />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
