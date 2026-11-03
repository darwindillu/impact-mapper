// Vercel serverless function: POST /api/analyze
import { handleApi } from "../server/handler.js";

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const { status, body } = await handleApi("analyze", await request.text(), request.headers, ip);
  return Response.json(body, { status });
}
