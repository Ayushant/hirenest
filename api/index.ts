import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    // Prefer pre-bundled ESM server generated during `npm run build` on Vercel
    const mod = await import('../dist-server.js' as string).catch(() => import('../server'));
    const app = await mod.getServerApp();
    return app(req, res);
  } catch (err) {
    console.error('[HireNestOS Serverless Error]:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

