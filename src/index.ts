import Authenticator from '#services/Authenticator';
import SDPParser from '#services/SDPParser';
import SIPParser from '#services/SIPParser';
import Proxy from '#services/Proxy';
import Transport from '#services/Transport';

import TransactionManager from '#src/TransactionManager';
export interface OptionsData {
    
    port: number;
    address: string;
    publicAddress: string;
    tls?: {
        key: string;
        cert: string;
    };
    logger: {
        recv: (msg: any, remote: any) => void;
        send: (msg: any, target: any) => void;
        error: (error: any) => void;
    };
}
export const authenticator = new Authenticator();
export const sdpParser = new SDPParser();
export const sipParser = new SIPParser();


export function startServer(options: OptionsData) {
    const transactionManager = new TransactionManager();

    const callback = (m: any, remote: any) => {
        console.log('Processing message:', m);
        // Implementação do processamento da mensagem recebida
    };
   
    
    const transport = new Transport(options, (m: any, remote: any, stream: any) => {
        try {
            const t = m.method ? transactionManager.getServer(m) : transactionManager.getClient(m);
            if (!t) {
                if (m.method && m.method !== 'ACK') {
                    const t = transactionManager.createServerTransaction(m, transport.get(remote, (err: any) => {
                        if (err) {
                            options.logger.error(err);
                        }
                    }));
                    try {
                        callback(m, remote);
                    } catch (e) {
                        t.transport.send(sipParser.makeResponse(m, 500, 'Internal Server Error'));
                        throw e;
                    }
                } else if (m.method === 'ACK') {
                    callback(m, remote);
                }
            } else {
                t.transport.send(m);
            }
        } catch (e) {
            options.logger.error(e);
        }
    });
    const proxy = new Proxy(options, (m: any, remote: any, stream: any) => {
        try {
            const t = m.method ? transactionManager.getServer(m) : transactionManager.getClient(m);
            if (!t) {
                if (m.method && m.method !== 'ACK') {
                    const t = transactionManager.createServerTransaction(m, transport.get(remote, (err: any) => {
                        if (err) {
                            options.logger.error(err);
                        }
                    }));
                    try {
                        callback(m, remote);
                    } catch (e) {
                        t.transport.send(sipParser.makeResponse(m, 500, 'Internal Server Error'));
                        throw e;
                    }
                } else if (m.method === 'ACK') {
                    callback(m, remote);
                }
            } else {
                t.transport.send(m);
            }
        } catch (e) {
            options.logger.error(e);
        }
    });

    proxy.start(options, callback);

    console.log(`SIP server is listening on ${options.address}:${options.port}`);
}
