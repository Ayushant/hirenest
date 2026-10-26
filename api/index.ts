import type { Request, Response } from 'express';
import { getServerApp } from '../server';

export default async function handler(req: Request, res: Response) {
  const app = await getServerApp();
  return app(req, res);
}
