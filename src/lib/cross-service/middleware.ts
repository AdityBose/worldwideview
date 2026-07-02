import { NextResponse } from "next/server";
import { verifyCrossServiceSignature } from "./verify";

export async function crossServiceAuth(request: Request): Promise<NextResponse | null> {
    const sigHeader = request.headers.get("X-Service-Signature");
    if (!sigHeader) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.clone().text();
    const result = verifyCrossServiceSignature(request, rawBody);
    if (result.valid) {
        return null;
    }

    return NextResponse.json({ error: "Unauthorized", reason: result.reason }, { status: 401 });
}
