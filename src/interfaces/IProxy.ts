export interface IProxy {
    send(msg: any, callback?: (rs: any) => void): void;
    start(options: any, route: (rq: any, remote: any) => void): void;
    stop(): void;
}