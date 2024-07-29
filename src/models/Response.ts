export interface Response {
    status: number;
    reason: string;
    version: string;
    headers: { [key: string]: any };
    content?: string;
}
