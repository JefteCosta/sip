import { IProxy } from '../interfaces/IProxy';
import SIPParser from './SIPParser';
import Transport from './Transport';
import Authenticator from './Authenticator';

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
            } else {
                delete ctx.cancellers[rs.headers.via[0].params.branch];
            }

            callback(rs, remote);
        });
    }

    private onRequest(rq: any, route: any, remote: any): void {
        const id = this.makeContextId(rq);
        this.contexts[id] = { cancellers: {} };

        try {
            route(this.sipParser.parseMessage(rq), remote);
        } catch (e) {
            delete this.contexts[id];
            throw e;
        }
    }

    private getTarget(msg: any) {
        let hop = this.sipParser.parseUri(msg.uri);
        if (typeof msg.headers.route === 'string') {
            try {
                msg.headers.route = this.sipParser.parsers.route({ s: msg.headers.route, i: 0 });
            } catch (e) {
                msg.headers.route = undefined;
            }
        }

        if (msg.headers.route && msg.headers.route.length > 0) {
            hop = this.sipParser.parseUri(msg.headers.route[0].uri);
            if (hop.host === this.transport.getLocalAddress() && hop.port === this.transport.getPort()) {
                msg.headers.route.shift();
            } else if (hop.params.lr === undefined) {
                msg.headers.route.shift();
                msg.headers.route.push({ uri: msg.uri });
                msg.uri = hop;
            }
        }

        return hop;
    }
}

export default Proxy;
