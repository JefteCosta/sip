import { startServer } from "#src/index"

const options = {
    protocol: 'udp',
    port: 5060,
    address: 'localhost',
    publicAddress: 'example.com',
    logger: {
        recv: (msg: any, remote: any) => console.log('Received:', msg, remote),
        send: (msg: any, target: any) => console.log('Sent:', msg, target),
        error: (error: any) => console.error('Error:', error)
    },
    // tls: {
    //     key: '',
    //     cert: ''
    // }
};

startServer(options);