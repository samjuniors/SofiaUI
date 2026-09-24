import { handleSophiaRequest } from "@/lib/sophia-server";

export async function GET(req: Request) {
  return handleSophiaRequest(req);
}

export async function POST(req: Request) {
  return handleSophiaRequest(req);
}
