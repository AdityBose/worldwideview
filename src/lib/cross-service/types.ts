export interface CrossServiceSignature {
    valid: boolean;
    reason?: "expired" | "replay" | "signature_mismatch" | "missing_header" | "malformed_header" | "server_configuration_error";
}

export interface SignOptions {
    method: string;
    path: string;
    body?: unknown;
    timestamp?: number;
}

export interface SignedHeaders {
    "X-Service-Signature": string;
    "X-Service-Timestamp": string;
    "X-Service-Nonce": string;
    [key: string]: string;
}
