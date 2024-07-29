export interface ITransport {
    open(target: any, error: any): any;
    get(target: any, error: any): any;
    send(target: any, message: any): void;
    destroy(): void;
}