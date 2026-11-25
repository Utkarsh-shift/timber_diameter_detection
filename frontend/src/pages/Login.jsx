import { useState } from 'react';
import { call } from '../api.js';
import { Logo } from '../components/Layout.jsx';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onSignedIn(await call('/auth/login', 'POST', { email, password })); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-[380px] max-w-full p-6 flex flex-col gap-4">
        <Logo />
        <div><h1 className="text-[20px] font-semibold">Sign in</h1><p className="text-[12px] text-[#718078]">Use the account for your company.</p></div>
        <label className="flex flex-col gap-1"><span className="lbl">Email</span><input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="lbl">Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="text-[12px] text-[#c94c4c] bg-[#c94c4c12] border border-[#c94c4c40] rounded px-3 py-2">{err}</div>}
        <button className="btn btn-primary justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
