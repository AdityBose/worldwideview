import { describe, it, expect, afterEach } from "vitest";
import { signCrossServiceRequest } from "./sign";
import { verifyCrossServiceSignature } from "./verify";
import { nonceCache } from "./nonceCache";

const SECRET = "test-secret-12345678901234567890123456789012";

function buildRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers,
        body,
    });
}

describe("cross-service HMAC verification", () => {
    afterEach(() => {
        nonceCache.clear();
    });

    it("signs and verifies a GET request", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;

        const signed = signCrossServiceRequest({ method: "GET", path: "/api/service/ping" });
        const req = buildRequest("GET", "/api/service/ping", signed);

        const result = verifyCrossServiceSignature(req, "");
        expect(result.valid).toBe(true);
    });

    it("signs and verifies a POST request with body", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;
        const body = { hello: "world" };

        const signed = signCrossServiceRequest({ method: "POST", path: "/api/test", body });
        const req = buildRequest("POST", "/api/test", signed, JSON.stringify(body));

        const result = verifyCrossServiceSignature(req, JSON.stringify(body));
        expect(result.valid).toBe(true);
    });

    it("rejects tampered body", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;
        const body = { hello: "world" };

        const signed = signCrossServiceRequest({ method: "POST", path: "/api/test", body });
        const req = buildRequest("POST", "/api/test", signed, JSON.stringify(body));

        const result = verifyCrossServiceSignature(req, JSON.stringify({ hello: "evil" }));
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("signature_mismatch");
    });

    it("rejects missing signature header", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;
        const req = buildRequest("GET", "/api/service/ping", {});

        const result = verifyCrossServiceSignature(req, "");
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("missing_header");
    });

    it("rejects expired timestamp", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;
        const past = Math.floor(Date.now() / 1000) - 600;

        const signed = signCrossServiceRequest({
            method: "GET",
            path: "/api/service/ping",
            timestamp: past,
        });
        const req = buildRequest("GET", "/api/service/ping", signed);

        const result = verifyCrossServiceSignature(req, "");
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("expired");
    });

    it("rejects replayed nonce", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;

        const signed = signCrossServiceRequest({ method: "GET", path: "/api/nonce" });
        const req = buildRequest("GET", "/api/nonce", signed);

        const first = verifyCrossServiceSignature(req, "");
        expect(first.valid).toBe(true);

        const second = verifyCrossServiceSignature(req, "");
        expect(second.valid).toBe(false);
        expect(second.reason).toBe("replay");
    });

    it("returns server_configuration_error when secret is missing", () => {
        process.env.CROSS_SERVICE_SECRET = SECRET;
        const signed = signCrossServiceRequest({ method: "GET", path: "/api/test" });
        const req = buildRequest("GET", "/api/test", signed);

        delete process.env.CROSS_SERVICE_SECRET;
        const result = verifyCrossServiceSignature(req, "");
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("server_configuration_error");
    });
});
