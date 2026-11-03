// Vercel serverless function: POST /api/frd
import { handleApi } from "../server/handler.js";

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const { status, body } = await handleApi("frd", await request.text(), request.headers, ip);
  return Response.json(body, { status });
}
