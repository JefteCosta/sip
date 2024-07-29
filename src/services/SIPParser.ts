import util from 'util';
import { ISIPParser } from '#interfaces/ISIPParser';

class SIPParser implements ISIPParser {
    parse(data: string): any {
        const parts = data.split(/\r\n(?![ \t])/);
        if (parts[0] === '') return;

        const m: any = {};

        if (!(this.parseResponse(parts[0], m) || this.parseRequest(parts[0], m))) return;

        m.headers = {};

        for (let i = 1; i < parts.length; ++i) {
            const r = parts[i].match(/^([\S]*?)\s*:\s*([\s\S]*)$/);
            if (!r) return;

            const name = decodeURIComponent(r[1]).toLowerCase();
            const headerName = this.compactForm[name] || name;

            try {
                m.headers[headerName] = (this.parsers[headerName] || this.parseGenericHeader)({ s: r[2], i: 0 }, m.headers[headerName]);
            } catch (e) {}
        }

        return m;
    }
    parseMessage(s: Buffer | string) {
        const r = s.toString('binary').match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);
        if (r) {
            const m = this.parse(r[1]);
            if (m) {
                if (m.headers['content-length']) {
                    const c = Math.max(0, Math.min(m.headers['content-length'], r[2].length));
                    m.content = r[2].substring(0, c);
                } else {
                    m.content = r[2];
                }
                return m;
            }
        }
    }

    makeResponse(rq: any, status: number, reason?: string): any {
        const rs: any = {
            status: status,
            reason: reason || '',
            version: rq.version,
            headers: {
                via: rq.headers.via,
                to: rq.headers.to,
                from: rq.headers.from,
                'call-id': rq.headers['call-id'],
                cseq: rq.headers.cseq,
            },
        };

        return rs;
    }
    stringify(msg: any): string {
        let s: string;
        if (msg.status) {
            s = 'SIP/' + this.stringifyVersion(msg.version) + ' ' + msg.status + ' ' + msg.reason + '\r\n';
        } else {
            s = msg.method + ' ' + this.stringifyUri(msg.uri) + ' SIP/' + this.stringifyVersion(msg.version) + '\r\n';
        }

        msg.headers['content-length'] = (msg.content || '').length;

        for (const n in msg.headers) {
            if (typeof msg.headers[n] !== 'undefined') {
                if (typeof msg.headers[n] === 'string' || !this.stringifiers[n]) {
                    s += this.prettifyHeaderName(n) + ': ' + msg.headers[n] + '\r\n';
                } else {
                    s += this.stringifiers[n](msg.headers[n]);
                }
            }
        }

        s += '\r\n';

        if (msg.content) s += msg.content;

        return s;
    }

    parseUri(s: string | any): any {
        if (typeof s === 'object') return s;

        const re = /^(sips?):(?:([^\s>:@]+)(?::([^\s@>]+))?@)?([\w\-\.]+)(?::(\d+))?((?:;[^\s=\?>;]+(?:=[^\s?\;]+)?)*)(?:\?(([^\s&=>]+=[^\s&=>]+)(&[^\s&=>]+=[^\s&=>]+)*))?$/;

        const r = re.exec(s);
        if (r) {
            return {
                schema: r[1],
                user: r[2],
                password: r[3],
                host: r[4],
                port: +r[5],
                params: (r[6].match(/([^;=]+)(=([^;=]+))?/g) || [])
                    .map((s) => s.split('='))
                    .reduce((params: any, x) => {
                        params[x[0]] = x[1] || null;
                        return params;
                    }, {}),
                headers: ((r[7] || '').match(/[^&=]+=[^&=]+/g) || [])
                    .map((s) => s.split('='))
                    .reduce((params: any, x) => {
                        params[x[0]] = x[1];
                        return params;
                    }, {})
            };
        }
    }

    stringifyUri(uri: any): string {
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

    private parseResponse(rs: string, m: any): any {
        const r = rs.match(/^SIP\/(\d+\.\d+)\s+(\d+)\s*(.*)\s*$/);
        if (r) {
            m.version = r[1];
            m.status = +r[2];
            m.reason = r[3];
            return m;
        }
    }

    private parseRequest(rq: string, m: any): any {
        const r = rq.match(/^([\w\-.!%*_+`'~]+)\s([^\s]+)\sSIP\s*\/\s*(\d+\.\d+)/);
        if (r) {
            m.method = unescape(r[1]);
            m.uri = r[2];
            m.version = r[3];
            return m;
        }
    }

    private applyRegex(regex: RegExp, data: any): any {
        regex.lastIndex = data.i;
        const r = regex.exec(data.s);
        if (r && r.index === data.i) {
            data.i = regex.lastIndex;
            return r;
        }
    }

    private parseParams(data: any, hdr: any): any {
        hdr.params = hdr.params || {};
        const re = /\s*;\s*([\w\-.!%*_+`'~]+)(?:\s*=\s*([\w\-.!%*_+`'~]+|"[^"\\]*(\\.[^"\\]*)*"))?/g;
        for (let r = this.applyRegex(re, data); r; r = this.applyRegex(re, data)) {
            hdr.params[r[1].toLowerCase()] = r[2] || null;
        }
        return hdr;
    }

    private parseMultiHeader(parser: any, d: any, h: any): any {
        h = h || [];
        const re = /\s*,\s*/g;
        do {
            h.push(parser(d));
        } while (d.i < d.s.length && this.applyRegex(re, d));
        return h;
    }

    private parseGenericHeader(d: any, h: any): any {
        return h ? h + ',' + d.s : d.s;
    }

    private compactForm: { [key: string]: string } = {
        i: 'call-id',
        m: 'contact',
        e: 'contact-encoding',
        l: 'content-length',
        c: 'content-type',
        f: 'from',
        s: 'subject',
        k: 'supported',
        t: 'to',
        v: 'via'
    };

    parsers: { [key: string]: (d: any, h?: any) => any } = {
        to: this.parseAOR,
        from: this.parseAOR,
        contact: (v: any, h: any) => {
            if (v === '*') return v;
            else return this.parseMultiHeader(this.parseAOR, v, h);
        },
        route: this.parseMultiHeader.bind(this, this.parseAORWithUri),
        'record-route': this.parseMultiHeader.bind(this, this.parseAORWithUri),
        path: this.parseMultiHeader.bind(this, this.parseAORWithUri),
        cseq: this.parseCSeq,
        'content-length': (v: any) => +v.s,
        via: this.parseMultiHeader.bind(this, this.parseVia),
        'www-authenticate': this.parseMultiHeader.bind(this, this.parseAuthHeader),
        'proxy-authenticate': this.parseMultiHeader.bind(this, this.parseAuthHeader),
        authorization: this.parseMultiHeader.bind(this, this.parseAuthHeader),
        'proxy-authorization': this.parseMultiHeader.bind(this, this.parseAuthHeader),
        'authentication-info': this.parseAuthenticationInfoHeader,
        'refer-to': this.parseAOR
    };

    private parseAOR(data: any): any {
        const r = this.applyRegex(/((?:[\w\-.!%*_+`'~]+)(?:\s+[\w\-.!%*_+`'~]+)*|"[^"\\]*(?:\\.[^"\\]*)*")?\s*\<\s*([^>]*)\s*\>|((?:[^\s@"<]@)?[^\s;]+)/g, data);
        return this.parseParams(data, { name: r[1], uri: r[2] || r[3] || '' });
    }

    private parseAORWithUri(data: any): any {
        const r = this.parseAOR(data);
        r.uri = this.parseUri(r.uri);
        return r;
    }

    private parseVia(data: any): any {
        const r = this.applyRegex(/SIP\s*\/\s*(\d+\.\d+)\s*\/\s*([\S]+)\s+([^\s;:]+)(?:\s*:\s*(\d+))?/g, data);
        return this.parseParams(data, { version: r[1], protocol: r[2], host: r[3], port: r[4] && +r[4] });
    }

    private parseCSeq(d: any): any {
        const r: any = /(\d+)\s*([\S]+)/.exec(d.s);
        return { seq: + r[1], method: unescape(r[2]) };
    }

    private parseAuthHeader(d: any): any {
        const r1 = this.applyRegex(/([^\s]*)\s+/g, d);
        const a: any = { scheme: r1[1] };

        let r2 = this.applyRegex(/([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d);
        a[r2[1]] = r2[2];

        while ((r2 = this.applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d))) {
            a[r2[1]] = r2[2];
        }

        return a;
    }

    private parseAuthenticationInfoHeader(d: any): any {
        const a: any = {};
        let r = this.applyRegex(/([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d);
        a[r[1]] = r[2];

        while ((r = this.applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d))) {
            a[r[1]] = r[2];
        }
        return a;
    }

    private stringifyVersion(v: string): string {
        return v || '2.0';
    }

    private stringifyParams(params: { [key: string]: any }): string {
        let s = '';
        for (const n in params) {
            s += ';' + n + (params[n] ? '=' + params[n] : '');
        }
        return s;
    }

    private stringifiers: { [key: string]: (h: any) => string } = {
        via: (h) => h
            .map((via: any) => {
                if (via.host) {
                    return 'Via: SIP/' + this.stringifyVersion(via.version) + '/' + via.protocol.toUpperCase() + ' ' + via.host + (via.port ? ':' + via.port : '') + this.stringifyParams(via.params) + '\r\n';
                } else {
                    return '';
                }
            })
            .join(''),
        to: (h) => 'To: ' + this.stringifyAOR(h) + '\r\n',
        from: (h) => 'From: ' + this.stringifyAOR(h) + '\r\n',
        contact: (h) => 'Contact: ' + (h !== '*' && h.length ? h.map(this.stringifyAOR).join(', ') : '*') + '\r\n',
        route: (h) => h.length ? 'Route: ' + h.map(this.stringifyAOR).join(', ') + '\r\n' : '',
        'record-route': (h) => h.length ? 'Record-Route: ' + h.map(this.stringifyAOR).join(', ') + '\r\n' : '',
        path: (h) => h.length ? 'Path: ' + h.map(this.stringifyAOR).join(', ') + '\r\n' : '',
        cseq: (cseq) => 'CSeq: ' + cseq.seq + ' ' + cseq.method + '\r\n',
        'www-authenticate': (h) => h.map((x: any) => 'WWW-Authenticate: ' + this.stringifyAuthHeader(x) + '\r\n').join(''),
        'proxy-authenticate': (h) => h.map((x: any) => 'Proxy-Authenticate: ' + this.stringifyAuthHeader(x) + '\r\n').join(''),
        authorization: (h) => h.map((x: any) => 'Authorization: ' + this.stringifyAuthHeader(x) + '\r\n').join(''),
        'proxy-authorization': (h) => h.map((x: any) => 'Proxy-Authorization: ' + this.stringifyAuthHeader(x) + '\r\n').join(''),
        'authentication-info': (h) => 'Authentication-Info: ' + this.stringifyAuthHeader(h) + '\r\n',
        'refer-to': (h) => 'Refer-To: ' + this.stringifyAOR(h) + '\r\n'
    };

    private prettifyHeaderName(s: string): string {
        if (s == 'call-id') return 'Call-ID';
        return s.replace(/\b([a-z])/g, (a) => a.toUpperCase());
    }

    private stringifyAOR(aor: any): string {
        return (aor.name || '') + ' <' + this.stringifyUri(aor.uri) + '>' + this.stringifyParams(aor.params);
    }

    private stringifyAuthHeader(a: any): string {
        const s: string[] = [];
        for (const n in a) {
            if (n !== 'scheme' && a[n] !== undefined) {
                s.push(n + '=' + a[n]);
            }
        }
        return a.scheme ? a.scheme + ' ' + s.join(',') : s.join(',');
    }
}

export default SIPParser;
