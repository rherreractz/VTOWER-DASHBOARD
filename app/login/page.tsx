'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Contraseña incorrecta.');
      }
      const from = searchParams.get('from');
      const destination = !from || from === '/' ? '/meta-ads' : from;
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Live Desarrollos</p>
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-zinc-50">Panel de Reportes</h1>

        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">Contraseña</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="mb-3 border-zinc-800 bg-zinc-950 text-zinc-100"
        />

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <Button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-[#EFF767] text-zinc-950 hover:bg-[#EFF767]/90"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <LoginForm />
    </Suspense>
  );
}