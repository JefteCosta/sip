export interface IAuthenticator {
    generateNonce(tag: string, timestamp?: Date): string;
    extractNonceTimestamp(nonce: string, tag: string): Date | undefined;
    calculateHA1(ctx: any): string;
    calculateDigest(ctx: any): string;
    authenticateRequest(ctx: any, rq: any, creds: any): boolean;
    signRequest(ctx: any, rq: any, rs: any, creds: any): any;
    authenticateResponse(ctx: any, rs: any): boolean;
}