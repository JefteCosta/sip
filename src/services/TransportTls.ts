import net from 'net';
import tls from 'tls';
import dgram from 'dgram';
import WebSocket from 'ws';
import os from 'os';
import crypto from 'crypto';
import { ITransport } from '../interfaces/ITransport';
import SIPParser from './SIPParser';

class Transport implements ITransport {
    private protocols: { [key: string]: any } = {};
    private options: any;
    private callback: any;
    private rbytes: Buffer;
    private sipParser = new SIPParser();
    private localAddress: string;
    private port: number;

    constructor(options: any, callback: any) {
        this.options = options;
        this.callback = callback;
        this.rbytes = crypto.randomBytes(20);
        this.localAddress = options.address || '0.0.0.0';
        this.port = options.port || 5060;
        this.init();
    }

    private init() {
        const callbackAndLog = this.callback;
        if (this.options.logger && this.options.logger.recv) {
            this.callback = (m: any, remote: any, stream: any) => {
                this.options.logger.recv(m, remote);
                callbackAndLog(m, remote, stream);
            };
        }

        if (this.options.udp === undefined || this.options.udp) this.protocols.UDP = this.makeUdpTransport();
        if (this.options.tcp === undefined || this.options.tcp) this.protocols.TCP = this.makeTcpTransport();
        if (this.options.tls) this.protocols.TLS = this.makeTlsTransport();
        if (this.options.ws_port && WebSocket) this.protocols.WS = this.makeWsTransport();
    }

    open(target: any, error: any): any {
        return this.wrap(this.protocols[target.protocol.toUpperCase()].open(target, error), target);
    }

    get(target: any, error: any): any {
        const flow = this.protocols[target.protocol.toUpperCase()].get(target, error);
        return flow && this.wrap(flow, target);
    }

    send(target: any, message: any, callback?: (rs: any, remote: any) => void): void {
        const cn = this.open(target, undefined);
        try {
            cn.send(message);
            if (callback) {
                callback(message, target);
            }
        } finally {
            cn.release();
        }
    }

    destroy(): void {
        const protos = this.protocols;
        this.protocols = {};
        Object.keys(protos).forEach((key) => protos[key].destroy());
    }

    getLocalAddress(): string {
        return this.localAddress;
    }

    getPort(): number {
        return this.port;
    }

    private wrap(obj: any, target: any) {
        return Object.create(obj, {
            send: {
                value: (m: any) => {
                    if (m.method) {
                        m.headers.via[0].host = this.options.publicAddress || this.localAddress || os.hostname();
                        m.headers.via[0].port = this.port;
                        m.headers.via[0].protocol = obj.protocol;

                        if (obj.protocol === 'UDP' && (!this.options.hasOwnProperty('rport') || this.options.rport)) {
                            m.headers.via[0].params.rport = null;
                        }
                    }
                    this.options.logger && this.options.logger.send && this.options.logger.send(m, target);
                    obj.send(m);
                },
            },
        });
    }

    private makeUdpTransport() {
        const socket = dgram.createSocket(net.isIPv6(this.localAddress) ? 'udp6' : 'udp4', this.onMessage.bind(this));
        socket.bind(this.port, this.localAddress);

        const open = (remote: any, error: any) => ({
            send: (m: any) => {
                const s = this.sipParser.stringify(m);
                socket.send(Buffer.from(s, 'binary'), 0, s.length, remote.port, remote.address);
            },
            protocol: 'UDP',
            release: () => {},
        });

        return {
            open,
            get: open,
            destroy: () => socket.close(),
        };
    }

    private makeTcpTransport() {
        return this.makeStreamTransport(
            'TCP',
            this.options.maxBytesHeaders,
            this.options.maxContentLength,
            (port, host, callback) => net.connect(port, host, callback),
            (callback) => {
                const server = net.createServer(callback);
                server.listen(this.port, this.localAddress);
                return server;
            }
        );
    }

