import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import { supabase } from './lib/supabase';

// Attach the verified Supabase session token to same-origin API calls so the server can
// enforce role/permission checks on every request (never relying on UI visibility).
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    if (isApi) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (token) headers.set('Authorization', `Bearer ${token}`);
      }
      return nativeFetch(input, { ...init, headers });
    }
  } catch {
    // fall through to a plain request
  }
  return nativeFetch(input, init);
};

createRoot(document.getElementById('root')!).render(<App />);
