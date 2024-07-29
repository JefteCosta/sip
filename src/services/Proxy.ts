import { IProxy } from '#interfaces/IProxy';
import SIPParser from '#services/SIPParser';
import Transport from '#services/Transport';
import Authenticator from '#services/Authenticator';

class Proxy implements IProxy {
    private contexts: { [key: string]: any } = {};
    private sipParser = new SIPParser();
    private transport: Transport;

    constructor(options: any, callback: any) {
        this.transport = new Transport(options, callback);
    }

    send(msg: any, callback?: (rs: any) => void): void {
        const ctx = this.contexts[this.makeContextId(msg)];
        if (!ctx) {
            this.transport.send(this.getTarget(msg), msg);
            return;
        }
        return msg.method
            ? this.forwardRequest(ctx, msg, callback || this.defaultCallback)
            : this.forwardResponse(ctx, msg);
    }

    start(options: any, route: (rq: any, remote: any) => void): void {
        this.transport.open(options, (rq: any, remote: any) => {
            if (rq.method === 'CANCEL') {
                const ctx = this.contexts[this.makeContextId(rq)];
                if (ctx) {
                    this.transport.send(remote, this.sipParser.makeResponse(rq, 200));
                    ctx.cancelled = true;
                    if (ctx.cancellers) {
                        Object.keys(ctx.cancellers).forEach((c) => ctx.cancellers[c]());
                    }
                } else {
                    this.transport.send(remote, this.sipParser.makeResponse(rq, 481));
                }
            } else {
                this.onRequest(rq, route, remote);
            }
        });
    }

    stop(): void {
        this.transport.destroy();
    }

    private makeContextId(msg: any): string {
        const via = msg.headers.via[0];
        return [
            via.params.branch,
            via.protocol,
            via.host,
            via.port,
            msg.headers['call-id'],
            msg.headers.cseq.seq,
        ].join(':');
    }

    private defaultCallback(rs: any): void {
        rs.headers.via.shift();
        this.send(rs);
    }

    private forwardResponse(ctx: any, rs: any): void {
        if (+rs.status >= 200) {
            delete this.contexts[this.makeContextId(rs)];
        }
        this.transport.send(this.getTarget(rs), rs);
    }

    private sendCancel(rq: any, via: any, route: any): void {
        this.transport.send(this.getTarget(rq), {
            method: 'CANCEL',
            uri: rq.uri,
            headers: {
                via: [via],
                to: rq.headers.to,
                from: rq.headers.from,
                'call-id': rq.headers['call-id'],
                route: route,
                cseq: { method: 'CANCEL', seq: rq.headers.cseq.seq },
            },
        });
    }

    private forwardRequest(
        ctx: any,
        rq: any,
        callback: (rs: any, remote: any) => void
    ): void {
        const route = rq.headers.route && rq.headers.route.slice();
        this.transport.send(this.getTarget(rq), rq, (rs: any, remote: any) => {
            if (+rs.status < 200) {
                const via = rs.headers.via[0];
                ctx.cancellers[via.params.branch] = () => this.sendCancel(rq, via, route);

                if (ctx.cancelled) this.sendCancel(rq, via, route);
            } else if (!ctx.cancelled) {
                delete ctx.cancellers;
            }
            callback(rs, remote);
        });
    }

    private getTarget(msg: any): any {
        const uri = msg.uri || msg.headers.contact[0].uri;
        let protocol = 'UDP'; // Default protocol

        if (uri.match(/^sips:/)) {
            protocol = 'TLS';
        } else if (uri.match(/^ws:/)) {
            protocol = 'WS';
        } else if (uri.match(/^wss:/)) {
            protocol = 'WSS';
        } else if (uri.match(/^tcp:/)) {
            protocol = 'TCP';
        } else if (uri.match(/^tls:/)) {
            protocol = 'TLS';
        }

        const addressMatch = uri.match(/^(?:sip|sips|ws|wss|tcp|tls):(?:[^@]*@)?([^;]+)/);
        const address = addressMatch ? addressMatch[1] : null;

        const portMatch = uri.match(/^(?:sip|sips|ws|wss|tcp|tls):(?:[^@]*@)?([^:;]+):(\d+)/);
        const port = portMatch ? +portMatch[2] : this.transport.defaultPort(protocol);

        return {
            protocol,
            address,
            port,
        };
    }

    private onRequest(
        rq: any,
        route: (rq: any, remote: any) => void,
        remote: any
    ): void {
        const ctx = (this.contexts[this.makeContextId(rq)] = {
            cancelled: false,
            cancellers: {},
        });

        this.transport.send(
            this.getTarget(rq),
            this.sipParser.makeResponse(rq, 100)
        );
        route(rq, remote);
    }
}

export default Proxy;
