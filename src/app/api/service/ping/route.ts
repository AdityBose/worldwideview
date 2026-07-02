import { NextResponse } from "next/server";
import { crossServiceAuth } from "@/lib/cross-service/middleware";

export async function GET(request: Request): Promise<NextResponse> {
    const authError = await crossServiceAuth(request);
    if (authError) {
        return authError;
    }

    return NextResponse.json({
        status: "ok",
        service: "globe",
        timestamp: Date.now(),
    });
}
