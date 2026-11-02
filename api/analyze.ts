// Vercel serverless function: POST /api/analyze
import { handleAnalyze } from "../server/handler.ts";

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const { status, body } = await handleAnalyze(await request.text(), request.headers, ip);
  return Response.json(body, { status });
}
