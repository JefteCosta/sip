import * as crypto from 'node:crypto';
import { IAuthenticator } from '#interfaces/IAuthenticator';
import { Utils } from '#utils/Utils';

class Authenticator implements IAuthenticator {
    private kd(...args: string[]): string {
        const hash = crypto.createHash('md5');
        const a = Array.prototype.join.call(args, ':');
        hash.update(a);
        return hash.digest('hex');
    }

    generateNonce(tag: string, timestamp?: Date): string {
        const ts = (timestamp || new Date()).toISOString();
        const nonceSalt = this.kd(Math.random().toString(), Math.random().toString());
        return Buffer.from([ts, this.kd(ts, tag, nonceSalt)].join(';'), 'ascii').toString('base64');
    }

    extractNonceTimestamp(nonce: string, tag: string): Date | undefined {
        const v = Buffer.from(nonce, 'base64').toString('ascii').split(';');
        if (v.length != 2) return;

        const ts = new Date(v[0]);
        return this.generateNonce(tag, ts) === nonce ? ts : undefined;
    }

    calculateHA1(ctx: any): string {
        const userhash = ctx.userhash || this.kd(ctx.user, ctx.realm, ctx.password);
        if (ctx.algorithm === 'md5-sess') return this.kd(userhash, ctx.nonce, ctx.cnonce);
        return userhash;
    }

    calculateDigest(ctx: any): string {
        switch (ctx.qop) {
            case 'auth-int':
                return this.kd(ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop, this.kd(ctx.method, ctx.uri, this.kd(ctx.entity)));
            case 'auth':
                return this.kd(ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop, this.kd(ctx.method, ctx.uri));
        }
        return this.kd(ctx.ha1, ctx.nonce, this.kd(ctx.method, ctx.uri));
    }

    authenticateRequest(ctx: any, rq: any, creds: any): boolean {
        const response = this.findDigestRealm(rq.headers[ctx.proxy ? 'proxy-authorization' : 'authorization'], ctx.realm);
        if (!response) return false;

        const cnonce = this.unq(response.cnonce);
        const uri = this.unq(response.uri);
        const qop = this.unq(this.lowercase(response.qop));

        ctx.nc = (ctx.nc || 0) + 1;

        if (!ctx.ha1) {
            ctx.userhash = creds.hash || this.kd(creds.user, ctx.realm, creds.password);
            ctx.ha1 = ctx.userhash;
            if (ctx.algorithm === 'md5-sess') ctx.ha1 = this.kd(ctx.userhash, ctx.nonce, cnonce);
        }

        const digest = this.calculateDigest({ ha1: ctx.ha1, method: rq.method, nonce: ctx.nonce, nc: this.numberTo8Hex(ctx.nc), cnonce: cnonce, qop: qop, uri: uri, entity: rq.content });
        if (digest === this.unq(response.response)) {
            ctx.cnonce = cnonce;
            ctx.uri = uri;
            ctx.qop = qop;
            return true;
        }
        return false;
    }

    signRequest(ctx: any, rq: any, rs: any, creds: any): any {
        ctx = ctx || {};
        if (rs) this.initClientContext(ctx, rs, creds);

        const nc = ctx.nc !== undefined ? this.numberTo8Hex(++ctx.nc) : undefined;
        ctx.uri = Utils.stringifyUri(rq.uri);

        const signature: any = {
            scheme: 'Digest',
            realm: this.q(ctx.realm),
            username: this.q(ctx.user),
            nonce: this.q(ctx.nonce),
            uri: this.q(ctx.uri),
            nc: nc,
            algorithm: ctx.algorithm,
            cnonce: this.q(ctx.cnonce),
            qop: ctx.qop,
            opaque: this.q(ctx.opaque),
            response: this.q(this.calculateDigest({ ha1: ctx.ha1, method: rq.method, nonce: ctx.nonce, nc: nc, cnonce: ctx.cnonce, qop: ctx.qop, uri: ctx.uri, entity: rq.content }))
        };

        const hname = ctx.proxy ? 'proxy-authorization' : 'authorization';
        rq.headers[hname] = (rq.headers[hname] || []).filter((x: any) => this.unq(x.realm) !== ctx.realm);
        rq.headers[hname].push(signature);

        return ctx.qop ? ctx : null;
    }