    private makeTlsTransport() {
        return this.makeStreamTransport(
            'TLS',
            this.options.maxBytesHeaders,
            this.options.maxContentLength,
            (port, host, callback) => tls.connect(port, host, this.options.tls, callback),
            (callback) => {
                const server = tls.createServer(this.options.tls, callback);
                server.listen(this.options.tls_port || 5061, this.localAddress);
                return server;
            }
        );
    }

    private makeWsTransport() {
        const flows: { [key: string]: WebSocket } = Object.create(null);
        const clients: { [key: string]: any } = Object.create(null);

        const init = (ws: WebSocket) => {
            const remote = { address: (ws as any)._socket.remoteAddress, port: (ws as any)._socket.remotePort };
            const local = { address: (ws as any)._socket.address().address, port: (ws as any)._socket.address().port };
            const flowid = [remote.address, remote.port, local.address, local.port].join();

            flows[flowid] = ws;

            ws.on('close', () => delete flows[flowid]);
            ws.on('message', (data: any) => {
                const msg = this.sipParser.parseMessage(data);
                if (msg) {
                    this.callback(msg, { protocol: 'WS', address: remote.address, port: remote.port, local });
                }
            });
        };

        const makeClient = (uri: string) => {
            if (clients[uri]) return clients[uri]();

            const socket = new WebSocket(uri, 'sip');
            const queue: any[] = [];
            let refs = 0;

            const send_connecting = (m: any) => queue.push(this.sipParser.stringify(m));
            const send_open: any = (m: any) => socket.send(Buffer.from(typeof m === 'string' ? m : this.sipParser.stringify(m), 'binary'));
            let send = send_connecting;

            socket.on('open', () => {
                init(socket);
                send = send_open;
                queue.splice(0).forEach(send);
            });

            const open = (onError: any) => {
                ++refs;
                if (onError) socket.on('error', onError);
                return {
                    send: (m: any) => send(m),
                    release: () => {
                        if (onError) socket.removeListener('error', onError);
                        if (--refs === 0) socket.terminate();
                    },
                    protocol: 'WS',
                };
            };

            return (clients[uri] = open);
        };

        let server: WebSocket.Server;
        if (this.options.ws_port) {
            if (this.options.tls) {
                const http = require('https');
                server = new WebSocket.Server({
                    server: http.createServer(this.options.tls, (rq: any, rs: any) => {
                        rs.writeHead(200);
                        rs.end('');
                    }).listen(this.options.ws_port),
                });
            } else {
                server = new WebSocket.Server({ port: this.options.ws_port });
            }

            server.on('connection', init);
        }

        const get = (flow: any) => {
            const ws = flows[[flow.address, flow.port, flow.local.address, flow.local.port].join()];
            if (ws) {
                return {
                    send: (m: any) => ws.send(this.sipParser.stringify(m)),
                    release: () => {},
                    protocol: 'WS',
                };
            }
        };

        const open = (target: any, onError: any) => {
            if (target.local) return get(target);
            else return makeClient('ws://' + target.host + ':' + target.port)(onError);
        };

        return {
            get: open,
            open: open,
            destroy: () => server.close(),
        };
    }

