export interface Request {
    method: string;
    uri: string;
    headers: { [key: string]: any };
    content?: string;
}
