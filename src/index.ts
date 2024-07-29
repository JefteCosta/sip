import Authenticator from './services/Authenticator';
import SDPParser from './services/SDPParser';
import SIPParser from './services/SIPParser';
import Proxy from './services/Proxy';
import Transport from './services/Transport';
import TransactionManager from './TransactionManager';

// Configuração inicial
const options = {
    port: 5060,
    address: '0.0.0.0',
    publicAddress: 'example.com',
    tls: {
        key: 'path/to/key.pem',
        cert: 'path/to/cert.pem'
    },
    logger: {
        recv: (msg: any, remote: any) => console.log('Received:', msg, remote),
        send: (msg: any, target: any) => console.log('Sent:', msg, target),
        error: (error: any) => console.error('Error:', error)
    }
};

// Inicialização dos serviços
const authenticator = new Authenticator();
const sdpParser = new SDPParser();
const sipParser = new SIPParser();
const transactionManager = new TransactionManager();
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

const callback = (m: any, remote: any) => {
    console.log('Processing message:', m);
    // Implementação do processamento da mensagem recebida
};

// Adicionar lógica adicional se necessário

// Exportar serviços conforme necessário
export {
    authenticator,
    sdpParser,
    sipParser,
    proxy,
    transport,
    transactionManager
};
