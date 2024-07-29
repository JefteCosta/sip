import { Request, Response } from '#models/index';

interface Transaction {
    id: string;
    request: Request;
    response?: Response;
    transport: any;
}

class TransactionManager {
    private serverTransactions: Map<string, Transaction> = new Map();
    private clientTransactions: Map<string, Transaction> = new Map();

    private generateTransactionId(msg: Request | Response): string {
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

    getServer(msg: Request): Transaction | undefined {
        const id = this.generateTransactionId(msg);
        return this.serverTransactions.get(id);
    }

    getClient(msg: Response): Transaction | undefined {
        const id = this.generateTransactionId(msg);
        return this.clientTransactions.get(id);
    }

    createServerTransaction(msg: Request, transport: any): Transaction {
        const id = this.generateTransactionId(msg);
        const transaction: Transaction = { id, request: msg, transport };
        this.serverTransactions.set(id, transaction);
        return transaction;
    }

    createClientTransaction(msg: Request, transport: any): Transaction {
        const id = this.generateTransactionId(msg);
        const transaction: Transaction = { id, request: msg, transport };
        this.clientTransactions.set(id, transaction);
        return transaction;
    }
}

export default TransactionManager;
