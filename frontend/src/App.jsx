import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { call } from './api.js';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import Studio from './pages/Studio.jsx';
import Quality from './pages/Quality.jsx';
import Models from './pages/Models.jsx';
import Report from './pages/Report.jsx';
import Reports from './pages/Reports.jsx';
import { History, Stub } from './pages/Misc.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking, null = signed out
  useEffect(() => {
    call('/auth/me').then(setUser).catch(() => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('signed-out', out); return () => window.removeEventListener('signed-out', out);
  }, []);
  const signOut = async () => { try { await call('/auth/logout', 'POST'); } catch {} window.location.assign('/'); }; // reload so no data of this company stays in memory
  if (user === undefined) return null;
  if (!user) return <Login onSignedIn={setUser} />;
  return (
    <Layout user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/intake" element={<Navigate to="/history" replace />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/history" element={<History />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/models" element={<Models />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:truckId" element={<Report />} />
        <Route path="*" element={<Stub title="Not found" icon="search_off" />} />
      </Routes>
    </Layout>
  );
}
