import { handleSophiaRequest } from "@/lib/sophia-server";

export async function POST(req: Request) {
  return handleSophiaRequest(req);
}
