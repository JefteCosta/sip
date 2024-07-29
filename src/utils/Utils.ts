import crypto from 'crypto';

export class Utils {
    static kd(...args: string[]): string {
        const hash = crypto.createHash('md5');
        const a = Array.prototype.join.call(args, ':');
        hash.update(a);
        return hash.digest('hex');
    }

    static toBase64(s: string): string {
        switch (s.length % 3) {
            case 1:
                s += '  ';
                break;
            case 2:
                s += ' ';
                break;
            default:
        }

        return Buffer.from(s).toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
    }

    static unq(a: string): string {
        if (a && a[0] === '"' && a[a.length - 1] === '"') {
            return a.substr(1, a.length - 2);
        }
        return a;
    }

    static q(a: string): string {
        if (typeof a === 'string' && a[0] !== '"') {
            return ['"', a, '"'].join('');
        }
        return a;
    }

    static lowercase(a: string): string {
        if (typeof a === 'string') {
            return a.toLowerCase();
        }
        return a;
    }

    static numberTo8Hex(n: number): string {
        const hex = n.toString(16);
        return '00000000'.substr(hex.length) + hex;
    }
    static stringifyUri(uri: any): string {
        if (typeof uri === 'string') return uri;

        let s = (uri.schema || 'sip') + ':';
        if (uri.user) {
            if (uri.password) s += uri.user + ':' + uri.password + '@';
            else s += uri.user + '@';
        }

        s += uri.host;
        if (uri.port) s += ':' + uri.port;
        if (uri.params) s += this.stringifyParams(uri.params);

        if (uri.headers) {
            const h = Object.keys(uri.headers)
                .map((x) => x + '=' + uri.headers[x])
                .join('&');
            if (h.length) s += '?' + h;
        }
        return s;
    }
    
    private static stringifyParams(params: { [key: string]: any }): string {
        let s = '';
        for (const n in params) {
            s += ';' + n + (params[n] ? '=' + params[n] : '');
        }
        return s;
    }
}
