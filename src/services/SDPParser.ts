import { ISDPParser } from '../interfaces/ISDPParser';

class SDPParser implements ISDPParser {
    private parsers: { [key: string]: (data: string) => any } = {
        o: (o: string) => {
            const t = o.split(/\s+/);
            return {
                username: t[0],
                id: t[1],
                version: t[2],
                nettype: t[3],
                addrtype: t[4],
                address: t[5]
            };
        },
        c: (c: string) => {
            const t = c.split(/\s+/);
            return { nettype: t[0], addrtype: t[1], address: t[2] };
        },
        m: (m: string) => {
            const t = /^(\w+) +(\d+)(?:\/(\d))? +(\S+) (\d+( +\d+)*)/.exec(m);
            return {
                media: t![1],
                port: +t![2],
                portnum: +(t![3] || 1),
                proto: t![4],
                fmt: t![5].split(/\s+/).map((x) => +x)
            };
        },
        a: (a: string) => a
    };

    parse(sdp: string): any {
        const lines = sdp.split(/\r\n/);
        const root: any = {};
        let m: any;
        root.m = [];

        lines.forEach((line) => {
            const tmp = /^(\w)=(.*)/.exec(line);
            if (tmp) {
                const c = (this.parsers[tmp[1]] || ((x: string) => x))(tmp[2]);
                switch (tmp[1]) {
                    case 'm':
                        if (m) root.m.push(m);
                        m = c;
                        break;
                    case 'a':
                        const o = m || root;
                        if (!o.a) o.a = [];
                        o.a.push(c);
                        break;
                    default:
                        (m || root)[tmp[1]] = c;
                        break;
                }
            }
        });

        if (m) root.m.push(m);
        return root;
    }

    private stringifiers: { [key: string]: (data: any) => string } = {
        o: (o: any) => [o.username || '-', o.id, o.version, o.nettype || 'IN', o.addrtype || 'IP4', o.address].join(' '),
        c: (c: any) => [c.nettype || 'IN', c.addrtype || 'IP4', c.address].join(' '),
        m: (m: any) => [m.media || 'audio', m.port, m.proto || 'RTP/AVP', m.fmt.join(' ')].join(' ')
    };

    private stringifyParam(sdp: any, type: string, def?: any): string {
        if (sdp[type] !== undefined) {
            const stringifier = (x: any) => type + '=' + ((this.stringifiers[type] && this.stringifiers[type](x)) || x) + '\r\n';
            if (Array.isArray(sdp[type])) return sdp[type].map(stringifier).join('');
            return stringifier(sdp[type]);
        }
        if (def !== undefined) return type + '=' + def + '\r\n';
        return '';
    }

    stringify(sdp: any): string {
        let s = '';
        s += this.stringifyParam(sdp, 'v', 0);
        s += this.stringifyParam(sdp, 'o');
        s += this.stringifyParam(sdp, 's', '-');
        s += this.stringifyParam(sdp, 'i');
        s += this.stringifyParam(sdp, 'u');
        s += this.stringifyParam(sdp, 'e');
        s += this.stringifyParam(sdp, 'p');
        s += this.stringifyParam(sdp, 'c');
        s += this.stringifyParam(sdp, 'b');
        s += this.stringifyParam(sdp, 't', '0 0');
        s += this.stringifyParam(sdp, 'r');
        s += this.stringifyParam(sdp, 'z');
        s += this.stringifyParam(sdp, 'k');
        s += this.stringifyParam(sdp, 'a');
        sdp.m.forEach((m: any) => {
            s += this.stringifyParam({ m }, 'm');
            s += this.stringifyParam(m, 'i');
            s += this.stringifyParam(m, 'c');
            s += this.stringifyParam(m, 'b');
            s += this.stringifyParam(m, 'k');
            s += this.stringifyParam(m, 'a');
        });

        return s;
    }
}

export default SDPParser;