    authenticateResponse(ctx: any, rs: any): boolean {
        const signature = rs.headers[ctx.proxy ? 'proxy-authentication-info' : 'authentication-info'];
        if (!signature) return false;

        const digest = this.calculateDigest({ ha1: ctx.ha1, method: '', nonce: ctx.nonce, nc: this.numberTo8Hex(ctx.nc), cnonce: ctx.cnonce, qop: ctx.qop, uri: ctx.uri, entity: rs.content });
        if (digest === this.unq(signature.rspauth)) {
            const nextnonce = this.unq(signature.nextnonce);
            if (nextnonce && nextnonce !== ctx.nonce) {
                ctx.nonce = nextnonce;
                ctx.nc = 0;
                if (ctx.algorithm === 'md5-sess') ctx.ha1 = this.kd(ctx.userhash, ctx.nonce, ctx.cnonce);
            }
            return true;
        }
        return false;
    }

    private unq(a: string): string {
        if (a && a[0] === '"' && a[a.length - 1] === '"') {
            return a.substr(1, a.length - 2);
        }
        return a;
    }

    private q(a: string): string {
        if (typeof a === 'string' && a[0] !== '"') {
            return ['"', a, '"'].join('');
        }
        return a;
    }

    private lowercase(a: string): string {
        if (typeof a === 'string') {
            return a.toLowerCase();
        }
        return a;
    }

    private numberTo8Hex(n: number): string {
        const hex = n.toString(16);
        return '00000000'.substr(hex.length) + hex;
    }

    private findDigestRealm(headers: any[], realm: string): any | undefined {
        if (!realm) return headers && headers[0];
        return headers && headers.find((x: any) => this.lowercase(x.scheme) === 'digest' && this.unq(x.realm) === realm);
    }

    private initClientContext(ctx: any, rs: any, creds: any): void {
        let challenge;

        if (rs.status === 407) {
            ctx.proxy = true;
            challenge = this.findDigestRealm(rs.headers['proxy-authenticate'], creds.realm);
        } else {
            challenge = this.findDigestRealm(rs.headers['www-authenticate'], creds.realm);
        }

        if (ctx.nonce !== this.unq(challenge.nonce)) {
            ctx.nonce = this.unq(challenge.nonce);
            ctx.algorithm = this.unq(this.lowercase(challenge.algorithm));
            ctx.qop = this.selectQop(this.lowercase(challenge.qop), ctx.qop);

            if (ctx.qop) {
                ctx.nc = 0;
                ctx.cnonce = this.kd(Math.random().toString(), Math.random().toString());
            }

            ctx.realm = this.unq(challenge.realm);
            ctx.user = creds.user;
            ctx.userhash = creds.hash || this.kd(creds.user, ctx.realm, creds.password);
            ctx.ha1 = ctx.userhash;

            if (ctx.algorithm === 'md5-sess') ctx.ha1 = this.kd(ctx.ha1, ctx.nonce, ctx.cnonce);

            ctx.domain = this.unq(challenge.domain);
        }

        ctx.opaque = this.unq(challenge.opaque);
    }

    private selectQop(challenge: string, preference?: string | string[]): string {
        if (!challenge) return '';

        const challengeList = this.unq(challenge).split(',');
        if (!preference) return challengeList[0];

        const preferences = typeof preference === 'string' ? preference.split(',') : preference;

        for (const pref of preferences) {
            if (challengeList.includes(pref)) return pref;
        }

        throw new Error('failed to negotiate protection quality');
    }
}

export default Authenticator;