    private makeStreamTransport(protocol: string, maxBytesHeaders: number, maxContentLength: number, connect: (port: number, host: string, callback?: any) => net.Socket, createServer: (callback: any) => net.Server) {
        const remotes: { [key: string]: any } = Object.create(null);
        const flows: { [key: string]: any } = Object.create(null);

        const init = (stream: net.Socket, remote: any) => {
            const remoteid = [remote.address, remote.port].join();
            let flowid: any = undefined;
            let refs = 0;

            const register_flow = () => {
                flowid = [remoteid, stream.localAddress, stream.localPort].join();
                flows[flowid] = remotes[remoteid];
            };

            const onMessage = (m: any) => {
                if (this.checkMessage(m)) {
                    if (m.method) m.headers.via[0].params.received = remote.address;
                    this.callback(m, { protocol: remote.protocol, address: stream.remoteAddress, port: stream.remotePort, local: { address: stream.localAddress, port: stream.localPort } }, stream);
                }
            };

            const onFlood = () => {
                console.log('Flood attempt, destroying stream');
                stream.destroy();
            };

            stream.setEncoding('binary');
            stream.on('data', this.makeStreamParser(onMessage, onFlood, maxBytesHeaders, maxContentLength));
            stream.on('close', () => {
                if (flowid) delete flows[flowid];
                delete remotes[remoteid];
            });
            stream.on('connect', register_flow);
            stream.on('error', () => {});
            stream.on('end', () => {
                if (refs !== 0) stream.emit('error', new Error('remote peer disconnected'));
                stream.end();
            });
            stream.on('timeout', () => {
                if (refs === 0) stream.destroy();
            });
            stream.setTimeout(120000);
            stream.setMaxListeners(10000);

            remotes[remoteid] = (onError: any) => {
                ++refs;
                if (onError) stream.on('error', onError);

                return {
                    release: () => {
                        if (onError) stream.removeListener('error', onError);
                        if (--refs === 0) stream.emit('no_reference');
                    },
                    send: (m: any) => stream.write(this.sipParser.stringify(m), 'binary'),
                    protocol: protocol,
                };
            };

            if (stream.localPort) register_flow();

            return remotes[remoteid];
        };

        const server = createServer((stream: net.Socket) => {
            init(stream, { protocol: protocol, address: stream.remoteAddress, port: stream.remotePort });
        });

        return {
            open: (remote: any, error: any) => {
                const remoteid = [remote.address, remote.port].join();
                if (remoteid in remotes) return remotes[remoteid](error);
                return init(connect(remote.port, remote.address), remote)(error);
            },
            get: (address: any, error: any) => {
                const c = address.local ? flows[[address.address, address.port, address.local.address, address.local.port].join()] : remotes[[address.address, address.port].join()];
                return c && c(error);
            },
            destroy: () => server.close(),
        };
    }

    private onMessage(data: Buffer, rinfo: net.AddressInfo) {
        const msg = this.sipParser.parseMessage(data);
        if (msg && this.checkMessage(msg)) {
            if (msg.method) {
                msg.headers.via[0].params.received = rinfo.address;
                if (msg.headers.via[0].params.hasOwnProperty('rport')) msg.headers.via[0].params.rport = rinfo.port;
            }
            this.callback(msg, { protocol: 'UDP', address: rinfo.address, port: rinfo.port, local: { address: this.localAddress, port: this.port } });
        }
    }

    private makeStreamParser(onMessage: (m: any) => void, onFlood: () => void, maxBytesHeaders: number, maxContentLength: number) {
        onFlood = onFlood || (() => {});
        maxBytesHeaders = maxBytesHeaders || 60480;
        maxContentLength = maxContentLength || 604800;

        let m: any;
        let r = '';

        const headers = (data: string) => {
            r += data;
            if (r.length > maxBytesHeaders) {
                r = '';
                onFlood();
                return;
            }

            const a = r.match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);
            if (a) {
                r = a[2];
                m = this.sipParser.parse(a[1]);
                if (m && m.headers['content-length'] !== undefined) {
                    if (m.headers['content-length'] > maxContentLength) {
                        r = '';
                        onFlood();
                    }
                    state = content;
                    content('');
                } else headers('');
            }
        };

        const content = (data: string) => {
            r += data;
            if (r.length >= m.headers['content-length']) {
                m.content = r.substring(0, m.headers['content-length']);
                onMessage(m);
                const s = r.substring(m.headers['content-length']);
                state = headers;
                r = '';
                headers(s);
            }
        };

        let state = headers;

        return (data: string) => state(data);
    }

    private checkMessage(msg: any) {
        return (
            (msg.method || (msg.status >= 100 && msg.status <= 999)) &&
            msg.headers &&
            Array.isArray(msg.headers.via) &&
            msg.headers.via.length > 0 &&
            msg.headers['call-id'] &&
            msg.headers.to &&
            msg.headers.from &&
            msg.headers.cseq
        );
    }

    private defaultPort(proto: string) {
        return proto.toUpperCase() === 'TLS' ? 5061 : 5060;
    }
}

export default Transport;
